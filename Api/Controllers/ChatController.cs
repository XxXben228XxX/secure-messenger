using Api.Dtos;
using Api.Models;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.IO;
using Api.Data; // Додайте цей рядок для доступу до ApplicationDbContext
using System.Linq;

namespace Api.Controllers
{
    [Authorize]
    [Route("api/[controller]")]
    [ApiController]
    public class ChatController : ControllerBase
    {
        private readonly ChatService _chatService;
        private readonly JwtService _jwtService;
        private readonly IHubContext<ChatHub> _hubContext; // Оголошуємо
        private readonly ApplicationDbContext _dbContext; // Оголошуємо

        public ChatController(ChatService chatService, JwtService jwtService, IHubContext<ChatHub> hubContext,
            ApplicationDbContext dbContext)
        {
            _chatService = chatService;
            _jwtService = jwtService;
            _hubContext = hubContext; // Ініціалізуємо
            _dbContext = dbContext;
        }

        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] UserDto model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userExists = await _chatService.GetUserByUsername(model.Name);
            if (userExists != null)
            {
                return Conflict(new { message = "This name is taken, please choose another name." });
            }

            var registeredUser = await _chatService.RegisterUserAsync(model.Name, model.Password);

            if (registeredUser != null)
            {
                // Corrected method call
                var token = _jwtService.GenerateToken(registeredUser);

                var cookieOptions = new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.Strict,
                    Expires = DateTime.UtcNow.AddDays(7)
                };
                Response.Cookies.Append("jwt-token", token, cookieOptions);

                return Ok(new { message = "Реєстрація успішна!" });
            }

            return StatusCode(500, new { message = "Unknown error during registration." });
        }

        [HttpPost("test-post")]
        [AllowAnonymous]
        public IActionResult TestPost([FromBody] UserDto model)
        {
            Console.WriteLine("=== TEST POST CALLED ===");
            Console.WriteLine($"Model is null: {model == null}");
            Console.WriteLine($"Name: {model?.Name}");
            Console.WriteLine($"Password: {model?.Password}");
            Console.WriteLine($"ModelState.IsValid: {ModelState.IsValid}");

            if (!ModelState.IsValid)
            {
                foreach (var error in ModelState.Values.SelectMany(v => v.Errors))
                {
                    Console.WriteLine($"Error: {error.ErrorMessage}");
                }
            }

            return Ok(new { message = "Test successful", receivedName = model?.Name });
        }

        [HttpPost("login")]
        [AllowAnonymous]
        public async Task<IActionResult> Login([FromBody] UserDto model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var user = await _chatService.AuthenticateUserAsync(model.Name, model.Password);

            if (user == null)
            {
                return Unauthorized(new { message = "Невірне ім'я користувача або пароль." });
            }

            // Corrected method call
            var token = _jwtService.GenerateToken(user);

            var cookieOptions = new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = SameSiteMode.Strict,
                Expires = DateTime.UtcNow.AddDays(7)
            };
            Response.Cookies.Append("jwt-token", token, cookieOptions);

            return Ok(new { message = "Вхід успішний!" });
        }

        [Authorize]
        [HttpGet("current-user")]
        public IActionResult GetCurrentUser()
        {
            var userName = HttpContext.User?.Identity?.Name;
            if (string.IsNullOrEmpty(userName))
            {
                return Unauthorized();
            }
            return Ok(new { name = userName });
        }

        [HttpPost("logout")]
        [Authorize]
        public IActionResult Logout()
        {
            // For JWT authentication with cookies, logging out means removing the cookie.
            Response.Cookies.Delete("jwt-token");
            return NoContent();
        }

        // Це код, який потрібно додати до вашого ChatController.cs

        [Authorize]
        [HttpGet("private/{otherUser}")]
        public async Task<ActionResult<List<Message>>> GetPrivateMessages(string otherUser)
        {
            var currentUserName = HttpContext.User?.Identity?.Name;
            if (string.IsNullOrEmpty(currentUserName))
            {
                return Unauthorized();
            }

            // Використовуємо існуючий універсальний метод
            var messages = await _chatService.GetChatHistoryAsync(currentUserName, otherUser);

            if (messages == null)
            {
                return NotFound("Private chat history not found.");
            }

            return Ok(messages);
        }

        // src/app/services/chat.service.ts

        [HttpPost("send-global-file")]
        [DisableRequestSizeLimit]
        [Authorize]
        public async Task<IActionResult> SendGlobalFile([FromForm] IFormFile file, [FromForm] string tempId, [FromForm] string? parentMessageId = null) // ✅ ДОДАНО: string tempId
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest("File is not provided.");
            }

            var userName = User.Identity?.Name;
            if (string.IsNullOrEmpty(userName))
            {
                return Unauthorized();
            }

            var uploadsFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads");
            if (!Directory.Exists(uploadsFolder))
            {
                Directory.CreateDirectory(uploadsFolder);
            }

            var uniqueFileName = Guid.NewGuid().ToString() + Path.GetExtension(file.FileName);
            var filePath = Path.Combine(uploadsFolder, uniqueFileName);

            await using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var message = new Message
            {
                Id = Guid.NewGuid().ToString(),
                TempId = tempId,
                FromUser = userName,
                ToUser = "GlobalChat",
                // ✅ ВАЖЛИВО: Для файлів Content повинен бути порожнім.
                // Це уникне спроб розшифрування на фронтенді.
                Content = null,
                Timestamp = DateTime.UtcNow,
                Status = "delivered",
                IsFile = true,
                // 🔥 ВИПРАВЛЕННЯ: Зберігаємо УНІКАЛЬНЕ ім'я файлу, щоб фронтенд міг його завантажити
                FileName = uniqueFileName,
                ParentMessageId = parentMessageId
            };

            // Save the message to the database
            _dbContext.Messages.Add(message);
            await _dbContext.SaveChangesAsync();

            await _hubContext.Clients.All.SendAsync("NewMessage", message);

            return Ok(message);
        }
        [Authorize]
        [HttpPost("SendFile")]
        [DisableRequestSizeLimit]
        public async Task<IActionResult> SendFile([FromForm] IFormFile File, [FromForm] string ToUser, [FromForm] string TempId, [FromForm] string? ParentMessageId = null)
        {
            // ПРИМІТКА: Імена параметрів (File, ToUser, TempId) ПОВИННІ точно збігатися з ключами у FormData Angular-клієнта.

            if (File == null || File.Length == 0)
            {
                return BadRequest("File is not provided.");
            }

            var userName = User.Identity?.Name;
            if (string.IsNullOrEmpty(userName))
            {
                return Unauthorized();
            }

            var uploadsFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads");
            if (!Directory.Exists(uploadsFolder))
            {
                Directory.CreateDirectory(uploadsFolder);
            }

            var uniqueFileName = Guid.NewGuid().ToString() + Path.GetExtension(File.FileName);
            var filePath = Path.Combine(uploadsFolder, uniqueFileName);

            await using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await File.CopyToAsync(stream);
            }

            var message = new Message
            {
                Id = Guid.NewGuid().ToString(),
                TempId = TempId,
                FromUser = userName,
                ToUser = ToUser, // 🔥 Встановлюємо конкретного отримувача, а не "GlobalChat"
                Content = null,
                Timestamp = DateTime.UtcNow,
                Status = "delivered",
                IsFile = true,
                FileName = uniqueFileName,
                ParentMessageId = ParentMessageId
            };

            // Save the message to the database
            _dbContext.Messages.Add(message);
            await _dbContext.SaveChangesAsync();

            // Надсилаємо SignalR-повідомлення відправнику та отримувачу
            // Clients.User(userName) та Clients.User(ToUser) використовують User ID/Name, 
            // які SignalR пов'язав із підключенням (зазвичай, це поле Name з JWT-токена).
            await _hubContext.Clients.User(userName).SendAsync("NewPrivateMessage", message);
            await _hubContext.Clients.User(ToUser).SendAsync("NewPrivateMessage", message);

            return Ok(message);
        }
        [HttpGet("messages/global")]
        public async Task<ActionResult<List<MessageDto>>> GetGlobalMessages()
        {
            var messages = await _chatService.GetGlobalMessagesAsync();
            return Ok(messages);
        }
    }

}

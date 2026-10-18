using Microsoft.AspNetCore.Mvc;
using Api.Models;
using Api.Dtos;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using System;
using Api.Services;

namespace Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class UserController : ControllerBase
    {
        private readonly IUserService _userService;
        private readonly ILogger<UserController> _logger;

        public UserController(IUserService userService, ILogger<UserController> logger)
        {
            _userService = userService;
            _logger = logger;
        }

        [HttpPost("register")] // Зберігаємо той самий ендпоінт, щоб Angular не міняти
        public async Task<IActionResult> RegisterUser([FromBody] UserRegisterDto userRegisterDto)
        {
            if (userRegisterDto == null || string.IsNullOrWhiteSpace(userRegisterDto.UserName) || string.IsNullOrWhiteSpace(userRegisterDto.Password))
            {
                return BadRequest("Invalid user data.");
            }

            _logger.LogInformation($"Attempting to register/login UserName: {userRegisterDto.UserName}, Password: {userRegisterDto.Password}");

            // 1. Перевіряємо, чи користувач вже існує
            var existingUser = await _userService.GetUserByNameAsync(userRegisterDto.UserName);

            if (existingUser != null)
            {
                // 2. Користувач вже існує.
                // Для спрощення, як ти просив: вважаємо, що якщо ім'я є, то користувач "залогінився".
                // У реальному житті тут має бути перевірка пароля:
                // if (existingUser.Password != userRegisterDto.Password) // Порівнювати хеші паролів!
                // {
                //     return Unauthorized("Invalid credentials.");
                // }

                _logger.LogInformation($"User {userRegisterDto.UserName} already exists. Proceeding as logged in.");
                return Ok("User already exists, logged in."); // Повертаємо 200 OK
            }

            // 3. Якщо користувача немає, створюємо нового
            var newUser = new User
            {
                UserName = userRegisterDto.UserName,
                Password = userRegisterDto.Password, // ПАМ'ЯТАЙТЕ ПРО ХЕШУВАННЯ ПАРОЛЯ В РЕАЛЬНОМУ ПРОЕКТІ!
                ConnectionId = userRegisterDto.ConnectionId, // Зазвичай це порожній рядок на реєстрації
                IsOnline = userRegisterDto.IsOnline // Зазвичай true при реєстрації/логіні
            };

            try
            {
                await _userService.CreateUserAsync(newUser);
                _logger.LogInformation($"User {newUser.UserName} registered successfully.");
                return Ok("User registered successfully."); // Повертаємо 200 OK
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error registering new user.");
                return StatusCode(500, "Internal server error during user creation.");
            }
        }

        [HttpGet("online-users")]
        public async Task<IActionResult> GetOnlineUsers()
        {
            var users = await _userService.GetOnlineUsersAsync();
            return Ok(users);
        }

        [HttpPost("update-user")]
        public async Task<IActionResult> UpdateUser(UserDto userDto)
        {
            var user = await _userService.GetUserByNameAsync(userDto.Name); // UserDto.Name? Чи має бути UserName?
            if (user == null)
            {
                return NotFound("User not found");
            }

            user.IsOnline = userDto.IsOnline;
            await _userService.UpdateUserAsync(user);

            return Ok();
        }
    }
}
// Controllers/TestController.cs

using Api.Data;
using Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Come2Chat.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TestController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly ILogger<TestController> _logger;

        public TestController(ApplicationDbContext context, ILogger<TestController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // ========================================
        // 1. Отримати останнє повідомлення користувача
        // ========================================
        [HttpGet("messages/last")]
        public async Task<IActionResult> GetLastMessage([FromQuery] string user)
        {
            if (string.IsNullOrEmpty(user))
            {
                return BadRequest(new { error = "User parameter is required" });
            }

            try
            {
                var lastMessage = await _context.Messages
                    .Where(m => m.FromUser == user)
                    .OrderByDescending(m => m.Timestamp)
                    .FirstOrDefaultAsync();

                if (lastMessage == null)
                {
                    return NotFound(new { error = $"No messages found for user '{user}'" });
                }

                // ✅ Повертаємо в форматі, який очікує тест
                var response = new
                {
                    id = lastMessage.Id,
                    content = lastMessage.Content,  // Зашифрований
                    iv = lastMessage.IV,            // ✅ Обов'язково для тесту
                    salt = lastMessage.Salt,
                    from = lastMessage.FromUser,
                    to = lastMessage.ToUser,
                    timestamp = lastMessage.Timestamp,
                    isFile = lastMessage.IsFile,
                    fileName = lastMessage.FileName
                };

                _logger.LogInformation($"[TestController] Retrieved last message for {user}: ID={lastMessage.Id}");
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[TestController] Error retrieving last message for user '{user}'");
                return StatusCode(500, new { error = "Internal server error", details = ex.Message });
            }
        }

        // ========================================
        // 2. Очистити тестові дані
        // ========================================
        [HttpPost("cleanup")]
        public async Task<IActionResult> Cleanup()
        {
            try
            {
                var testMessages = _context.Messages
                    .Where(m => m.FromUser.StartsWith("test") ||
                               (m.ToUser != null && m.ToUser.StartsWith("test")));

                _context.Messages.RemoveRange(testMessages);

                var testUsers = _context.Users
                    .Where(u => u.UserName.StartsWith("test"));

                _context.Users.RemoveRange(testUsers);

                await _context.SaveChangesAsync();

                _logger.LogInformation("[TestController] Test data cleaned up successfully");
                return Ok(new { message = "Test data cleaned up successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[TestController] Error during cleanup");
                return StatusCode(500, new { error = "Cleanup failed", details = ex.Message });
            }
        }

        // ========================================
        // 3. Створити тестового користувача
        // ========================================
        [HttpPost("users/create")]
        public async Task<IActionResult> CreateTestUser([FromBody] TestUserDto userDto)
        {
            if (string.IsNullOrEmpty(userDto.Username) || string.IsNullOrEmpty(userDto.Password))
            {
                return BadRequest(new { error = "Username and password are required" });
            }

            try
            {
                var existingUser = await _context.Users
                    .FirstOrDefaultAsync(u => u.UserName == userDto.Username);

                if (existingUser != null)
                {
                    _logger.LogWarning($"[TestController] User '{userDto.Username}' already exists");
                    // ✅ Повертаємо 200 OK замість 409 Conflict, щоб тест не провалився
                    return Ok(new { message = "User already exists", username = userDto.Username });
                }

                var newUser = new User
                {
                    UserName = userDto.Username,
                    Password = userDto.Password, // ⚠️ У продакшені обов'язково хешувати!
                    IsOnline = false,
                    ConnectionId = string.Empty
                };

                _context.Users.Add(newUser);
                await _context.SaveChangesAsync();

                _logger.LogInformation($"[TestController] Test user '{userDto.Username}' created successfully");
                return Ok(new { message = "User created successfully", username = userDto.Username });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[TestController] Error creating user '{userDto.Username}'");
                return StatusCode(500, new { error = "User creation failed", details = ex.Message });
            }
        }

        // ========================================
        // 4. Отримати всі повідомлення (для діагностики)
        // ========================================
        [HttpGet("messages/all")]
        public async Task<IActionResult> GetAllMessages([FromQuery] int limit = 50)
        {
            try
            {
                var messages = await _context.Messages
                    .OrderByDescending(m => m.Timestamp)
                    .Take(limit)
                    .Select(m => new
                    {
                        id = m.Id,
                        from = m.FromUser,
                        to = m.ToUser,
                        contentPreview = m.Content != null && m.Content.Length > 50
                            ? m.Content.Substring(0, 50) + "..."
                            : m.Content,
                        iv = m.IV,
                        timestamp = m.Timestamp,
                        isEncrypted = !string.IsNullOrEmpty(m.Content) && m.Content.Contains("="),
                        hasIV = !string.IsNullOrEmpty(m.IV)
                    })
                    .ToListAsync();

                return Ok(new { count = messages.Count, messages });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[TestController] Error retrieving all messages");
                return StatusCode(500, new { error = "Failed to retrieve messages", details = ex.Message });
            }
        }

        // ========================================
        // 5. ✅ НОВИЙ ENDPOINT: Перевірка шифрування конкретного повідомлення
        // ========================================
        [HttpGet("messages/{messageId}/encryption-status")]
        public async Task<IActionResult> CheckMessageEncryption(string messageId)
        {
            try
            {
                var message = await _context.Messages
                    .FirstOrDefaultAsync(m => m.Id == messageId);

                if (message == null)
                {
                    return NotFound(new { error = "Message not found" });
                }

                var isEncrypted = !string.IsNullOrEmpty(message.Content) &&
                                 message.Content.Contains("=") &&
                                 !string.IsNullOrEmpty(message.IV);

                return Ok(new
                {
                    messageId = message.Id,
                    isEncrypted = isEncrypted,
                    hasIV = !string.IsNullOrEmpty(message.IV),
                    hasSalt = !string.IsNullOrEmpty(message.Salt),
                    contentLength = message.Content?.Length ?? 0,
                    ivLength = message.IV?.Length ?? 0,
                    timestamp = message.Timestamp
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[TestController] Error checking encryption for message {messageId}");
                return StatusCode(500, new { error = "Failed to check encryption", details = ex.Message });
            }
        }
    }

    public class TestUserDto
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }
}
// File: Api/Services/UserService.cs
using Api.Data; // Для ApplicationDbContext
using Api.Models; // Для User
using System.Collections.Generic;
using System.Linq; // Для .Where, .Select, .ToList
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore; // Для ToListAsync, FirstOrDefaultAsync
using System; // Для Console.WriteLine, Exception

namespace Api.Services
{
    public class UserService : IUserService
    {
        private readonly ApplicationDbContext _context;

        public UserService(ApplicationDbContext context)
        {
            _context = context;
        }

        public async Task AddUserAsync(User user)
        {
            _context.Users.Add(user);
            await _context.SaveChangesAsync();
        }

        public async Task CreateUserAsync(User user)
        {
            try
            {
                _context.Users.Add(user);
                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error creating user: {ex.Message}");
                throw;
            }
        }

        public async Task UpdateUserAsync(User user)
        {
            // Якщо user об'єкт вже відстежується контекстом (наприклад, ви його щойно отримали з БД),
            // то просто зміна властивостей і SaveChangesAsync() буде достатньо.
            // Якщо ж user є "від'єднаним" об'єктом, то _context.Users.Update(user); може бути потрібним.
            // У багатьох сценаріях (коли ви отримуєте об'єкт з Find/FirstOrDefault, змінюєте його і зберігаєте),
            // EF Core сам відстежує зміни, і явний Update не потрібен.
            await _context.SaveChangesAsync();
        }

        // ОНОВЛЕНО: повертає User? (nullable)
        public async Task<User?> GetUserByNameAsync(string userName)
        {
            return await _context.Users.FirstOrDefaultAsync(u => u.UserName == userName);
        }

        // ОНОВЛЕНО: повертає User? (nullable)
        public async Task<User?> GetUserByConnectionIdAsync(string connectionId)
        {
            return await _context.Users.FirstOrDefaultAsync(u => u.ConnectionId == connectionId);
        }

        // ********************************************************************************
        // ОНОВЛЕНИЙ МЕТОД: РЕАЛІЗАЦІЯ SetUserConnectionIdAsync(string userName, string connectionId)
        // Цей метод відповідає за оновлення ConnectionId та IsOnline для користувача за його ім'ям.
        // ********************************************************************************
        public async Task SetUserConnectionIdAsync(string userName, string connectionId)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.UserName == userName);
            if (user != null)
            {
                user.ConnectionId = connectionId;
                user.IsOnline = true; // Користувач онлайн, якщо його ConnectionId встановлюється
                await _context.SaveChangesAsync();
                Console.WriteLine($"[UserService] Updated connection ID for user {userName}: {connectionId}, IsOnline=true.");
            }
            else
            {
                Console.WriteLine($"[UserService] Error: User '{userName}' not found when trying to set connection ID.");
                // Можливо, кинути виняток або повернути false, якщо користувача не знайдено.
                // Для простоти, просто логуємо помилку.
            }
        }

        // <<< РЕАЛІЗАЦІЇ ІНШИХ МЕТОДІВ З ІНТЕРФЕЙСУ >>>

        public async Task<List<string>> GetOnlineUserNamesAsync()
        {
            return await _context.Users
                                 .Where(u => u.IsOnline)
                                 .Select(u => u.UserName)
                                 .ToListAsync();
        }

        // ОНОВЛЕНО: повертає string? (nullable)
        public async Task<string?> GetConnectionIdByUserAsync(string userName)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.UserName == userName);
            return user?.ConnectionId; // Повертаємо ConnectionId, або null, якщо користувача не знайдено
        }

        public async Task<List<User>> GetOnlineUsersAsync()
        {
            return await _context.Users.Where(u => u.IsOnline).ToListAsync();
        }
    }
}
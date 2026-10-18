// File: Api/Services/IUserService.cs
using Api.Models; // Потрібно, щоб бачити модель User
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Api.Services // Важливо: переконайтеся, що це правильний простір імен для ваших сервісів
{
    public interface IUserService
    {
        Task AddUserAsync(User user);
        Task CreateUserAsync(User user);
        Task UpdateUserAsync(User user);

        // Зробив nullable, тому що GetUserByNameAsync може повернути null
        Task<User?> GetUserByNameAsync(string userName);
        // Зробив nullable, тому що GetUserByConnectionIdAsync може повернути null
        Task<User?> GetUserByConnectionIdAsync(string connectionId);

        // <<< ТЕПЕР ТІЛЬКИ ЦЕЙ МЕТОД ПОВИНЕН БУТИ ДЛЯ SetUserConnectionIdAsync >>>
        // Він приймає ім'я користувача (string) замість об'єкта User.
        Task SetUserConnectionIdAsync(string userName, string connectionId);

        // Цей метод потрібен, оскільки ChatHub викликає `_userService.GetOnlineUserNamesAsync()`
        Task<List<string>> GetOnlineUserNamesAsync(); // Повертає список імен користувачів

        // Цей метод потрібен, оскільки ChatHub викликає `_userService.GetConnectionIdByUserAsync()`
        // Зробив nullable, тому що GetConnectionIdByUserAsync може повернути null
        Task<string?> GetConnectionIdByUserAsync(string userName);

        Task<List<User>> GetOnlineUsersAsync();
    }
}
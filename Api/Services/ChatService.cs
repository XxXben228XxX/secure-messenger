using Api.Data;
using Api.Dtos;
using Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Api.Services
{
    public class ChatService
    {
        private static readonly ConcurrentDictionary<string, string> UsersConnectionIds = new ConcurrentDictionary<string, string>();

        private readonly IUserService _userService;
        private readonly ApplicationDbContext _dbContext; // ✅ Використовуємо _dbContext
        private readonly IHubContext<ChatHub> _hubContext;
        private readonly JwtService _jwtService;
        private readonly ILogger<ChatService> _logger;
        private readonly string _userHashSecretKey;
        private readonly long _userHashExpirationMinutes;

        public ChatService(IUserService userService, ApplicationDbContext dbContext,
                           IHubContext<ChatHub> hubContext, JwtService jwtService,
                           ILogger<ChatService> logger, IOptions<ChatSettings> chatSettings)
        {
            _userService = userService;
            _dbContext = dbContext;
            _hubContext = hubContext;
            _jwtService = jwtService;
            _logger = logger;
            _userHashSecretKey = chatSettings.Value.UserHashSecretKey;
            _userHashExpirationMinutes = chatSettings.Value.UserHashExpirationMinutes;
        }

        private string CreateUserHash(string userId)
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var dataToHash = $"{userId}:{timestamp}:{_userHashSecretKey}";

            using (var sha256 = System.Security.Cryptography.SHA256.Create())
            {
                var hashedBytes = sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(dataToHash));
                return Convert.ToBase64String(hashedBytes) + ":" + timestamp;
            }
        }

        public bool IsUserHashValid(string userHash, string userId, long userHashTimestamp)
        {
            // The server no longer needs to split the hash.
            // It uses the timestamp that the client sent.
            var dataToHash = $"{userId}:{userHashTimestamp}:{_userHashSecretKey}";

            using (var sha256 = System.Security.Cryptography.SHA256.Create())
            {
                var hashedBytes = sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(dataToHash));
                var validHash = Convert.ToBase64String(hashedBytes);

                // You can remove the time validation here, as it's better to let the client handle it.
                // The timestamp is now only used to re-create the hash.
                return validHash == userHash;
            }
        }

        #region Аутентифікація та Реєстрація Користувачів

        public async Task<User> RegisterUserAsync(string username, string password)
        {
            var newUser = new User
            {
                UserName = username,
                Password = password,
                IsOnline = false
            };

            _dbContext.Users.Add(newUser);
            await _dbContext.SaveChangesAsync();

            return newUser;
        }

        public async Task<User?> AuthenticateUserAsync(string username, string password)
        {
            _logger.LogInformation($"[ChatService] Attempting to authenticate user: {username}");
            var user = await _userService.GetUserByNameAsync(username);

            if (user != null && user.Password == password)
            {
                _logger.LogInformation($"[ChatService] User '{username}' authenticated successfully.");
                return user;
            }

            _logger.LogWarning($"[ChatService] Authentication failed for user '{username}'. Invalid credentials.");
            return null;
        }

        public string GenerateJwtToken(User user)
        {
            return _jwtService.GenerateToken(user);
        }

        public async Task<User?> GetUserByUsername(string username)
        {
            return await _userService.GetUserByNameAsync(username);
        }

        #endregion

        #region Управління Користувачами та З'єднаннями SignalR

        public async Task UpdateUserAsync(User user)
        {
            await _userService.UpdateUserAsync(user);
            if (user.ConnectionId != null)
            {
                UsersConnectionIds.AddOrUpdate(user.UserName, user.ConnectionId, (key, oldValue) => user.ConnectionId);
                _logger.LogDebug($"[ChatService] User connection cache updated for '{user.UserName}': {user.ConnectionId}");
            }
            else
            {
                UsersConnectionIds.TryRemove(user.UserName, out _);
                _logger.LogDebug($"[ChatService] User connection cache removed for '{user.UserName}'.");
            }
        }

        public async Task AddUserConnectionIdAsync(string userName, string connectionId)
        {
            var user = await _userService.GetUserByNameAsync(userName);
            if (user != null)
            {
                user.ConnectionId = connectionId;
                user.IsOnline = true;
                await _userService.UpdateUserAsync(user);
                UsersConnectionIds.AddOrUpdate(userName, connectionId, (key, oldValue) => connectionId);
                _logger.LogInformation($"[ChatService] User '{userName}' connection ID set to {connectionId}. User marked as online.");
            }
            else
            {
                _logger.LogWarning($"[ChatService] Failed to set connection ID: User '{userName}' not found.");
            }
        }

        public async Task<User?> GetUserByConnectionIdAsync(string connectionId)
        {
            return await _userService.GetUserByConnectionIdAsync(connectionId);
        }

        public async Task<string?> GetConnectionIdByUserAsync(string userName)
        {
            if (UsersConnectionIds.TryGetValue(userName, out string? connectionId) && connectionId != null)
            {
                _logger.LogDebug($"[ChatService] Connection ID for '{userName}' found in cache: {connectionId}");
                return connectionId;
            }

            var user = await _userService.GetUserByNameAsync(userName);
            if (user?.ConnectionId != null)
            {
                UsersConnectionIds.TryAdd(userName, user.ConnectionId);
                _logger.LogDebug($"[ChatService] Connection ID for '{userName}' found in DB and cached: {user.ConnectionId}");
                return user.ConnectionId;
            }
            _logger.LogDebug($"[ChatService] Connection ID for '{userName}' not found (offline or never connected).");
            return null;
        }

        public async Task<List<string>> GetOnlineUsersAsync()
        {
            var onlineUsers = await _userService.GetOnlineUsersAsync();
            return onlineUsers.Select(u => u.UserName).ToList();
        }

        public async Task RemoveUserFromListAsync(User user)
        {
            user.ConnectionId = null;
            user.IsOnline = false;
            await _userService.UpdateUserAsync(user);
            UsersConnectionIds.TryRemove(user.UserName, out _);
            _logger.LogInformation($"[ChatService] User '{user.UserName}' removed from connection list and marked offline.");
        }

        #endregion

        public async Task SaveMessageAsync(MessageDto messageDto)
        {
            _logger.LogInformation($"[ChatService] SaveMessageAsync called:");
            _logger.LogInformation($"  - Message ID: {messageDto.Id}");
            _logger.LogInformation($"  - From: {messageDto.From}");
            _logger.LogInformation($"  - Content length: {messageDto.Content?.Length ?? 0}");
            _logger.LogInformation($"  - IV: '{messageDto.IV}' (IsNull: {messageDto.IV == null}, IsEmpty: {string.IsNullOrEmpty(messageDto.IV)})");
            _logger.LogInformation($"  - Salt: '{messageDto.Salt}' (IsNull: {messageDto.Salt == null}, IsEmpty: {string.IsNullOrEmpty(messageDto.Salt)})");
            _logger.LogInformation($"  - IsFile: {messageDto.IsFile}");

            var sender = await _dbContext.Users.FirstOrDefaultAsync(u => u.UserName == messageDto.From);
            if (sender == null)
            {
                _logger.LogError($"[ChatService] Sender user '{messageDto.From}' not found.");
                throw new InvalidOperationException($"User '{messageDto.From}' not found.");
            }

            // ✅ ВИПРАВЛЕНО: Не шифруємо повторно - клієнт вже надіслав зашифрований контент
            string contentToStore = messageDto.Content;

            // ❌ ВИДАЛІТЬ ЦЕЙ БЛОК:
            // if (!messageDto.IsFile && !string.IsNullOrEmpty(messageDto.Content))
            // {
            //     contentToStore = _aesEncryptionService.Encrypt(messageDto.Content);
            //     _logger.LogInformation($"[ChatService] Encrypted global message content for ID: {messageDto.Id}");
            // }

            _logger.LogInformation($"[ChatService] Storing content as-is (already encrypted by client) for ID: {messageDto.Id}");

            var message = new Message
            {
                Id = messageDto.Id ?? Guid.NewGuid().ToString(),
                FromUser = messageDto.From,
                ToUser = messageDto.To,
                Content = contentToStore, // ✅ Вже зашифрований клієнтом
                IV = messageDto.IV ?? string.Empty,
                Salt = messageDto.Salt ?? string.Empty,
                Timestamp = messageDto.Timestamp,
                Status = messageDto.Status ?? "delivered",
                Edited = messageDto.Edited,
                IsFile = messageDto.IsFile,
                FileName = messageDto.FileName,
                ParentMessageId = messageDto.ParentMessageId,
                TempId = messageDto.TempId
            };

            _logger.LogInformation($"[ChatService] Message object before save:");
            _logger.LogInformation($"  - IV: '{message.IV}' (Length: {message.IV.Length})");
            _logger.LogInformation($"  - Salt: '{message.Salt}' (Length: {message.Salt.Length})");

            _dbContext.Messages.Add(message);
            await _dbContext.SaveChangesAsync();

            var savedMessage = await _dbContext.Messages.FirstOrDefaultAsync(m => m.Id == message.Id);
            if (savedMessage != null)
            {
                _logger.LogInformation($"[ChatService] Verification - Message saved to DB:");
                _logger.LogInformation($"  - ID: {savedMessage.Id}");
                _logger.LogInformation($"  - IV in DB: '{savedMessage.IV}' (Length: {savedMessage.IV?.Length ?? 0})");
                _logger.LogInformation($"  - Salt in DB: '{savedMessage.Salt}' (Length: {savedMessage.Salt?.Length ?? 0})");
            }

            _logger.LogInformation($"[ChatService] Global message {message.Id} from '{message.FromUser}' saved to DB with status '{message.Status}'.");
        }

        public async Task SavePrivateMessageAsync(MessageDto messageDto)
        {
            var sender = await _dbContext.Users.FirstOrDefaultAsync(u => u.UserName == messageDto.From);
            if (sender == null)
            {
                _logger.LogError($"[ChatService] Sender user '{messageDto.From}' not found for private message.");
                throw new InvalidOperationException($"User '{messageDto.From}' not found.");
            }

            // ✅ КРИТИЧНО: Клієнт вже надіслав зашифрований контент з IV та Salt
            // Тому НЕ шифруємо повторно - просто зберігаємо як є
            string contentToStore = messageDto.Content;

            _logger.LogInformation($"[ChatService] Storing private message as-is (already encrypted by client) for ID: {messageDto.Id}");

            var message = new Message
            {
                Id = messageDto.Id ?? Guid.NewGuid().ToString(),
                FromUser = messageDto.From,
                ToUser = messageDto.To,
                Content = contentToStore,     // ✅ Вже зашифрований клієнтом
                IV = messageDto.IV ?? string.Empty,       // ✅ Зберігаємо IV
                Salt = messageDto.Salt ?? string.Empty,   // ✅ Зберігаємо Salt
                Timestamp = messageDto.Timestamp,
                Status = messageDto.Status ?? "sent",
                Edited = messageDto.Edited,
                IsFile = messageDto.IsFile,
                FileName = messageDto.FileName,
                ParentMessageId = messageDto.ParentMessageId,
                TempId = messageDto.TempId
            };

            _dbContext.Messages.Add(message);
            await _dbContext.SaveChangesAsync();

            _logger.LogInformation($"[ChatService] Private message {message.Id} from '{message.FromUser}' to '{message.ToUser}' saved to DB with status '{message.Status}'.");
        }

        public async Task MarkPrivateMessagesAsReadAsync(string sender, string reader)
        {
            _logger.LogInformation($"[ChatService] Attempting to mark messages from {sender} as read by {reader}.");

            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var messagesToUpdate = await _dbContext.Messages
                .Where(m => m.FromUser == sender && m.ToUser == reader && m.Status != "read")
                .ToListAsync();

            if (messagesToUpdate.Any())
            {
                foreach (var message in messagesToUpdate)
                {
                    string oldStatus = message.Status;
                    message.Status = "read";
                    _logger.LogDebug($"[ChatService] DB Update: Private message {message.Id} status changed from {oldStatus} to 'read'.");
                }
                await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext
                _logger.LogInformation($"[ChatService] {messagesToUpdate.Count} private messages from {sender} to {reader} marked as 'read' in DB.");

                var senderConnectionId = await GetConnectionIdByUserAsync(sender);
                if (senderConnectionId != null)
                {
                    foreach (var message in messagesToUpdate)
                    {
                        await _hubContext.Clients.Client(senderConnectionId).SendAsync("MessageStatusUpdated", message.Id, "read", reader);
                        _logger.LogDebug($"[ChatService] SignalR Sent: MessageStatusUpdated for private message {message.Id} to 'read' to sender {sender} (ConnId: {senderConnectionId})");
                    }
                }
                else
                {
                    _logger.LogWarning($"[ChatService] SignalR NOT Sent: Sender connection ID not found for private chat {sender}. Could not notify about 'read' status.");
                }

                var readerConnectionId = await GetConnectionIdByUserAsync(reader);
                if (readerConnectionId != null && readerConnectionId != senderConnectionId)
                {
                    foreach (var message in messagesToUpdate)
                    {
                        await _hubContext.Clients.Client(readerConnectionId).SendAsync("MessageStatusUpdated", message.Id, "read", sender);
                        _logger.LogDebug($"[ChatService] SignalR Sent: MessageStatusUpdated for private message {message.Id} to 'read' to reader {reader} (ConnId: {readerConnectionId})");
                    }
                }
            }
            else
            {
                _logger.LogInformation($"[ChatService] No private messages from {sender} to {reader} to mark as read, or already read.");
            }
        }

        // НОВИЙ МЕТОД: Позначити ОДНЕ глобальне повідомлення як прочитане
        public async Task MarkSingleGlobalMessageAsReadAsync(string messageId, string readerUserName)
        {
            _logger.LogInformation($"[ChatService] Attempting to mark global message {messageId} as read by {readerUserName}.");

            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var message = await _dbContext.Messages
                .FirstOrDefaultAsync(m => m.Id == messageId && (m.ToUser == null || m.ToUser == "GlobalChat"));

            // Перевіряємо, чи існує повідомлення, чи воно не від поточного користувача і не є прочитаним
            if (message != null && message.FromUser != readerUserName && message.Status != "read")
            {
                string oldStatus = message.Status;
                message.Status = "read";
                await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext

                _logger.LogInformation($"[ChatService] Global message {messageId} status changed from {oldStatus} to 'read' by user {readerUserName}.");

                // ✅ КЛЮЧОВА ЗМІНА: Надсилаємо подію до ВСІХ клієнтів
                // Використовуємо Clients.All.SendAsync, щоб повідомити всіх учасників чату
                // Використовуємо правильну назву події "GlobalMessagesStatusUpdated"
                var messageIds = new List<string> { messageId };
                await _hubContext.Clients.All.SendAsync("GlobalMessagesStatusUpdated", messageIds, "read");

                _logger.LogDebug($"[ChatService] SignalR Sent: GlobalMessagesStatusUpdated for message {messageId} to all clients.");
            }
            else
            {
                _logger.LogInformation($"[ChatService] Global message {messageId} not found, sent by current user, or already marked as read. No update needed.");
            }
        }

        public async Task MarkGlobalMessagesAsRead(IEnumerable<string> messageIds, string userName)
        {
            // Отримуємо повідомлення, які треба оновити
            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var messagesToUpdate = await _dbContext.Messages
                .Where(m => messageIds.Contains(m.Id) && m.Status == "delivered")
                .ToListAsync();

            foreach (var message in messagesToUpdate)
            {
                message.Status = "read";
                _dbContext.Entry(message).State = EntityState.Modified; // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            }

            await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext
        }


        // У вашому ChatService.cs
        public async Task<List<MessageDto>> MarkAllGlobalMessagesAsReadAsync(string readerUserName)
        {
            _logger.LogInformation($"[ChatService] Attempting to mark all global messages as read for {readerUserName}.");

            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var messagesToUpdate = await _dbContext.Messages
                .Where(m => m.ToUser == null
                             && m.FromUser != readerUserName
                             && m.Status != "read")
                .ToListAsync();

            if (!messagesToUpdate.Any())
            {
                _logger.LogInformation($"[ChatService] No global messages to mark as read for {readerUserName}.");
                return new List<MessageDto>();
            }

            _logger.LogInformation($"[ChatService] Found {messagesToUpdate.Count} global messages to update for {readerUserName}.");

            var updatedMessageDtos = new List<MessageDto>();

            foreach (var message in messagesToUpdate)
            {
                message.Status = "read";
                updatedMessageDtos.Add(new MessageDto
                {
                    Id = message.Id,
                    From = message.FromUser,
                    To = message.ToUser,
                    Content = message.Content,
                    Timestamp = message.Timestamp,
                    Status = message.Status,
                    Edited = message.Edited
                });
                _logger.LogDebug($"[ChatService] DB Update: Global message {message.Id} status changed to 'read'.");
            }

            await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            _logger.LogInformation($"[ChatService] DB Update: All global messages marked as 'read' for {readerUserName}.");

            if (updatedMessageDtos.Any())
            {
                var messageIds = updatedMessageDtos.Select(m => m.Id).ToList();
                await _hubContext.Clients.All.SendAsync("GlobalMessagesStatusUpdated", messageIds, "read");
                _logger.LogInformation($"[ChatService] SignalR Sent: GlobalMessagesStatusUpdated to all clients for {messageIds.Count} messages.");
            }

            return updatedMessageDtos;
        }

        // ChatService.cs
        public async Task<List<MessageDto>> GetGlobalMessagesAsync()
        {
            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var messages = await _dbContext.Messages
                // ✅ ВИПРАВЛЕНО: Додаємо умову для 'GlobalChat'
                .Where(m => m.ToUser == null || m.ToUser == "GlobalChat")
                .OrderByDescending(m => m.Timestamp)
                .Take(100)
                .Select(m => new MessageDto
                {
                    Id = m.Id,
                    From = m.FromUser,
                    To = m.ToUser,
                    Content = m.Content,
                    IV = m.IV,              // ✅ ДОДАЙТЕ
                    Salt = m.Salt,          // ✅ ДОДАЙТЕ
                    Timestamp = m.Timestamp,
                    Status = m.Status,
                    Edited = m.Edited,

                    // Ці поля завжди коректно повертаються, коли повідомлення знайдено
                    IsFile = m.IsFile,
                    FileName = m.FileName,
                    ParentMessageId = m.ParentMessageId
                })
                .ToListAsync();

            // Повертаємо повідомлення у правильному порядку (від найстаріших до найновіших)
            return messages.OrderBy(m => m.Timestamp).ToList();
        }

        public async Task UpdateMessageStatusAsync(string messageId, string status)
        {
            _logger.LogInformation($"[ChatService] Attempting to update status for message {messageId} to '{status}'.");
            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var message = await _dbContext.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
            if (message != null && message.Status != status)
            {
                string oldStatus = message.Status;
                message.Status = status;
                await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext

                _logger.LogInformation($"[ChatService] DB Update: Message {message.Id} status changed from {oldStatus} to {status}");

                var senderConnectionId = await GetConnectionIdByUserAsync(message.FromUser);
                if (senderConnectionId != null)
                {
                    await _hubContext.Clients.Client(senderConnectionId).SendAsync("MessageStatusUpdated", message.Id, status, message.ToUser);
                    _logger.LogDebug($"[ChatService] SignalR Sent: MessageStatusUpdated for {message.Id} to '{status}' to sender {message.FromUser} (ConnId: {senderConnectionId})");
                }
                else
                {
                    _logger.LogWarning($"[ChatService] SignalR NOT Sent: Sender connection ID not found for {message.FromUser} (MessageId: {message.Id}).");
                }

                if (!string.IsNullOrEmpty(message.ToUser) && (status == "delivered" || status == "read"))
                {
                    var receiverConnectionId = await GetConnectionIdByUserAsync(message.ToUser);
                    if (receiverConnectionId != null && receiverConnectionId != senderConnectionId)
                    {
                        await _hubContext.Clients.Client(receiverConnectionId).SendAsync("MessageStatusUpdated", message.Id, status, message.FromUser);
                        _logger.LogDebug($"[ChatService] SignalR Sent: MessageStatusUpdated for {message.Id} to '{status}' to receiver {message.ToUser} (ConnId: {receiverConnectionId})");
                    }
                    else if (receiverConnectionId == null)
                    {
                        _logger.LogWarning($"[ChatService] SignalR NOT Sent: Receiver connection ID not found for {message.ToUser} (MessageId: {message.Id}).");
                    }
                }
            }
            else if (message != null)
            {
                _logger.LogInformation($"[ChatService] Message {messageId} already has status '{status}'. No update needed.");
            }
            else
            {
                _logger.LogWarning($"[ChatService] Message {messageId} not found for status update.");
            }
        }

        public async Task<List<MessageDto>> GetChatHistoryAsync(string currentUser, string? otherUser = null)
        {
            IQueryable<Message> query = _dbContext.Messages;

            if (string.IsNullOrEmpty(otherUser) || otherUser == "GlobalChat")
            {
                query = query.Where(m => m.ToUser == null || m.ToUser == "GlobalChat");
                _logger.LogInformation($"[ChatService] Getting global chat history for user {currentUser}.");
            }
            else
            {
                query = query.Where(m =>
                    (m.FromUser == currentUser && m.ToUser == otherUser) ||
                    (m.FromUser == otherUser && m.ToUser == currentUser)
                );
                _logger.LogInformation($"[ChatService] Getting private chat history between {currentUser} and {otherUser}.");
            }

            // ✅ ВИПРАВЛЕННЯ: Проекція на MessageDto з IV та Salt
            var messages = await query
                .OrderBy(m => m.Timestamp)
                .Select(m => new MessageDto
                {
                    Id = m.Id,
                    From = m.FromUser,
                    To = m.ToUser,
                    Content = m.Content,
                    IV = m.IV,              // ✅ ДОДАНО
                    Salt = m.Salt,          // ✅ ДОДАНО
                    Timestamp = m.Timestamp,
                    Status = m.Status,
                    Edited = m.Edited,
                    IsFile = m.IsFile,
                    FileName = m.FileName,
                    ParentMessageId = m.ParentMessageId,
                    TempId = m.TempId
                })
                .ToListAsync();

            _logger.LogInformation($"[ChatService] Loaded {messages.Count} messages with IV/Salt.");
            return messages;
        }

        #region Видалення Повідомлень

        public async Task<bool> DeleteGlobalMessageAsync(string messageId, string deleterUserName)
        {
            _logger.LogInformation($"[ChatService] Attempting to delete global message {messageId} by user {deleterUserName}.");

            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var message = await _dbContext.Messages
                .FirstOrDefaultAsync(m => m.Id == messageId && (m.ToUser == null || m.ToUser == "GlobalChat"));

            if (message == null)
            {
                _logger.LogWarning($"[ChatService] Global message {messageId} not found for deletion by {deleterUserName}.");
                return false;
            }

            if (message.FromUser != deleterUserName)
            {
                _logger.LogWarning($"[ChatService] Unauthorized deletion attempt: User {deleterUserName} tried to delete global message {messageId} sent by {message.FromUser}.");
                return false;
            }

            _dbContext.Messages.Remove(message); // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            await _dbContext.SaveChangesAsync(); // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            _logger.LogInformation($"[ChatService] DB Delete: Global message {messageId} successfully deleted by {deleterUserName}.");
            return true;
        }

        // src/Api/Services/ChatService.cs

        public async Task<bool> DeletePrivateMessageAsync(string messageId, string deleterUserName, string targetUser)
        {
            _logger.LogInformation($"[ChatService] Attempting to delete private message {messageId} by {deleterUserName} to {targetUser}.");

            // 1. ПОШУК: Використовуємо string messageId для порівняння з m.Id (який тепер string)
            var message = await _dbContext.Messages
                // ✅ string m.Id == string messageId
                .FirstOrDefaultAsync(m => m.Id == messageId &&
                                         ((m.FromUser == deleterUserName && m.ToUser == targetUser) ||
                                          (m.FromUser == targetUser && m.ToUser == deleterUserName)));

            if (message == null)
            {
                _logger.LogWarning($"[ChatService] Private message with ID {messageId} not found or user is unauthorized.");
                return false;
            }

            // 2. ПЕРЕВІРКА ПРАВ: 
            if (message.FromUser != deleterUserName)
            {
                _logger.LogWarning($"[ChatService] Unauthorized deletion attempt: User {deleterUserName} tried to delete private message {messageId} sent by {message.FromUser}.");
                return false;
            }

            // 3. ВИДАЛЕННЯ:
            _dbContext.Messages.Remove(message);
            await _dbContext.SaveChangesAsync();
            _logger.LogInformation($"[ChatService] DB Delete: Private message {message.Id} successfully deleted by {deleterUserName}.");

            return true;
        }

        #endregion

        public async Task<Message?> GetMessageById(string messageId)
        {
            _logger.LogInformation($"[ChatService] Attempting to retrieve message with ID: {messageId}");
            // ✅ ВИПРАВЛЕНО: _context -> _dbContext
            var message = await _dbContext.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
            if (message == null)
            {
                _logger.LogWarning($"[ChatService] Message with ID {messageId} not found.");
            }
            else
            {
                _logger.LogInformation($"[ChatService] Message with ID {messageId} retrieved successfully.");
            }
            return message;
        }

        public async Task UpdateMessageContent(string messageId, string newEncryptedContent, string iv, string salt, string userName)
        {
            _logger.LogInformation($"[ChatService] UpdateMessageContent called:");
            _logger.LogInformation($"  - Message ID: {messageId}");
            _logger.LogInformation($"  - User: {userName}");
            _logger.LogInformation($"  - New IV length: {iv?.Length ?? 0}");
            _logger.LogInformation($"  - New Salt length: {salt?.Length ?? 0}");
            _logger.LogInformation($"  - Content length: {newEncryptedContent?.Length ?? 0}");

            var message = await _dbContext.Messages.FirstOrDefaultAsync(m => m.Id == messageId);

            if (message == null)
            {
                _logger.LogWarning($"[ChatService] Message {messageId} not found for content update.");
                throw new InvalidOperationException($"Message with ID {messageId} not found.");
            }

            // Перевірка авторства
            if (message.FromUser != userName)
            {
                _logger.LogWarning($"[ChatService] User {userName} attempted to edit message {messageId} which belongs to {message.FromUser}.");
                throw new UnauthorizedAccessException($"User {userName} is not authorized to edit message {messageId}.");
            }

            // ✅ КРИТИЧНО: Оновлюємо всі три поля
            message.Content = newEncryptedContent;
            message.IV = iv ?? string.Empty;
            message.Salt = salt ?? string.Empty;
            message.Edited = true;

            await _dbContext.SaveChangesAsync();

            _logger.LogInformation($"[ChatService] Message {messageId} updated successfully:");
            _logger.LogInformation($"  - New IV stored: '{message.IV.Substring(0, Math.Min(20, message.IV.Length))}...'");
            _logger.LogInformation($"  - New Salt stored: '{message.Salt.Substring(0, Math.Min(20, message.Salt.Length))}...'");
            _logger.LogInformation($"  - Edited flag: {message.Edited}");
        }
    }
}
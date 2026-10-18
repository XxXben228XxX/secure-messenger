using Api.Dtos;
using Microsoft.AspNetCore.SignalR;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using Api.Services;
using Api.Models;
using System.Security.Claims;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Authorization;

[Authorize]
public class ChatHub : Hub
{
    private readonly ChatService _chatService;
    private readonly IUserService _userService;
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(ChatService chatService, IUserService userService, ILogger<ChatHub> logger)
    {
        _chatService = chatService;
        _userService = userService;
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        string? userName = Context.User?.Identity?.Name;
        string connectionId = Context.ConnectionId;

        _logger.LogInformation($"[ChatHub] OnConnectedAsync: ConnectionId={connectionId}");

        if (!string.IsNullOrEmpty(userName))
        {
            try
            {
                _logger.LogInformation($"[ChatHub] Authenticated user '{userName}' connected with ConnectionId: {connectionId}");
                await _userService.SetUserConnectionIdAsync(userName, connectionId);
                await Groups.AddToGroupAsync(connectionId, "Come2Chat");
                
                await DisplayOnlineUsers();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[ChatHub] Error during OnConnectedAsync for user '{userName}' (Connection ID: {connectionId}).");
                // Optionally, inform the caller about the error, but be careful not to reveal sensitive info.
                await Clients.Caller.SendAsync("ReceiveError", "An error occurred during connection initialization.");
            }
        }
        else
        {
            _logger.LogError($"[ChatHub] ERROR: Unauthenticated user attempted to connect to authenticated hub. ConnectionId: {connectionId}. Disconnecting.");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized: Connection refused. Please log in.");
            Context.Abort(); // Abort the connection for unauthenticated users
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        string connectionId = Context.ConnectionId;
        string? userName = Context.User?.Identity?.Name;

        _logger.LogInformation($"[ChatHub] OnDisconnectedAsync: ConnectionId={connectionId}, User={userName ?? "Unknown"}");

        if (!string.IsNullOrEmpty(userName))
        {
            try
            {
                var user = await _userService.GetUserByNameAsync(userName);
                if (user != null)
                {
                    // Only mark offline if the disconnected connection ID matches the one stored for the user
                    if (user.ConnectionId == connectionId)
                    {
                        user.IsOnline = false;
                        user.ConnectionId = null;
                        await _userService.UpdateUserAsync(user);
                        _logger.LogInformation($"[ChatHub] User '{userName}' marked as offline. ConnectionId: {connectionId}.");
                    }
                    else
                    {
                        _logger.LogWarning($"[ChatHub] User '{userName}' disconnected from ConnectionId {connectionId}, but their active ConnectionId is {user.ConnectionId}. Status not changed as it might be an old connection.");
                    }
                }
                else
                {
                    _logger.LogWarning($"[ChatHub] User not found by name '{userName}' during disconnection of ConnectionId {connectionId}. This might indicate a data inconsistency or an issue with user lookup.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[ChatHub] Error during OnDisconnectedAsync for user '{userName}' (Connection ID: {connectionId}).");
            }
        }
        else
        {
            _logger.LogWarning($"[ChatHub] Unauthenticated user disconnected. ConnectionId: {connectionId}.");
        }

        try
        {
            await Groups.RemoveFromGroupAsync(connectionId, "Come2Chat");
            await DisplayOnlineUsers();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error during group operations in OnDisconnectedAsync for ConnectionId {connectionId}.");
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task AddUserConnectionId(string name)
    {
        string? currentConnectedUser = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(currentConnectedUser) || currentConnectedUser != name)
        {
            _logger.LogWarning($"[ChatHub] SECURITY ALERT: User '{currentConnectedUser ?? "N/A"}' attempting to set connection for '{name}'. Denied.");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized operation. Authenticated user does not match requested user.");
            return;
        }

        try
        {
            var user = await _userService.GetUserByNameAsync(name);
            if (user != null)
            {
                await _userService.SetUserConnectionIdAsync(name, Context.ConnectionId);
                _logger.LogInformation($"[ChatHub] Explicitly added/updated connection ID for user {name}: {Context.ConnectionId}");
                await DisplayOnlineUsers();
            }
            else
            {
                _logger.LogWarning($"[ChatHub] User not found: '{name}' for AddUserConnectionId call. This should not happen if authentication is working correctly.");
                await Clients.Caller.SendAsync("ReceiveError", "User not found for connection ID update.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error in AddUserConnectionId for user {name}.");
            await Clients.Caller.SendAsync("ReceiveError", "An error occurred while updating connection ID.");
        }
    }

    // ChatHub.cs
    [HubMethodName("SendMessage")]
    public async Task SendMessage(MessageDto messageDto)
    {
        string? senderUserName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(senderUserName) || !senderUserName.Equals(messageDto.From, StringComparison.OrdinalIgnoreCase) || !_chatService.IsUserHashValid(messageDto.UserHash, senderUserName, messageDto.UserHashTimestamp))
        {
            _logger.LogWarning($"[ChatHub] Unauthorized SendMessage attempt from '{messageDto.From}' for user '{senderUserName}'. User hash is invalid.");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized message sender or invalid user hash.");
            return;
        }

        // 1. Якщо немає ID, генеруємо новий
        if (string.IsNullOrEmpty(messageDto.Id))
        {
            messageDto.Id = Guid.NewGuid().ToString();
            _logger.LogDebug($"[ChatHub] Generated new ID for message: {messageDto.Id}");
        }

        messageDto.To = null;
        messageDto.Timestamp = DateTime.UtcNow;
        messageDto.Edited = false;
        messageDto.Status = "delivered";

        try
        {
            // 2. Зберігаємо повідомлення в базі даних
            await _chatService.SaveMessageAsync(messageDto);

            // 3. Отримуємо щойно збережене повідомлення з бази
            var savedMessage = await _chatService.GetMessageById(messageDto.Id);

            if (savedMessage != null)
            {
                _logger.LogInformation($"[ChatHub] Content from DB for message {savedMessage.Id}: {savedMessage.Content}");

                // ✅ ВИПРАВЛЕНО: Створюємо анонімний об'єкт з IV та Salt
                var messageToSend = new
                {
                    id = savedMessage.Id,
                    from = savedMessage.FromUser,
                    to = savedMessage.ToUser,
                    content = savedMessage.Content,
                    IV = savedMessage.IV,              // ✅ Велика літера
                    Salt = savedMessage.Salt,          // ✅ Велика літера
                    timestamp = savedMessage.Timestamp,
                    status = savedMessage.Status,
                    edited = savedMessage.Edited,
                    isFile = savedMessage.IsFile,
                    fileName = savedMessage.FileName,
                    parentMessageId = savedMessage.ParentMessageId,
                    tempId = savedMessage.TempId
                };

                // 4. Надсилаємо об'єкт з IV та Salt всім клієнтам
                await Clients.Group("Come2Chat").SendAsync("NewMessage", messageToSend);

                _logger.LogInformation($"[ChatHub] Global message {savedMessage.Id} sent to 'Chat' group with IV and Salt.");
            }
            else
            {
                _logger.LogError($"[ChatHub] Failed to retrieve saved message from DB for ID: {messageDto.Id}.");
                await Clients.Caller.SendAsync("ReceiveError", "An error occurred while retrieving the saved message.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error sending public message {messageDto.Id} from {messageDto.From}.");
            await Clients.Caller.SendAsync("ReceiveError", "Failed to send message due to server error.");
            await Clients.Caller.SendAsync("MessageStatusUpdated", messageDto.Id, "error", messageDto.From);
        }
    }

    // This method is commented out as per your previous intention to disable 'read' functionality.
    // If you decide to re-enable, uncomment and implement the logic in ChatService.
    // ChatHub.cs

    // У вашому ChatHub.cs

    public async Task MarkAllGlobalMessagesAsRead()
    {
        string? readerUserName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(readerUserName))
        {
            _logger.LogWarning("[ChatHub] Warning: MarkAllGlobalMessagesAsRead called by unauthenticated user.");
            return;
        }

        _logger.LogInformation($"[ChatHub] MarkAllGlobalMessagesAsRead called by {readerUserName}.");

        try
        {
            // Вся логіка оновлення бази даних і надсилання сповіщень
            // перенесена в ChatService, щоб уникнути дублювання.
            // Тому тут достатньо просто викликати метод.
            await _chatService.MarkAllGlobalMessagesAsReadAsync(readerUserName);
            _logger.LogInformation($"[ChatHub] All global messages successfully marked as read for {readerUserName}.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error marking all global messages as read for {readerUserName}.");
            await Clients.Caller.SendAsync("ReceiveError", "Failed to mark messages as read due to server error.");
        }
    }


    public async Task CreatePrivateChat(MessageDto messageDto)
    {
        string? senderUserName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(senderUserName) || senderUserName != messageDto.From)
        {
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized private chat creation or missing authentication.");
            _logger.LogWarning($"[ChatHub] Unauthorized CreatePrivateChat attempt from '{messageDto.From}' (authenticated as '{senderUserName ?? "None"}').");
            return;
        }

        if (string.IsNullOrEmpty(messageDto.To))
        {
            await Clients.Caller.SendAsync("ReceiveError", "Private chat initiation requires a recipient.");
            _logger.LogWarning($"[ChatHub] CreatePrivateChat from '{messageDto.From}' failed: no recipient specified.");
            return;
        }

        messageDto.Timestamp = DateTime.UtcNow;
        messageDto.Status = "sent";
        messageDto.Edited = false;

        try
        {
            await _chatService.SavePrivateMessageAsync(messageDto);

            var toConnectionId = await _userService.GetConnectionIdByUserAsync(messageDto.To);
            string privateGroupName = GetPrivateGroupName(messageDto.From, messageDto.To);

            // Add both sender and receiver to the private group
            await Groups.AddToGroupAsync(Context.ConnectionId, privateGroupName);
            _logger.LogInformation($"[ChatHub] Sender '{messageDto.From}' added to private group '{privateGroupName}'.");

            if (toConnectionId != null)
            {
                await Groups.AddToGroupAsync(toConnectionId, privateGroupName);
                _logger.LogInformation($"[ChatHub] Receiver '{messageDto.To}' (ConnectionId: {toConnectionId}) added to private group '{privateGroupName}'.");

                await Clients.Group(privateGroupName).SendAsync("NewPrivateMessage", messageDto);
                _logger.LogInformation($"[ChatHub] Sent NewPrivateMessage to private group '{privateGroupName}' for message {messageDto.Id}.");

                await _chatService.UpdateMessageStatusAsync(messageDto.Id, "delivered");
                await Clients.Caller.SendAsync("MessageStatusUpdated", messageDto.Id, "delivered", messageDto.To);
                _logger.LogInformation($"[ChatHub] Private message {messageDto.Id} marked as 'delivered' after sending.");
            }
            else
            {
                // Receiver is offline, send to sender and notify them
                await Clients.Caller.SendAsync("MessageSentPending", messageDto.Id, messageDto.To, "User offline, message will be delivered when online.");
                _logger.LogInformation($"[ChatHub] Private message from '{messageDto.From}' to '{messageDto.To}' (offline) with ID '{messageDto.Id}'. Status 'sent'.");
                await Clients.Caller.SendAsync("NewPrivateMessage", messageDto); // Send to self so sender sees it immediately as 'sent'
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error creating private chat/sending message {messageDto.Id} from {messageDto.From} to {messageDto.To}.");
            await Clients.Caller.SendAsync("ReceiveError", "Failed to send private message due to server error.");
            await Clients.Caller.SendAsync("MessageStatusUpdated", messageDto.Id, "error");
        }
    }

    // src/Api/Hubs/ChatHub.cs

    // ChatHub.cs - Виправлений метод SendPrivateMessage

    [HubMethodName("SendPrivateMessage")]
    public async Task SendPrivateMessage(MessageDto messageDto)
    {
        string? senderUserName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(senderUserName) || senderUserName != messageDto.From)
        {
            _logger.LogWarning($"[ChatHub] Unauthorized SendPrivateMessage attempt from '{messageDto.From}' (authenticated as '{senderUserName ?? "None"}').");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized private message sender or missing authentication.");
            return;
        }
        if (string.IsNullOrEmpty(messageDto.To))
        {
            _logger.LogWarning($"[ChatHub] Private message from '{messageDto.From}' missing recipient.");
            await Clients.Caller.SendAsync("ReceiveError", "Private message must have a recipient.");
            return;
        }

        // Встановлюємо початкові властивості повідомлення
        messageDto.Timestamp = DateTime.UtcNow;
        messageDto.Status = "sent";
        messageDto.Edited = false;

        try
        {
            // ✅ КРИТИЧНО: Клієнт вже надіслав зашифрований контент з IV та Salt
            // Тому ми просто зберігаємо повідомлення БЕЗ додаткового шифрування
            await _chatService.SavePrivateMessageAsync(messageDto);

            // 2. Отримуємо збережене повідомлення з БД
            var savedMessage = await _chatService.GetMessageById(messageDto.Id);
            if (savedMessage == null)
            {
                _logger.LogError($"[ChatHub] Failed to retrieve saved private message from DB for ID: {messageDto.Id}.");
                await Clients.Caller.SendAsync("ReceiveError", "An error occurred while retrieving the saved private message.");
                return;
            }

            var receiverConnectionId = await _userService.GetConnectionIdByUserAsync(savedMessage.ToUser);
            string privateGroupName = GetPrivateGroupName(savedMessage.FromUser, savedMessage.ToUser);

            // 3. Додаємо відправника до приватної групи
            await Groups.AddToGroupAsync(Context.ConnectionId, privateGroupName);
            _logger.LogInformation($"[ChatHub] Sender '{savedMessage.FromUser}' added to private group '{privateGroupName}'.");

            if (receiverConnectionId != null)
            {
                // 4. Якщо одержувач онлайн, додаємо його до групи
                await Groups.AddToGroupAsync(receiverConnectionId, privateGroupName);
                _logger.LogInformation($"[ChatHub] Receiver '{savedMessage.ToUser}' (ConnectionId: {receiverConnectionId}) added to private group '{privateGroupName}'.");

                // 5. Надсилаємо збережене повідомлення обом учасникам групи
                await Clients.Group(privateGroupName).SendAsync("NewPrivateMessage", savedMessage);
                _logger.LogInformation($"[ChatHub] Sent NewPrivateMessage to private group '{privateGroupName}' for message {savedMessage.Id}.");

                // 6. Оновлюємо статус на "delivered" і повідомляємо відправника
                await _chatService.UpdateMessageStatusAsync(savedMessage.Id, "delivered");
                _logger.LogInformation($"[ChatHub] Private message {savedMessage.Id} marked as 'delivered'.");
                await Clients.Caller.SendAsync("MessageStatusUpdated", savedMessage.Id, "delivered", savedMessage.ToUser);
            }
            else
            {
                // 7. Якщо одержувач офлайн, просто повідомляємо відправника
                await Clients.Caller.SendAsync("MessageSentPending", savedMessage.Id, savedMessage.ToUser, "User is offline. Message will be delivered when online.");
                _logger.LogInformation($"[ChatHub] Private message from '{savedMessage.FromUser}' to '{savedMessage.ToUser}' (offline) with ID '{savedMessage.Id}'. Status 'sent'.");
                await Clients.Caller.SendAsync("NewPrivateMessage", savedMessage);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error sending private message {messageDto.Id} from {messageDto.From} to {messageDto.To}.");
            await Clients.Caller.SendAsync("ReceiveError", "Failed to send private message due to server error.");
            await Clients.Caller.SendAsync("MessageStatusUpdated", messageDto.Id, "error");
        }
    }

    public async Task RemovePrivateChat(string closingUser, string otherUser)
    {
        string? currentUser = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(currentUser) || currentUser != closingUser)
        {
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized operation. Current authenticated user does not match closing user.");
            _logger.LogWarning($"[ChatHub] Unauthorized RemovePrivateChat attempt. Authenticated: {currentUser ?? "None"}, Requested closing user: {closingUser}.");
            return;
        }

        string privateGroupName = GetPrivateGroupName(closingUser, otherUser);
        try
        {
            // Remove the caller from the private group
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, privateGroupName);
            _logger.LogInformation($"[ChatHub] User '{closingUser}' (ConnectionId: {Context.ConnectionId}) removed from private group '{privateGroupName}'.");

            var otherUserConnectionId = await _userService.GetConnectionIdByUserAsync(otherUser);

            if (otherUserConnectionId != null)
            {
                await Clients.Client(otherUserConnectionId).SendAsync("PrivateChatClosed", closingUser, otherUser);
                await Groups.RemoveFromGroupAsync(otherUserConnectionId, privateGroupName);
                _logger.LogInformation($"[ChatHub] Private chat with {otherUser} closed by {closingUser}. Notified {otherUser} and removed from group.");
            }
            else
            {
                _logger.LogInformation($"[ChatHub] Private chat with {otherUser} closed by {closingUser}, but {otherUser} is offline. No notification sent to {otherUser}.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error removing private chat for {closingUser} and {otherUser}.");
            await Clients.Caller.SendAsync("ReceiveError", "An error occurred while closing the private chat.");
        }
    }

    // This method is commented out as per your previous intention to disable 'read' functionality.
    // If you decide to re-enable, uncomment and implement the logic in ChatService.

    public async Task MarkMessagesAsRead(string otherUser)
    {
        string? reader = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(reader))
        {
            _logger.LogWarning("[ChatHub] Warning: MarkMessagesAsRead called by unauthenticated user. This should not happen if RequireAuthorization() is set.");
            return;
        }
        _logger.LogInformation($"[ChatHub] MarkMessagesAsRead: Reader={reader}, OtherUser={otherUser}");
        try
        {
            // Розкоментуйте цей рядок, щоб увімкнути функціонал
            await _chatService.MarkPrivateMessagesAsReadAsync(otherUser, reader);

            // Повідомляємо клієнтів про оновлення статусу
            // Це опціонально, але корисно для синхронізації UI
            // Повідомляємо "читача" (поточного користувача)
            await Clients.Caller.SendAsync("MessagesMarkedAsRead", otherUser);

            // Повідомляємо "іншого користувача" (відправника повідомлень)
            var otherUserConnectionId = await _userService.GetConnectionIdByUserAsync(otherUser);
            if (!string.IsNullOrEmpty(otherUserConnectionId))
            {
                await Clients.Client(otherUserConnectionId).SendAsync("MessagesMarkedAsRead", reader);
            }

            _logger.LogInformation($"[ChatHub] Private messages between {reader} and {otherUser} marked as read.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error marking private messages as read by {reader} for {otherUser}.");
            await Clients.Caller.SendAsync("ReceiveError", "Failed to mark messages as read due to server error.");
        }
    }

    public async Task MarkSingleGlobalMessageAsRead(string messageId)
    {
        var httpContext = Context.GetHttpContext();
        var userName = httpContext?.User.Identity?.Name;
        if (string.IsNullOrEmpty(userName))
        {
            throw new HubException("User is not authenticated.");
        }
        await _chatService.MarkSingleGlobalMessageAsReadAsync(messageId, userName);
    }

    [HubMethodName("MarkMultipleGlobalMessagesAsRead")]
    public async Task MarkMultipleGlobalMessagesAsRead(List<string> messageIds)
    {
        var userName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userName))
        {
            _logger.LogWarning("[ChatHub] Unauthorized attempt to mark multiple messages as read.");
            return;
        }

        _logger.LogInformation($"[ChatHub] User '{userName}' attempting to mark {messageIds.Count} messages as read.");

        try
        {
            // 1. Позначити повідомлення як прочитані в базі даних.
            await _chatService.MarkGlobalMessagesAsRead(messageIds, userName);

            // 2. Оновити статус повідомлень для ВСІХ клієнтів.
            await Clients.All.SendAsync("GlobalMessagesStatusUpdated", messageIds, "read");
            _logger.LogInformation($"[ChatHub] Status for messages '{string.Join(", ", messageIds)}' updated to 'read' for all clients.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error marking multiple global messages as read for user '{userName}'.");
            await Clients.Caller.SendAsync("ReceiveError", "An error occurred while marking messages as read.");
        }
    }

    // ChatHub.cs

    private async Task DisplayOnlineUsers()
    {
        try
        {
            var onlineUsers = await _userService.GetOnlineUserNamesAsync();
            await Clients.Group("Come2Chat").SendAsync("OnlineUsers", onlineUsers);
            _logger.LogInformation($"[ChatHub] Online users updated. Current online: {string.Join(", ", onlineUsers)}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ChatHub] Error displaying online users.");
            // No direct client notification needed here as it's a background update for all.
        }
    }

    private string GetPrivateGroupName(string user1, string user2)
    {
        // Ensures consistent group name regardless of sender/receiver order
        return string.CompareOrdinal(user1, user2) < 0 ? $"{user1}-{user2}" : $"{user2}-{user1}";
    }

    // --- START OF ADDED METHODS (ChatService calls) ---
    [HubMethodName("EditGlobalMessage")]
    public async Task EditGlobalMessage(string messageId, string newContent, string iv, string salt)
    {
        var userName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userName))
        {
            _logger.LogWarning($"[ChatHub] Unauthorized edit global message attempt for ID: {messageId} (no authenticated user).");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized: User not authenticated.");
            throw new HubException("User is not authenticated.");
        }

        _logger.LogInformation($"[ChatHub] EditGlobalMessage: ID={messageId}, NewContent (encrypted)='{(newContent.Length > 50 ? newContent[..50] + "..." : newContent)}', FromUser={userName}");
        _logger.LogInformation($"[ChatHub] Received IV length: {iv?.Length ?? 0}, Salt length: {salt?.Length ?? 0}");

        try
        {
            var originalMessageDto = await _chatService.GetMessageById(messageId);
            if (originalMessageDto == null)
            {
                _logger.LogWarning($"[ChatHub] Global message {messageId} not found for editing by {userName}.");
                await Clients.Caller.SendAsync("ReceiveError", "Edit failed: Message not found.");
                throw new HubException("Message not found.");
            }

            // Ensure it's a global message and the current user is the sender
            if (originalMessageDto.ToUser != null || originalMessageDto.FromUser != userName)
            {
                _logger.LogWarning($"[ChatHub] User {userName} attempted to edit global message {messageId} which is not theirs or is a private message (To is not null).");
                await Clients.Caller.SendAsync("ReceiveError", "Edit failed: You can only edit your own global messages.");
                throw new HubException("You can only edit your own global messages.");
            }

            // ✅ КРИТИЧНО: Оновлюємо Content, IV та Salt в базі даних
            await _chatService.UpdateMessageContent(messageId, newContent, iv, salt, userName);

            // Get the updated message DTO to send to clients
            var updatedMessageDto = await _chatService.GetMessageById(messageId);
            if (updatedMessageDto != null)
            {
                // ✅ Переконуємося, що відправляємо оновлені IV та Salt клієнтам
                _logger.LogInformation($"[ChatHub] Sending MessageEdited with IV: {updatedMessageDto.IV?.Substring(0, 20)}..., Salt: {updatedMessageDto.Salt?.Substring(0, 20)}...");

                await Clients.All.SendAsync("MessageEdited", updatedMessageDto);
                _logger.LogInformation($"[ChatHub] MessageEdited sent to all for global message ID: {messageId}.");
            }
            else
            {
                _logger.LogError($"[ChatHub] Failed to retrieve updated message DTO for global message {messageId} after successful update.");
                await Clients.Caller.SendAsync("ReceiveError", "An unexpected error occurred after editing the message.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error editing global message {messageId}: {ex.Message}");
            await Clients.Caller.SendAsync("MessageError", messageId, "Global", $"Failed to edit message: {ex.Message}");
            throw new HubException($"Failed to edit message: {ex.Message}");
        }
    }

    // src/Api/Hubs/ChatHub.cs

    [HubMethodName("EditPrivateMessage")]
    public async Task EditPrivateMessage(string messageId, string newContent, string iv, string salt, string recipientUserName)
    {
        var userName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userName))
        {
            _logger.LogWarning($"[ChatHub] Unauthorized edit private message attempt for ID: {messageId} to {recipientUserName} (no authenticated user).");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized: User not authenticated.");
            throw new HubException("User is not authenticated.");
        }

        _logger.LogInformation($"[ChatHub] EditPrivateMessage: ID={messageId}, NewContent (encrypted)='{(newContent.Length > 50 ? newContent[..50] + "..." : newContent)}', FromUser={userName}, ToUser={recipientUserName}");

        try
        {
            var originalMessageDto = await _chatService.GetMessageById(messageId);
            if (originalMessageDto == null)
            {
                _logger.LogWarning($"[ChatHub] Private message {messageId} not found for editing by {userName} to {recipientUserName}.");
                await Clients.Caller.SendAsync("ReceiveError", "Edit failed: Message not found.");
                throw new HubException("Message not found.");
            }

            // ✅ ПРАВИЛЬНА ЛОГІКА: Перевіряємо ВЛАСНІСТЬ ПОВІДОМЛЕННЯ ПЕРЕД тим, як щось робити
            bool isSenderOfThisPrivateMessage = originalMessageDto.FromUser == userName && originalMessageDto.ToUser == recipientUserName;

            if (!isSenderOfThisPrivateMessage)
            {
                _logger.LogWarning($"[ChatHub] User {userName} attempted to edit private message {messageId} that they did not send or that is not part of their chat with {recipientUserName}. Original from: {originalMessageDto.FromUser}, original to: {originalMessageDto.ToUser}.");
                await Clients.Caller.SendAsync("ReceiveError", "Edit failed: You can only edit messages you sent in this private chat.");
                throw new HubException("You can only edit messages you sent in this private chat.");
            }

            // ✅ ТЕПЕР МОЖНА БЕЗПЕЧНО ОНОВЛЮВАТИ: Всі перевірки пройдені
            // УВАГА: Третій параметр в UpdateMessageContent має бути userName для авторизації, а не "edited"
            await _chatService.UpdateMessageContent(messageId, newContent, iv, salt, userName);

            // Get the updated message DTO to send to clients
            var updatedMessageDto = await _chatService.GetMessageById(messageId);
            if (updatedMessageDto != null)
            {
                // Send updated message to both participants of the private chat
                var senderConnectionId = (await _userService.GetUserByNameAsync(userName))?.ConnectionId;
                var recipientConnectionId = (await _userService.GetUserByNameAsync(recipientUserName))?.ConnectionId;

                if (!string.IsNullOrEmpty(senderConnectionId))
                {
                    await Clients.Client(senderConnectionId).SendAsync("MessageEdited", updatedMessageDto);
                }
                if (!string.IsNullOrEmpty(recipientConnectionId) && senderConnectionId != recipientConnectionId)
                {
                    await Clients.Client(recipientConnectionId).SendAsync("MessageEdited", updatedMessageDto);
                }
                _logger.LogInformation($"[ChatHub] MessageEdited sent to private chat for ID: {messageId} between {userName} and {recipientUserName}.");
            }
            else
            {
                _logger.LogError($"[ChatHub] Failed to retrieve updated message DTO for private message {messageId} after successful update.");
                await Clients.Caller.SendAsync("ReceiveError", "An unexpected error occurred after editing the private message.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error editing private message {messageId}: {ex.Message}");
            await Clients.Caller.SendAsync("MessageError", messageId, recipientUserName, $"Failed to edit private message: {ex.Message}");
            throw new HubException($"Failed to edit private message: {ex.Message}");
        }
    }

    [HubMethodName("DeleteGlobalMessage")]
    public async Task DeleteGlobalMessage(string messageId)
    {
        var userName = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userName))
        {
            _logger.LogWarning($"[ChatHub] Unauthorized delete global message attempt for ID: {messageId} (no authenticated user).");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized: User not authenticated.");
            return;
        }

        try
        {
            // ChatService will handle the verification that the user is the sender and it's a global message
            var deleted = await _chatService.DeleteGlobalMessageAsync(messageId, userName);

            if (deleted)
            {
                await Clients.All.SendAsync("MessageDeleted", messageId);
                _logger.LogInformation($"[ChatHub] Global message {messageId} deleted by {userName}. Notified all clients.");
            }
            else
            {
                _logger.LogWarning($"[ChatHub] Global message {messageId} not deleted. Either not found or user {userName} is not the sender for deletion. No action taken.");
                await Clients.Caller.SendAsync("ReceiveError", "Deletion failed: Message not found or you are not the sender.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error deleting global message {messageId} by {userName}.");
            await Clients.Caller.SendAsync("ReceiveError", "An error occurred during message deletion.");
        }
    }

    [HubMethodName("DeletePrivateMessage")]
    public async Task DeletePrivateMessage(string messageId, string toUser)
    {
        var fromUser = Context.User?.Identity?.Name; // Current user attempting to delete
        if (string.IsNullOrEmpty(fromUser))
        {
            _logger.LogWarning($"[ChatHub] Unauthorized delete private message attempt for ID: {messageId} (no authenticated user).");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized: User not authenticated.");
            return;
        }

        try
        {
            // ChatService will verify that the user is the sender of the message
            var deleted = await _chatService.DeletePrivateMessageAsync(messageId, fromUser, toUser);

            if (deleted)
            {
                var senderConnectionId = await _userService.GetConnectionIdByUserAsync(fromUser);
                var receiverConnectionId = await _userService.GetConnectionIdByUserAsync(toUser);

                // Notify both chat participants about the message deletion
                if (!string.IsNullOrEmpty(senderConnectionId))
                {
                    await Clients.Client(senderConnectionId).SendAsync("MessageDeleted", messageId);
                    _logger.LogInformation($"[ChatHub] Private message {messageId} deleted. Notified sender {fromUser}.");
                }
                if (!string.IsNullOrEmpty(receiverConnectionId))
                {
                    await Clients.Client(receiverConnectionId).SendAsync("MessageDeleted", messageId);
                    _logger.LogInformation($"[ChatHub] Private message {messageId} deleted. Notified receiver {toUser}.");
                }
                _logger.LogInformation($"[ChatHub] Private message {messageId} deleted by {fromUser} to {toUser}.");
            }
            else
            {
                _logger.LogWarning($"[ChatHub] Private message {messageId} not deleted. Either not found or user {fromUser} is not the sender for deletion to {toUser}. No action taken.");
                await Clients.Caller.SendAsync("ReceiveError", "Deletion failed: Message not found or you are not the sender.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"[ChatHub] Error deleting private message {messageId} by {fromUser} to {toUser}.");
            await Clients.Caller.SendAsync("ReceiveError", "An error occurred during message deletion.");
        }
    }

    [HubMethodName("SendGlobalFileMessage")]
    public async Task SendGlobalFileMessage(Message message)
    {
        var sender = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(sender) || sender != message.FromUser)
        {
            _logger.LogWarning($"[ChatHub] Unauthorized SendGlobalFileMessage attempt. Sender '{message.FromUser}' does not match authenticated user '{sender ?? "None"}'.");
            await Clients.Caller.SendAsync("ReceiveError", "Unauthorized file message. You can only send files on your behalf.");
            return;
        }

        _logger.LogInformation($"[ChatHub] SendGlobalFileMessage from {message.FromUser} with file '{message.FileName}' ({message.Id}).");

        // ✅ Відправляємо повідомлення ВСІМ клієнтам, а не тільки Clients.Others
        await Clients.All.SendAsync("NewMessage", message);
        _logger.LogInformation($"[ChatHub] NewMessage sent to 'All' clients for file '{message.FileName}'.");
    }
}
// Api/Dtos/MessageDto.cs
using System;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Api.Dtos
{
    public class MessageDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("from")]
        [Required]
        public string From { get; set; }

        [JsonPropertyName("to")]
        public string? To { get; set; }

        [JsonPropertyName("content")]
        [Required]
        public string Content { get; set; }

        // ✅ ДОДАНО: IV для прийому від клієнта
        [JsonPropertyName("iv")]
        public string? IV { get; set; }

        // ✅ ДОДАНО: Salt для прийому від клієнта
        [JsonPropertyName("salt")]
        public string? Salt { get; set; }

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; }

        [JsonPropertyName("edited")]
        public bool Edited { get; set; }

        [JsonPropertyName("parentMessageId")]
        public string? ParentMessageId { get; set; }

        [JsonPropertyName("isFile")]
        public bool IsFile { get; set; }

        [JsonPropertyName("fileName")]
        public string? FileName { get; set; }

        [JsonPropertyName("userHash")]
        public string? UserHash { get; set; }

        [JsonPropertyName("userHashTimestamp")]
        public long UserHashTimestamp { get; set; }

        [JsonPropertyName("tempId")]
        public string? TempId { get; set; }
    }
}
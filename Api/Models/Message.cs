// Api/Models/Message.cs
using System.ComponentModel.DataAnnotations;
using System;
using System.Text.Json.Serialization;

namespace Api.Models
{
    public class Message
    {
        [Key]
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("tempId")] // ✅ ДОДАЙТЕ ЦЕЙ РЯДОК
        public string TempId { get; set; }

        [JsonPropertyName("from")]
        public string FromUser { get; set; }

        [JsonPropertyName("to")]
        public string ToUser { get; set; }

        [JsonPropertyName("content")]
        public string Content { get; set; }

        // 🔑 КРИТИЧНО: IV з атрибутом для серіалізації
        [JsonPropertyName("iv")]
        public string IV { get; set; } = string.Empty;

        // 🧂 КРИТИЧНО: Salt з атрибутом для серіалізації
        [JsonPropertyName("salt")]
        public string Salt { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; }

        [JsonPropertyName("edited")]
        public bool Edited { get; set; } = false;

        [JsonPropertyName("parentMessageId")]
        public string? ParentMessageId { get; set; }

        [JsonPropertyName("isFile")]
        public bool IsFile { get; set; } = false;

        [JsonPropertyName("fileName")]
        public string? FileName { get; set; }
    }
}
using Microsoft.AspNetCore.Mvc;

namespace Api.Models
{
    public class ChatSettings
    {
        public string UserHashSecretKey { get; set; }
        public int UserHashExpirationMinutes { get; set; }
    }
}

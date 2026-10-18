using System.ComponentModel.DataAnnotations;

namespace Api.Models
{
    public class User
    {
        public int Id { get; set; }

        [Required]
        [StringLength(15, MinimumLength = 3)]
        public string UserName { get; set; }

        [Required]
        [StringLength(100, MinimumLength = 6)]
        public string Password { get; set; }

        public bool IsOnline { get; set; }

        public string ConnectionId { get; set; }
    }
}


using System.ComponentModel.DataAnnotations;

namespace Api.Dtos
{
    public class UserDto
    {
        [Required]
        [StringLength(15, MinimumLength = 3, ErrorMessage = "Name must be at least(2), and maximum(15) characters")]
        public string Name { get; set; }

        [Required]
        [StringLength(20, MinimumLength = 6, ErrorMessage = "Password must be between 6 and 20 characters")]
        public string Password { get; set; }

        public bool IsOnline { get; set; }
    }
}

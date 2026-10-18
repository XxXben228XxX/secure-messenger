namespace Api.Dtos
{
    public class UserRegisterDto
    {
        public string UserName { get; set; }
        public string Password { get; set; }
        public string ConnectionId { get; set; }
        public bool IsOnline { get; set; }
    }
}

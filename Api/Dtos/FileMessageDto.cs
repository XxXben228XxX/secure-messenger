using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Api.Dtos
{
    public class FileMessageDto : Controller
    {
        public IFormFile File { get; set; }
        public string ToUser { get; set; }
    }
}

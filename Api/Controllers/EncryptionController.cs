using Microsoft.AspNetCore.Mvc;


namespace Api.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class EncryptionController : ControllerBase
    {
        private readonly AesEncryptionService _encryptionService;

        public EncryptionController(AesEncryptionService encryptionService)
        {
            _encryptionService = encryptionService;
        }

        [HttpPost("encrypt")]
        public IActionResult Encrypt([FromBody] string plainText)
        {
            var encryptedText = _encryptionService.Encrypt(plainText);
            return Ok(encryptedText);
        }

        [HttpPost("decrypt")]
        public IActionResult Decrypt([FromBody] string encryptedText)
        {
            try
            {
                var decryptedText = _encryptionService.Decrypt(encryptedText);
                return Ok(decryptedText);
            }
            catch
            {
                return BadRequest("Decryption failed.");
            }
        }
    }
}

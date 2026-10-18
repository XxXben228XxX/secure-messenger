// Api/Controllers/LogController.cs
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.IO;

[ApiController]
[Route("api/[controller]")]
public class LogController : ControllerBase
{
    private readonly ILogger<LogController> _logger;
    private readonly IWebHostEnvironment _env;
    private static readonly object _lockObj = new object();

    public LogController(ILogger<LogController> logger, IWebHostEnvironment env)
    {
        _logger = logger;
        _env = env;
        _logger.LogInformation("[LogController] Constructor called");
    }

    [HttpPost("frontend")]
    public IActionResult LogFrontend([FromBody] FrontendLog log)
    {
        _logger.LogInformation("[LogController] LogFrontend endpoint called!");

        if (log == null)
        {
            _logger.LogWarning("[LogController] Received null log object");
            return BadRequest("Log object is null");
        }

        var logFilePath = Path.Combine(_env.ContentRootPath, "frontend_logs.txt");
        _logger.LogInformation($"[LogController] Log file path: {logFilePath}");

        var logLine = $"[{log.Timestamp}] [{log.Level}] {log.Message} | Context: {log.ChatContext}{Environment.NewLine}";

        try
        {
            lock (_lockObj)
            {
                if (!System.IO.File.Exists(logFilePath))
                {
                    var header = $"=== Frontend Logs Started: {DateTime.Now:yyyy-MM-dd HH:mm:ss} ==={Environment.NewLine}";
                    System.IO.File.WriteAllText(logFilePath, header + logLine);
                    _logger.LogInformation("[LogController] New log file created");
                }
                else
                {
                    System.IO.File.AppendAllText(logFilePath, logLine);
                    _logger.LogInformation("[LogController] Log appended to existing file");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[LogController] Failed to write frontend log to file.");
            return StatusCode(500, ex.Message);
        }

        return Ok(new { message = "Log saved successfully", path = logFilePath });
    }
}
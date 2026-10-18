public class FrontendLog
{
    public string Level { get; set; } // INFO, WARN, ERROR
    public string Timestamp { get; set; }
    public string Message { get; set; }
    public string ChatContext { get; set; } // JSON-рядок з додатковими даними
}
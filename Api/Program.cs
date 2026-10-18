using Api.Data;
using Api.Models;
using Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Newtonsoft.Json;
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace Api
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services.AddControllers()
                .AddNewtonsoftJson(options =>
                {
                    // Це налаштування для Newtonsoft, який часто використовується у старих проектах
                    options.SerializerSettings.DateFormatHandling = DateFormatHandling.IsoDateFormat;
                    options.SerializerSettings.DateTimeZoneHandling = DateTimeZoneHandling.Utc;
                });
            builder.Services.AddEndpointsApiExplorer();

            // Register your ApplicationDbContext
            builder.Services.AddDbContext<ApplicationDbContext>(options =>
                options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"))
                .EnableSensitiveDataLogging()
                .LogTo(Console.WriteLine, Microsoft.Extensions.Logging.LogLevel.Information));

            // Register your custom services
            builder.Services.AddScoped<ChatService>();
            builder.Services.AddScoped<JwtService>();

            // It's better to keep UserService in your DI, as ChatService might depend on it
            // if you separate the logic for user management.
            builder.Services.AddScoped<IUserService, UserService>();

            builder.Services.AddHttpContextAccessor();

            builder.Services.Configure<ChatSettings>(builder.Configuration.GetSection("ChatSettings"));


            // Configure JWT Authentication
            builder.Services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = builder.Configuration["Jwt:Issuer"],
                    ValidAudience = builder.Configuration["Jwt:Audience"],
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]))
                };

                // This event is crucial for retrieving the JWT token from the cookie for API calls
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        // The frontend is sending the token in a cookie, so we extract it here.
                        context.Request.Cookies.TryGetValue("jwt-token", out var token);
                        if (!string.IsNullOrEmpty(token))
                        {
                            context.Token = token;
                        }

                        // SignalR client sends the token as a query parameter by default.
                        // We also need to check for this to support SignalR authentication.
                        var accessToken = context.Request.Query["access_token"];
                        var path = context.HttpContext.Request.Path;
                        if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/chat"))
                        {
                            context.Token = accessToken;
                        }
                        return Task.CompletedTask;
                    }
                };
            });

            builder.Services.AddAuthorization();
            builder.Services.AddSignalR();

            // CORS configuration is crucial for allowing cross-origin requests and credentials (cookies)
            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowSpecificOrigin",
                    policy => policy.WithOrigins("http://localhost:4200")
                                    .AllowAnyHeader()
                                    .AllowAnyMethod()
                                    .AllowCredentials());
            });

            // Ensure your AES encryption key and IV are valid
            //string key = builder.Configuration["Encryption:Key"];
            //string iv = builder.Configuration["Encryption:IV"];
            ////if (string.IsNullOrEmpty(key) || key.Length != 32 || string.IsNullOrEmpty(iv) || iv.Length != 16)
            ////{
            ////    throw new ArgumentException("Invalid key or IV length. Key must be 32 bytes and IV must be 16 bytes.");
            ////}
            //builder.Services.AddSingleton(new AesEncryptionService(key, iv));

            var app = builder.Build();

            // 🔥 ДОДАЙТЕ ЦІ РЯДКИ ПЕРЕД UseStaticFiles:
            string uploadsPath = Path.Combine(app.Environment.ContentRootPath, "uploads");

            // Перевіряємо, чи існує папка uploads. Якщо ні, створюємо її.
            if (!Directory.Exists(uploadsPath))
            {
                // Directory.CreateDirectory створює усі пропущені каталоги, якщо потрібно
                Directory.CreateDirectory(uploadsPath);
                app.Logger.LogInformation($"Created missing 'uploads' directory at: {uploadsPath}");
            }
            // ------------------------------------------

            if (app.Environment.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }

            app.UseHttpsRedirection();
            app.UseRouting();
            app.UseCors("AllowSpecificOrigin");

            // ✅ Add the static files middleware here
            app.UseStaticFiles(); // This serves files from the wwwroot folder, if you have one.

            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(
        Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads")), // ✅ wwwroot/uploads
                RequestPath = "/uploads",
                ServeUnknownFileTypes = true,
                DefaultContentType = "application/octet-stream"
            });

            app.UseAuthentication();
            app.UseAuthorization();

            app.MapControllers();
            app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();

            app.Run();
        }
    }
}
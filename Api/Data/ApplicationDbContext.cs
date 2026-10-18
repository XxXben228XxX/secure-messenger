using Microsoft.EntityFrameworkCore;
using Api.Models; // This is crucial to find your User and Message models
using System.Collections.Generic; // Not strictly needed here, but doesn't hurt

namespace Api.Data
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
        {
        }

        public DbSet<User> Users { get; set; }
        public DbSet<Message> Messages { get; set; } // <<< ADDED THIS LINE!

        // This method is used to configure the schema of your database tables
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Configure the User entity based on your ModelSnapshot
            modelBuilder.Entity<User>(b =>
            {
                b.Property<int>("Id")
                    .ValueGeneratedOnAdd()
                    .HasColumnType("int");

                // Note: SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<int>("Id"));
                // is usually set at the provider level or inferred.
                // You can add it here if you prefer explicit configuration:
                // SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<int>("Id"));

                b.Property<string>("ConnectionId")
                    .HasColumnType("nvarchar(max)");

                b.Property<bool>("IsOnline")
                    .HasColumnType("bit");

                b.Property<string>("Password")
                    .IsRequired()
                    .HasMaxLength(100)
                    .HasColumnType("nvarchar(100)");

                b.Property<string>("UserName")
                    .IsRequired()
                    .HasMaxLength(15)
                    .HasColumnType("nvarchar(15)");

                b.HasKey("Id");

                b.ToTable("Users", (string)null); // Explicit table name
            });

            // Configure the Message entity
            modelBuilder.Entity<Message>(b =>
            {
                b.HasKey(m => m.Id); // Assuming Id is your primary key for Message
                // If you want to configure other properties, you can add them here:
                // b.Property(m => m.FromUser).IsRequired().HasMaxLength(50);
                // b.Property(m => m.Content).IsRequired();
                // etc.
            });


            // IMPORTANT: If you are inheriting from IdentityDbContext (e.g., for user authentication features),
            // you MUST call the base method for Identity configurations.
            // If you are only using DbContext, it's good practice to call it if you extend it later.
            base.OnModelCreating(modelBuilder);
        }
    }
}
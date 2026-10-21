using FlowPilot.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Api.Data;

/// <summary>
/// Shared PostgreSQL database context for cross-device account profiles,
/// devices, synchronized transcripts, notes, prompt templates, and preferences.
/// </summary>
public sealed class FlowPilotDbContext(DbContextOptions<FlowPilotDbContext> options) : DbContext(options)
{
    public DbSet<UserEntity> Users => Set<UserEntity>();
    public DbSet<DeviceEntity> Devices => Set<DeviceEntity>();
    public DbSet<TranscriptEntity> Transcripts => Set<TranscriptEntity>();
    public DbSet<NoteEntity> Notes => Set<NoteEntity>();
    public DbSet<PromptTemplateEntity> PromptTemplates => Set<PromptTemplateEntity>();
    public DbSet<ProcessingPreferenceEntity> ProcessingPreferences => Set<ProcessingPreferenceEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("flowpilot");

        modelBuilder.Entity<UserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.Email).IsUnique();
            entity.Property(x => x.Email).HasMaxLength(320).IsRequired();
            entity.Property(x => x.DisplayName).HasMaxLength(200).IsRequired();
            entity.Property(x => x.PasswordHash).IsRequired();
        });

        modelBuilder.Entity<DeviceEntity>(entity =>
        {
            entity.ToTable("devices");
            entity.HasKey(x => new { x.UserId, x.Id });
            entity.HasIndex(x => x.UserId);
            entity.Property(x => x.DeviceName).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Platform).HasMaxLength(64).IsRequired();
        });

        modelBuilder.Entity<TranscriptEntity>(entity =>
        {
            entity.ToTable("transcripts");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.UserId, x.IsDeleted, x.UpdatedAtUtc });
            entity.HasIndex(x => new { x.UserId, x.Id });
            entity.Property(x => x.OutputMode).HasMaxLength(64).IsRequired();
            entity.Property(x => x.ProviderId).HasMaxLength(128).IsRequired();
            entity.Property(x => x.LastIdempotencyKey).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<NoteEntity>(entity =>
        {
            entity.ToTable("notes");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.UserId, x.IsDeleted, x.UpdatedAtUtc });
            entity.HasIndex(x => new { x.UserId, x.Folder });
            entity.Property(x => x.Title).HasMaxLength(400).IsRequired();
            entity.Property(x => x.Folder).HasMaxLength(160).IsRequired();
            entity.Property(x => x.LastIdempotencyKey).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<PromptTemplateEntity>(entity =>
        {
            entity.ToTable("prompt_templates");
            entity.HasKey(x => new { x.UserId, x.Id });
            entity.HasIndex(x => new { x.UserId, x.Name });
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.OutputMode).HasMaxLength(64).IsRequired();
        });

        modelBuilder.Entity<ProcessingPreferenceEntity>(entity =>
        {
            entity.ToTable("processing_preferences");
            entity.HasKey(x => x.UserId);
            entity.Property(x => x.DefaultOutputMode).HasMaxLength(64).IsRequired();
            entity.Property(x => x.DefaultLanguage).HasMaxLength(32).IsRequired();
            entity.Property(x => x.PreferredSpeechMode).HasMaxLength(32).IsRequired();
            entity.Property(x => x.PreferredRefinementMode).HasMaxLength(32).IsRequired();
        });
    }
}

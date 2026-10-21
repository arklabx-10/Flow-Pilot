using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FlowPilot.Api.Data.Migrations;

[DbContext(typeof(FlowPilotDbContext))]
[Migration("20261021000000_InitialSharedHistorySchema")]
public partial class InitialSharedHistorySchema : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.EnsureSchema(name: "flowpilot");

        migrationBuilder.CreateTable(
            name: "users",
            schema: "flowpilot",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                PasswordHash = table.Column<string>(type: "text", nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_users", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "devices",
            schema: "flowpilot",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                UserId = table.Column<string>(type: "text", nullable: false),
                DeviceName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                Platform = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                LastSeenAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_devices", x => new { x.UserId, x.Id });
            });

        migrationBuilder.CreateTable(
            name: "transcripts",
            schema: "flowpilot",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                UserId = table.Column<string>(type: "text", nullable: false),
                DeviceId = table.Column<string>(type: "text", nullable: false),
                OriginalTranscript = table.Column<string>(type: "text", nullable: false),
                RefinedTranscript = table.Column<string>(type: "text", nullable: false),
                EditedText = table.Column<string>(type: "text", nullable: false),
                OutputMode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                ProviderId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                DurationMs = table.Column<long>(type: "bigint", nullable: false),
                Version = table.Column<int>(type: "integer", nullable: false),
                LastIdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                DeletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transcripts", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "notes",
            schema: "flowpilot",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                UserId = table.Column<string>(type: "text", nullable: false),
                DeviceId = table.Column<string>(type: "text", nullable: false),
                Title = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                Content = table.Column<string>(type: "text", nullable: false),
                Folder = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                TagsJson = table.Column<string>(type: "text", nullable: false),
                SourceTranscriptId = table.Column<string>(type: "text", nullable: true),
                Version = table.Column<int>(type: "integer", nullable: false),
                LastIdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                DeletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_notes", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "prompt_templates",
            schema: "flowpilot",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                UserId = table.Column<string>(type: "text", nullable: false),
                Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                SystemInstructions = table.Column<string>(type: "text", nullable: false),
                OutputMode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                Version = table.Column<int>(type: "integer", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_prompt_templates", x => new { x.UserId, x.Id });
            });

        migrationBuilder.CreateTable(
            name: "processing_preferences",
            schema: "flowpilot",
            columns: table => new
            {
                UserId = table.Column<string>(type: "text", nullable: false),
                DefaultOutputMode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                DefaultLanguage = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                PreferredSpeechMode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                PreferredRefinementMode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                AutoCopyToClipboard = table.Column<bool>(type: "boolean", nullable: false),
                SyncEnabled = table.Column<bool>(type: "boolean", nullable: false),
                Version = table.Column<int>(type: "integer", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_processing_preferences", x => x.UserId);
            });

        migrationBuilder.CreateIndex(
            name: "IX_users_Email",
            schema: "flowpilot",
            table: "users",
            column: "Email",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_devices_UserId",
            schema: "flowpilot",
            table: "devices",
            column: "UserId");

        migrationBuilder.CreateIndex(
            name: "IX_transcripts_UserId_IsDeleted_UpdatedAtUtc",
            schema: "flowpilot",
            table: "transcripts",
            columns: new[] { "UserId", "IsDeleted", "UpdatedAtUtc" });

        migrationBuilder.CreateIndex(
            name: "IX_notes_UserId_IsDeleted_UpdatedAtUtc",
            schema: "flowpilot",
            table: "notes",
            columns: new[] { "UserId", "IsDeleted", "UpdatedAtUtc" });

        migrationBuilder.CreateIndex(
            name: "IX_notes_UserId_Folder",
            schema: "flowpilot",
            table: "notes",
            columns: new[] { "UserId", "Folder" });

        migrationBuilder.CreateIndex(
            name: "IX_prompt_templates_UserId_Name",
            schema: "flowpilot",
            table: "prompt_templates",
            columns: new[] { "UserId", "Name" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "processing_preferences", schema: "flowpilot");
        migrationBuilder.DropTable(name: "prompt_templates", schema: "flowpilot");
        migrationBuilder.DropTable(name: "notes", schema: "flowpilot");
        migrationBuilder.DropTable(name: "transcripts", schema: "flowpilot");
        migrationBuilder.DropTable(name: "devices", schema: "flowpilot");
        migrationBuilder.DropTable(name: "users", schema: "flowpilot");
    }
}

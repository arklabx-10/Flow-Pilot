using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FlowPilot.Api.Data.Migrations;

[DbContext(typeof(FlowPilotDbContext))]
[Migration("20261029000000_AddCustomVocabularySchema")]
public partial class AddCustomVocabularySchema : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "vocabulary_entries",
            schema: "flowpilot",
            columns: table => new
            {
                UserId = table.Column<string>(type: "text", nullable: false),
                Id = table.Column<string>(type: "text", nullable: false),
                SpokenPhrase = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                ReplacementTerm = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_vocabulary_entries", x => new { x.UserId, x.Id });
            });

        migrationBuilder.CreateIndex(
            name: "IX_vocabulary_entries_UserId_SpokenPhrase",
            schema: "flowpilot",
            table: "vocabulary_entries",
            columns: new[] { "UserId", "SpokenPhrase" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "vocabulary_entries",
            schema: "flowpilot");
    }
}

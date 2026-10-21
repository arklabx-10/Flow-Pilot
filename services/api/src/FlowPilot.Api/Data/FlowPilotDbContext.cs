using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Api.Data;

/// <summary>
/// Shared PostgreSQL database context for cross-device account profiles and dictionary sync.
/// Desktop-local dictation sessions are stored in local SQLite on the client.
/// </summary>
public sealed class FlowPilotDbContext(DbContextOptions<FlowPilotDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("flowpilot");
    }
}

using FlowPilot.Api.Contracts.V1;
using FlowPilot.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi("v1");
builder.Services.AddHealthChecks();

var postgresConnectionString = builder.Configuration.GetConnectionString("SharedPostgres");
if (!string.IsNullOrWhiteSpace(postgresConnectionString))
{
    builder.Services.AddDbContext<FlowPilotDbContext>(options =>
        options.UseNpgsql(postgresConnectionString));
}

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:5173", "http://localhost:1420", "tauri://localhost"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("FlowPilotClients", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("FlowPilotClients");
app.MapOpenApi("/openapi/{documentName}.json");

static HealthStatusResponseV1 CreateHealthResponse(IHostEnvironment environment, IConfiguration configuration)
{
    var hasPostgresConfig = !string.IsNullOrWhiteSpace(configuration.GetConnectionString("SharedPostgres"));
    return new HealthStatusResponseV1(
        Status: "Healthy",
        Service: "flowpilot-api",
        ContractVersion: ContractVersions.V1,
        Environment: environment.EnvironmentName,
        TimestampUtc: DateTimeOffset.UtcNow.ToString("O"),
        PostgresMode: hasPostgresConfig ? "Configured" : "Unconfigured");
}

app.MapGet("/health", (IHostEnvironment env, IConfiguration config) =>
        Results.Ok(CreateHealthResponse(env, config)))
    .WithName("GetHealthProbe")
    .WithSummary("Infrastructure health probe")
    .WithTags("Health");

var v1 = app.MapGroup("/api/v1");

v1.MapGet("/health", (IHostEnvironment env, IConfiguration config) =>
        Results.Ok(CreateHealthResponse(env, config)))
    .WithName("GetHealthV1")
    .WithSummary("Versioned v1 health and storage readiness status")
    .WithTags("Health");

app.Run();

public partial class Program;

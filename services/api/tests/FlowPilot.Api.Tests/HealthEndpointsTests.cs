using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlowPilot.Api.Contracts.V1;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FlowPilot.Api.Tests;

public sealed class HealthEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Theory]
    [InlineData("/health")]
    [InlineData("/api/v1/health")]
    public async Task GetHealth_ReturnsHealthyContractV1Response(string endpoint)
    {
        var response = await _client.GetAsync(endpoint);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<HealthStatusResponseV1>();
        Assert.NotNull(payload);
        Assert.Equal("Healthy", payload.Status);
        Assert.Equal("flowpilot-api", payload.Service);
        Assert.Equal(ContractVersions.V1, payload.ContractVersion);
        Assert.False(string.IsNullOrWhiteSpace(payload.Environment));
        Assert.True(DateTimeOffset.TryParse(payload.TimestampUtc, out _));
        Assert.Contains(payload.PostgresMode, new[] { "Configured", "Unconfigured" });
    }

    [Fact]
    public async Task GetOpenApiDocumentV1_ReturnsValidOpenApiSpecification()
    {
        var response = await _client.GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);

        Assert.True(document.RootElement.TryGetProperty("openapi", out var openApiVersion));
        Assert.StartsWith("3.", openApiVersion.GetString());
        Assert.True(document.RootElement.TryGetProperty("paths", out var paths));
        Assert.True(paths.TryGetProperty("/health", out _));
        Assert.True(paths.TryGetProperty("/api/v1/health", out _));
    }
}

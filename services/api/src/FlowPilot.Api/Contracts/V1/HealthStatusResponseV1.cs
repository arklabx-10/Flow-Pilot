namespace FlowPilot.Api.Contracts.V1;

public static class ContractVersions
{
    public const string V1 = "v1";
}

public sealed record HealthStatusResponseV1(
    string Status,
    string Service,
    string ContractVersion,
    string Environment,
    string TimestampUtc,
    string PostgresMode);

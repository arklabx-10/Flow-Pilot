export const CONTRACT_VERSION_V1 = 'v1' as const;

export const HEALTH_PATHS_V1 = {
  probe: '/health',
  v1: '/api/v1/health',
  openApiDocument: '/openapi/v1.json',
} as const;

export type ServiceHealthStatus = 'Healthy' | 'Degraded' | 'Unhealthy';

export type DatabaseConfigurationMode = 'Configured' | 'Unconfigured';

export interface HealthStatusResponseV1 {
  status: ServiceHealthStatus;
  service: string;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
  environment: string;
  timestampUtc: string;
  postgresMode: DatabaseConfigurationMode;
}

const VALID_HEALTH_STATUSES: ReadonlySet<string> = new Set(['Healthy', 'Degraded', 'Unhealthy']);
const VALID_POSTGRES_MODES: ReadonlySet<string> = new Set(['Configured', 'Unconfigured']);

export function isHealthStatusResponseV1(value: unknown): value is HealthStatusResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.status === 'string' &&
    VALID_HEALTH_STATUSES.has(candidate.status) &&
    typeof candidate.service === 'string' &&
    candidate.service.length > 0 &&
    typeof candidate.contractVersion === 'string' &&
    candidate.contractVersion.length > 0 &&
    typeof candidate.environment === 'string' &&
    candidate.environment.length > 0 &&
    typeof candidate.timestampUtc === 'string' &&
    !Number.isNaN(Date.parse(candidate.timestampUtc)) &&
    typeof candidate.postgresMode === 'string' &&
    VALID_POSTGRES_MODES.has(candidate.postgresMode)
  );
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  CONTRACT_VERSION_V1,
  HEALTH_PATHS_V1,
  SPEECH_PATHS_V1,
  isApiErrorResponseV1,
  isCloudTextRefineResponseV1,
  isCloudTranscriptionResponseV1,
  isHealthStatusResponseV1,
  isTranscriptSyncResponseV1,
  type CloudTranscriptionResponseV1,
  type HealthStatusResponseV1,
} from '../src/index.js';

describe('@flowpilot/contracts v1', () => {
  it('validates a well-formed HealthStatusResponseV1 payload', () => {
    const validPayload: HealthStatusResponseV1 = {
      status: 'Healthy',
      service: 'flowpilot-api',
      contractVersion: CONTRACT_VERSION_V1,
      environment: 'Development',
      timestampUtc: '2026-10-21T17:30:00.000Z',
      postgresMode: 'Configured',
    };

    expect(isHealthStatusResponseV1(validPayload)).toBe(true);
  });

  it('rejects malformed health payloads', () => {
    expect(isHealthStatusResponseV1(null)).toBe(false);
    expect(
      isHealthStatusResponseV1({
        status: 'UnknownStatus',
        service: 'flowpilot-api',
        contractVersion: 'v1',
        environment: 'Development',
        timestampUtc: '2026-10-21T17:30:00.000Z',
        postgresMode: 'Configured',
      }),
    ).toBe(false);
  });

  it('validates cloud speech transcription, refinement, sync, and error contracts', () => {
    const transcriptionPayload: CloudTranscriptionResponseV1 = {
      transcript: 'Hello from FlowPilot cloud speech proxy.',
      providerId: 'flowpilot-cloud-openai',
      language: 'en',
      contractVersion: 'v1',
    };
    expect(isCloudTranscriptionResponseV1(transcriptionPayload)).toBe(true);
    expect(isCloudTranscriptionResponseV1({ transcript: '' })).toBe(false);

    expect(
      isCloudTextRefineResponseV1({
        refinedText: 'Hello from FlowPilot.',
        outputMode: 'clean',
        providerId: 'flowpilot-cloud-refiner',
        contractVersion: 'v1',
      }),
    ).toBe(true);

    expect(
      isTranscriptSyncResponseV1({
        syncedId: 'entry-123',
        syncedAtUtc: '2026-10-21T18:00:00Z',
        contractVersion: 'v1',
      }),
    ).toBe(true);

    expect(
      isApiErrorResponseV1({
        code: 'PROVIDER_RATE_LIMITED',
        message: 'Rate limit exceeded',
        recoverable: true,
      }),
    ).toBe(true);
  });

  it('keeps openapi/v1/openapi.yaml aligned with exported contract paths and schema', () => {
    const specPath = resolve(import.meta.dirname, '../openapi/v1/openapi.yaml');
    const rawSpec = readFileSync(specPath, 'utf8');
    const parsed = parse(rawSpec) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { required?: string[] }> };
    };

    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toBe('FlowPilot API');
    expect(parsed.paths).toHaveProperty(HEALTH_PATHS_V1.probe);
    expect(parsed.paths).toHaveProperty(HEALTH_PATHS_V1.v1);
    expect(parsed.paths).toHaveProperty(SPEECH_PATHS_V1.transcribe);
    expect(parsed.paths).toHaveProperty(SPEECH_PATHS_V1.refine);
    expect(parsed.paths).toHaveProperty(SPEECH_PATHS_V1.syncTranscript);

    const healthSchema = parsed.components.schemas.HealthStatusResponseV1;
    expect(healthSchema).toBeDefined();
    expect(healthSchema.required).toEqual([
      'status',
      'service',
      'contractVersion',
      'environment',
      'timestampUtc',
      'postgresMode',
    ]);
  });
});

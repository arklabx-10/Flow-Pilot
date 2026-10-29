import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ACCOUNT_SYNC_PATHS_V1,
  CONTRACT_VERSION_V1,
  HEALTH_PATHS_V1,
  SPEECH_PATHS_V1,
  isApiErrorResponseV1,
  isAuthSessionResponseV1,
  isCloudTextRefineResponseV1,
  isCloudTranscriptionResponseV1,
  isHealthStatusResponseV1,
  isPaginatedListResponseV1,
  isSyncConflictResponseV1,
  isTranscriptSyncResponseV1,
  type AuthSessionResponseV1,
  type CloudTranscriptionResponseV1,
  type HealthStatusResponseV1,
  type PaginatedListResponseV1,
  type TranscriptRecordV1,
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

  it('validates Phase 4 auth session, paginated list, and sync conflict contracts', () => {
    const session: AuthSessionResponseV1 = {
      accessToken: 'jwt-token-placeholder',
      expiresAtUtc: '2026-10-22T00:00:00Z',
      user: {
        id: 'user-1',
        email: 'pilot@example.com',
        displayName: 'Flow Pilot',
      },
      contractVersion: 'v1',
    };
    expect(isAuthSessionResponseV1(session)).toBe(true);

    const page: PaginatedListResponseV1<TranscriptRecordV1> = {
      items: [
        {
          id: 'tr-1',
          userId: 'user-1',
          deviceId: 'desktop-1',
          originalTranscript: 'raw text',
          refinedTranscript: 'Raw text.',
          editedText: 'Edited text.',
          outputMode: 'clean',
          providerId: 'local-whisper-cpp',
          durationMs: 1200,
          version: 1,
          isDeleted: false,
          createdAtUtc: '2026-10-21T18:00:00Z',
          updatedAtUtc: '2026-10-21T18:00:00Z',
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      contractVersion: 'v1',
    };
    expect(isPaginatedListResponseV1(page)).toBe(true);

    expect(
      isSyncConflictResponseV1({
        code: 'VERSION_CONFLICT',
        message: 'Record was modified on another device.',
        serverVersion: 2,
        expectedVersion: 1,
        serverRecord: page.items[0],
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
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.login);
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.transcripts);
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.notes);
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.promptTemplates);
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.preferences);
    expect(parsed.paths).toHaveProperty(ACCOUNT_SYNC_PATHS_V1.vocabulary);
  });
});

import type { CONTRACT_VERSION_V1 } from './health.js';

export const SPEECH_PATHS_V1 = {
  transcribe: '/api/v1/speech/transcribe',
  refine: '/api/v1/text/refine',
  syncTranscript: '/api/v1/transcripts/sync',
} as const;

export type ContractOutputModeV1 =
  'raw' | 'clean' | 'professional' | 'coding-prompt' | 'quick-note';

export interface CloudTranscriptionResponseV1 {
  transcript: string;
  providerId: string;
  language?: string | null;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface CloudTextRefineRequestV1 {
  originalTranscript: string;
  outputMode: ContractOutputModeV1;
}

export interface CloudTextRefineResponseV1 {
  refinedText: string;
  outputMode: ContractOutputModeV1;
  providerId: string;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface TranscriptSyncRequestV1 {
  id: string;
  originalTranscript: string;
  refinedTranscript: string;
  editedText: string;
  outputMode: ContractOutputModeV1;
  providerId: string;
  durationMs: number;
  createdAtUtc: string;
}

export interface TranscriptSyncResponseV1 {
  syncedId: string;
  syncedAtUtc: string;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface ApiErrorResponseV1 {
  code: string;
  message: string;
  recoverable: boolean;
}

export function isCloudTranscriptionResponseV1(
  value: unknown,
): value is CloudTranscriptionResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.transcript === 'string' &&
    candidate.transcript.trim().length > 0 &&
    typeof candidate.providerId === 'string' &&
    candidate.providerId.trim().length > 0 &&
    typeof candidate.contractVersion === 'string' &&
    candidate.contractVersion.trim().length > 0
  );
}

export function isCloudTextRefineResponseV1(value: unknown): value is CloudTextRefineResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.refinedText === 'string' &&
    typeof candidate.outputMode === 'string' &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.contractVersion === 'string'
  );
}

export function isTranscriptSyncResponseV1(value: unknown): value is TranscriptSyncResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.syncedId === 'string' &&
    candidate.syncedId.trim().length > 0 &&
    typeof candidate.syncedAtUtc === 'string' &&
    typeof candidate.contractVersion === 'string'
  );
}

export function isApiErrorResponseV1(value: unknown): value is ApiErrorResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0 &&
    typeof candidate.recoverable === 'boolean'
  );
}

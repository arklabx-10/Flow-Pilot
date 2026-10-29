import type { CONTRACT_VERSION_V1 } from './health.js';
import type { ContractOutputModeV1 } from './speech.js';

export const ACCOUNT_SYNC_PATHS_V1 = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  me: '/api/v1/auth/me',
  authRegister: '/api/v1/auth/register',
  authLogin: '/api/v1/auth/login',
  authLogout: '/api/v1/auth/logout',
  authMe: '/api/v1/auth/me',
  devices: '/api/v1/devices',
  transcripts: '/api/v1/transcripts',
  notes: '/api/v1/notes',
  promptTemplates: '/api/v1/prompt-templates',
  preferences: '/api/v1/preferences',
  vocabulary: '/api/v1/vocabulary',
  telemetrySummary: '/api/v1/telemetry/summary',
  accountExport: '/api/v1/account/export',
  accountDelete: '/api/v1/account',
} as const;

export type SyncItemState =
  | 'local-only'
  | 'pending-sync'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'auth-expired'
  | 'offline-retry';

export interface RegisterRequestV1 {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequestV1 {
  email: string;
  password: string;
}

export interface UserProfileV1 {
  id: string;
  email: string;
  displayName: string;
  createdAtUtc?: string;
}

export interface AuthSessionResponseV1 {
  accessToken: string;
  expiresAtUtc: string;
  user: UserProfileV1;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface RegisterDeviceRequestV1 {
  deviceId?: string;
  id?: string;
  deviceName: string;
  platform: 'windows-desktop' | 'web' | string;
}

export interface DeviceRecordV1 {
  id: string;
  userId?: string;
  deviceName: string;
  platform: string;
  lastSeenAtUtc: string;
}

export interface TranscriptRecordV1 {
  id: string;
  userId?: string;
  deviceId: string;
  originalTranscript: string;
  refinedTranscript: string;
  editedText: string;
  outputMode: ContractOutputModeV1 | string;
  providerId: string;
  durationMs: number;
  version: number;
  isDeleted: boolean;
  deletedAtUtc?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface UpsertTranscriptRequestV1 {
  idempotencyKey: string;
  expectedVersion: number;
  deviceId: string;
  originalTranscript: string;
  refinedTranscript: string;
  editedText: string;
  outputMode: ContractOutputModeV1 | string;
  providerId: string;
  durationMs: number;
  clientUpdatedAtUtc: string;
}

export interface NoteRecordV1 {
  id: string;
  userId?: string;
  deviceId?: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  sourceTranscriptId?: string | null;
  version: number;
  isDeleted: boolean;
  deletedAtUtc?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface UpsertNoteRequestV1 {
  idempotencyKey: string;
  expectedVersion: number;
  deviceId: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  sourceTranscriptId?: string | null;
  clientUpdatedAtUtc: string;
}

export interface PromptTemplateRecordV1 {
  id: string;
  userId?: string;
  name: string;
  systemInstructions: string;
  outputMode: ContractOutputModeV1 | string;
  version?: number;
  updatedAtUtc: string;
}

export interface UpsertPromptTemplateRequestV1 {
  name: string;
  systemInstructions: string;
  outputMode: ContractOutputModeV1 | string;
  expectedVersion?: number;
}

export interface ProcessingPreferencesRecordV1 {
  userId?: string;
  defaultOutputMode: ContractOutputModeV1 | string;
  defaultLanguage: string;
  preferredSpeechMode: 'local' | 'cloud' | string;
  preferredRefinementMode: 'local' | 'cloud' | string;
  autoCopyToClipboard: boolean;
  syncEnabled: boolean;
  version?: number;
  updatedAtUtc: string;
}

export interface UpdateProcessingPreferencesRequestV1 {
  defaultOutputMode: ContractOutputModeV1;
  defaultLanguage: string;
  preferredSpeechMode: 'local' | 'cloud';
  preferredRefinementMode: 'local' | 'cloud';
  autoCopyToClipboard: boolean;
  syncEnabled: boolean;
  expectedVersion?: number;
}

export interface VocabularyEntryRecordV1 {
  id: string;
  userId?: string;
  spokenPhrase: string;
  replacementTerm: string;
  category: string;
  updatedAtUtc: string;
}

export interface UpsertVocabularyEntryRequestV1 {
  spokenPhrase: string;
  replacementTerm: string;
  category: string;
}

export interface UsageTelemetrySummaryResponseV1 {
  totalTranscripts: number;
  totalSavedNotes: number;
  totalDurationMs: number;
  estimatedWordsDictated: number;
  estimatedTimeSavedMinutes: number;
  modeBreakdown: Record<string, number>;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface AccountDataExportResponseV1 {
  exportedAtUtc: string;
  user: UserProfileV1;
  devices: DeviceRecordV1[];
  transcripts: TranscriptRecordV1[];
  notes: NoteRecordV1[];
  promptTemplates: PromptTemplateRecordV1[];
  vocabulary: VocabularyEntryRecordV1[];
  preferences: ProcessingPreferencesRecordV1 | null;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface PaginatedListResponseV1<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  contractVersion: typeof CONTRACT_VERSION_V1 | string;
}

export interface SyncConflictResponseV1<T> {
  code: 'VERSION_CONFLICT';
  message: string;
  serverVersion: number;
  expectedVersion?: number;
  serverRecord: T;
  contractVersion?: typeof CONTRACT_VERSION_V1 | string;
}

export function isAuthSessionResponseV1(value: unknown): value is AuthSessionResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const user = candidate.user as Record<string, unknown> | undefined;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.expiresAtUtc === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.displayName === 'string' &&
    typeof candidate.contractVersion === 'string'
  );
}

export function isPaginatedListResponseV1<T>(value: unknown): value is PaginatedListResponseV1<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.page === 'number' &&
    typeof candidate.pageSize === 'number' &&
    typeof candidate.totalCount === 'number' &&
    typeof candidate.contractVersion === 'string'
  );
}

export function isSyncConflictResponseV1<T>(value: unknown): value is SyncConflictResponseV1<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.code === 'VERSION_CONFLICT' &&
    typeof candidate.message === 'string' &&
    typeof candidate.serverVersion === 'number' &&
    typeof candidate.serverRecord === 'object' &&
    candidate.serverRecord !== null
  );
}

export function isUsageTelemetrySummaryResponseV1(
  value: unknown,
): value is UsageTelemetrySummaryResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.totalTranscripts === 'number' &&
    typeof candidate.totalSavedNotes === 'number' &&
    typeof candidate.totalDurationMs === 'number' &&
    typeof candidate.estimatedWordsDictated === 'number' &&
    typeof candidate.estimatedTimeSavedMinutes === 'number' &&
    typeof candidate.modeBreakdown === 'object' &&
    candidate.modeBreakdown !== null &&
    typeof candidate.contractVersion === 'string'
  );
}

export function isAccountDataExportResponseV1(
  value: unknown,
): value is AccountDataExportResponseV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.exportedAtUtc === 'string' &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    Array.isArray(candidate.devices) &&
    Array.isArray(candidate.transcripts) &&
    Array.isArray(candidate.notes) &&
    Array.isArray(candidate.promptTemplates) &&
    Array.isArray(candidate.vocabulary) &&
    typeof candidate.contractVersion === 'string'
  );
}

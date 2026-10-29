import {
  ACCOUNT_SYNC_PATHS_V1,
  isAccountDataExportResponseV1,
  isApiErrorResponseV1,
  isAuthSessionResponseV1,
  isPaginatedListResponseV1,
  isUsageTelemetrySummaryResponseV1,
  type AccountDataExportResponseV1,
  type AuthSessionResponseV1,
  type NoteRecordV1,
  type PaginatedListResponseV1,
  type ProcessingPreferencesRecordV1,
  type PromptTemplateRecordV1,
  type TranscriptRecordV1,
  type UpdateProcessingPreferencesRequestV1,
  type UpsertNoteRequestV1,
  type UpsertPromptTemplateRequestV1,
  type UpsertTranscriptRequestV1,
  type UpsertVocabularyEntryRequestV1,
  type UsageTelemetrySummaryResponseV1,
  type VocabularyEntryRecordV1,
} from '@flowpilot/contracts';

export class WebApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null = null;

  public constructor(baseUrl: string, fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  public setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  public async login(email: string, password: string): Promise<AuthSessionResponseV1> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.login}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to sign in.');
    }
    const body: unknown = await response.json();
    if (!isAuthSessionResponseV1(body)) {
      throw new Error('Server returned an invalid authentication session payload.');
    }
    this.accessToken = body.accessToken;
    return body;
  }

  public async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthSessionResponseV1> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.register}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to register account.');
    }
    const body: unknown = await response.json();
    if (!isAuthSessionResponseV1(body)) {
      throw new Error('Server returned an invalid registration session payload.');
    }
    this.accessToken = body.accessToken;
    return body;
  }

  public async logout(): Promise<void> {
    if (this.accessToken) {
      await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.logout}`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
    }
    this.accessToken = null;
  }

  public async listTranscripts(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<PaginatedListResponseV1<TranscriptRecordV1>> {
    const searchParams = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.search && params.search.trim().length > 0) {
      searchParams.set('search', params.search.trim());
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.transcripts}?${searchParams.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load transcripts.');
    }
    const body: unknown = await response.json();
    if (!isPaginatedListResponseV1<TranscriptRecordV1>(body)) {
      throw new Error('Invalid paginated transcript list response.');
    }
    return body;
  }

  public async upsertTranscript(
    id: string,
    payload: UpsertTranscriptRequestV1,
  ): Promise<TranscriptRecordV1> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.transcripts}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to update transcript.');
    }
    return (await response.json()) as TranscriptRecordV1;
  }

  public async deleteTranscript(id: string, permanent = false): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.transcripts}/${encodeURIComponent(id)}?permanent=${String(permanent)}`,
      {
        method: 'DELETE',
        headers: this.authHeaders(),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to delete transcript.');
    }
  }

  public async listNotes(params: {
    page: number;
    pageSize: number;
    search?: string;
    folder?: string;
  }): Promise<PaginatedListResponseV1<NoteRecordV1>> {
    const searchParams = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.search && params.search.trim().length > 0) {
      searchParams.set('search', params.search.trim());
    }
    if (params.folder && params.folder.trim().length > 0) {
      searchParams.set('folder', params.folder.trim());
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.notes}?${searchParams.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load saved notes.');
    }
    const body: unknown = await response.json();
    if (!isPaginatedListResponseV1<NoteRecordV1>(body)) {
      throw new Error('Invalid paginated notes response.');
    }
    return body;
  }

  public async upsertNote(id: string, payload: UpsertNoteRequestV1): Promise<NoteRecordV1> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.notes}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to save note.');
    }
    return (await response.json()) as NoteRecordV1;
  }

  public async deleteNote(id: string, permanent = false): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.notes}/${encodeURIComponent(id)}?permanent=${String(permanent)}`,
      {
        method: 'DELETE',
        headers: this.authHeaders(),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to delete note.');
    }
  }

  public async listPromptTemplates(): Promise<PromptTemplateRecordV1[]> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.promptTemplates}`,
      { headers: this.authHeaders() },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load prompt templates.');
    }
    return (await response.json()) as PromptTemplateRecordV1[];
  }

  public async upsertPromptTemplate(
    id: string,
    payload: UpsertPromptTemplateRequestV1,
  ): Promise<PromptTemplateRecordV1> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.promptTemplates}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to save prompt template.');
    }
    return (await response.json()) as PromptTemplateRecordV1;
  }

  public async deletePromptTemplate(id: string): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.promptTemplates}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: this.authHeaders(),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to delete prompt template.');
    }
  }

  public async getPreferences(): Promise<ProcessingPreferencesRecordV1> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.preferences}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load processing preferences.');
    }
    return (await response.json()) as ProcessingPreferencesRecordV1;
  }

  public async updatePreferences(
    payload: UpdateProcessingPreferencesRequestV1,
  ): Promise<ProcessingPreferencesRecordV1> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.preferences}`, {
      method: 'PUT',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to update processing preferences.');
    }
    return (await response.json()) as ProcessingPreferencesRecordV1;
  }

  public async listVocabulary(): Promise<VocabularyEntryRecordV1[]> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.vocabulary}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load custom vocabulary.');
    }
    return (await response.json()) as VocabularyEntryRecordV1[];
  }

  public async upsertVocabulary(
    id: string,
    payload: UpsertVocabularyEntryRequestV1,
  ): Promise<VocabularyEntryRecordV1> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.vocabulary}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to save custom vocabulary entry.');
    }
    return (await response.json()) as VocabularyEntryRecordV1;
  }

  public async deleteVocabulary(id: string): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.vocabulary}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: this.authHeaders(),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to delete custom vocabulary entry.');
    }
  }

  public async getTelemetrySummary(): Promise<UsageTelemetrySummaryResponseV1> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.telemetrySummary}`,
      {
        headers: this.authHeaders(),
      },
    );
    if (!response.ok) {
      throw await this.toError(response, 'Failed to load usage telemetry summary.');
    }
    const body: unknown = await response.json();
    if (!isUsageTelemetrySummaryResponseV1(body)) {
      throw new Error('Invalid usage telemetry summary response.');
    }
    return body;
  }

  public async exportAccountData(): Promise<AccountDataExportResponseV1> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.accountExport}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to export personal account data.');
    }
    const body: unknown = await response.json();
    if (!isAccountDataExportResponseV1(body)) {
      throw new Error('Invalid account data export response.');
    }
    return body;
  }

  public async deleteAccount(): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}${ACCOUNT_SYNC_PATHS_V1.accountDelete}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw await this.toError(response, 'Failed to delete account.');
    }
    this.accessToken = null;
  }

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) {
      return {};
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private async toError(response: Response, fallback: string): Promise<Error> {
    try {
      const json: unknown = await response.json();
      if (isApiErrorResponseV1(json)) {
        return new Error(json.message);
      }
    } catch {
      // Fall through
    }
    return new Error(`${fallback} (HTTP ${response.status})`);
  }
}

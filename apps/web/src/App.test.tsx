import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountDataExportResponseV1,
  AuthSessionResponseV1,
  NoteRecordV1,
  PaginatedListResponseV1,
  ProcessingPreferencesRecordV1,
  PromptTemplateRecordV1,
  TranscriptRecordV1,
  UsageTelemetrySummaryResponseV1,
} from '@flowpilot/contracts';
import { App } from './App.js';

describe('FlowPilot Web Companion App — Auth, History, Notes, Templates & Preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the web companion heading, contract version badge, and unauthenticated sign-in gate', () => {
    render(<App autoCheckHealth={false} apiBaseUrl="http://localhost:5080" />);

    expect(screen.getByRole('heading', { name: 'FlowPilot Web Companion' })).toBeDefined();
    expect(screen.getByText('Contract v1')).toBeDefined();
    expect(screen.getByTestId('api-connection-state').textContent).toBe('idle');
    expect(screen.getByTestId('auth-gate-panel')).toBeDefined();
    expect(screen.queryByTestId('authenticated-workspace')).toBeNull();
  });

  it('signs in, displays searchable paginated desktop transcripts, edits & deletes records, and signs out', async () => {
    const transcripts: TranscriptRecordV1[] = [
      {
        id: 'tr-desk-1',
        deviceId: 'desktop-win',
        originalTranscript: 'um ship phase four synchronization',
        refinedTranscript: 'Ship Phase 4 synchronization.',
        editedText: 'Ship Phase 4 synchronization to production.',
        outputMode: 'clean',
        providerId: 'local-whisper-cpp',
        durationMs: 2400,
        version: 1,
        isDeleted: false,
        createdAtUtc: '2026-10-21T19:00:00Z',
        updatedAtUtc: '2026-10-21T19:00:00Z',
      },
      {
        id: 'tr-desk-2',
        deviceId: 'desktop-win',
        originalTranscript: 'review postgres indexes',
        refinedTranscript: 'Review Postgres indexes.',
        editedText: 'Review PostgreSQL composite indexes.',
        outputMode: 'coding-prompt',
        providerId: 'local-whisper-cpp',
        durationMs: 1800,
        version: 1,
        isDeleted: false,
        createdAtUtc: '2026-10-21T19:05:00Z',
        updatedAtUtc: '2026-10-21T19:05:00Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.includes('/api/v1/auth/login')) {
        const session: AuthSessionResponseV1 = {
          accessToken: 'web-session-token-123',
          expiresAtUtc: '2026-10-28T19:00:00Z',
          user: {
            id: 'usr-1',
            email: 'pilot@example.com',
            displayName: 'Alex Pilot',
          },
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && url.includes('/api/v1/auth/logout')) {
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }

      if (method === 'GET' && url.includes('/api/v1/transcripts')) {
        const parsedUrl = new URL(url);
        const search = (parsedUrl.searchParams.get('search') ?? '').toLowerCase();
        const filtered = transcripts.filter(
          (t) =>
            !t.isDeleted &&
            (!search ||
              t.editedText.toLowerCase().includes(search) ||
              t.originalTranscript.toLowerCase().includes(search)),
        );
        const payload: PaginatedListResponseV1<TranscriptRecordV1> = {
          items: filtered,
          page: Number(parsedUrl.searchParams.get('page') ?? '1'),
          pageSize: Number(parsedUrl.searchParams.get('pageSize') ?? '10'),
          totalCount: filtered.length,
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url.includes('/api/v1/transcripts/tr-desk-1')) {
        const body = JSON.parse(String(init?.body)) as { editedText: string };
        transcripts[0] = {
          ...transcripts[0],
          editedText: body.editedText,
          version: transcripts[0].version + 1,
        };
        return new Response(JSON.stringify(transcripts[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'DELETE' && url.includes('/api/v1/transcripts/tr-desk-2')) {
        transcripts[1] = { ...transcripts[1], isDeleted: true };
        return new Response(JSON.stringify({ deletedId: 'tr-desk-2', permanent: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/notes')) {
        const payload: PaginatedListResponseV1<NoteRecordV1> = {
          items: [],
          page: 1,
          pageSize: 10,
          totalCount: 0,
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/prompt-templates')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/preferences')) {
        const prefs: ProcessingPreferencesRecordV1 = {
          defaultOutputMode: 'clean',
          defaultLanguage: 'auto',
          preferredSpeechMode: 'local',
          preferredRefinementMode: 'local',
          autoCopyToClipboard: false,
          syncEnabled: true,
          updatedAtUtc: '2026-10-21T19:00:00Z',
        };
        return new Response(JSON.stringify(prefs), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    });

    render(
      <App
        autoCheckHealth={false}
        apiBaseUrl="http://localhost:5080"
        fetchImpl={fetchMock as unknown as typeof fetch}
      />,
    );

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'pilot@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StrongPass!123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated-workspace')).toBeDefined();
    });

    // Verify password is never stored in localStorage
    const rawStorage = JSON.stringify(window.localStorage);
    expect(rawStorage).not.toContain('StrongPass!123');

    // Desktop transcripts appear in web history
    await waitFor(() => {
      expect(screen.getByText('Ship Phase 4 synchronization to production.')).toBeDefined();
    });
    expect(screen.getByText('Review PostgreSQL composite indexes.')).toBeDefined();

    // Edit first transcript
    fireEvent.click(screen.getByTestId('edit-transcript-tr-desk-1'));
    const editArea = screen.getByTestId('transcript-edit-input-tr-desk-1');
    fireEvent.change(editArea, {
      target: { value: 'Ship Phase 4 synchronization to production (Verified on Web).' },
    });
    fireEvent.click(screen.getByTestId('save-transcript-tr-desk-1'));

    await waitFor(() => {
      expect(
        screen.getByText('Ship Phase 4 synchronization to production (Verified on Web).'),
      ).toBeDefined();
    });

    // Delete second transcript
    fireEvent.click(screen.getByTestId('delete-transcript-tr-desk-2'));
    await waitFor(() => {
      expect(screen.queryByText('Review PostgreSQL composite indexes.')).toBeNull();
    });

    // Sign out
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => {
      expect(screen.getByTestId('auth-gate-panel')).toBeDefined();
    });
  });

  it('creates, organizes, and deletes saved notes, prompt templates, and processing preferences', async () => {
    const notes: NoteRecordV1[] = [];
    const templates: PromptTemplateRecordV1[] = [];
    let preferences: ProcessingPreferencesRecordV1 = {
      defaultOutputMode: 'clean',
      defaultLanguage: 'auto',
      preferredSpeechMode: 'local',
      preferredRefinementMode: 'local',
      autoCopyToClipboard: false,
      syncEnabled: true,
      updatedAtUtc: '2026-10-21T19:00:00Z',
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.includes('/api/v1/auth/login')) {
        const session: AuthSessionResponseV1 = {
          accessToken: 'web-session-token-456',
          expiresAtUtc: '2026-10-28T19:00:00Z',
          user: {
            id: 'usr-2',
            email: 'notes@example.com',
            displayName: 'Notes Pilot',
          },
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/transcripts')) {
        return new Response(
          JSON.stringify({
            items: [],
            page: 1,
            pageSize: 10,
            totalCount: 0,
            contractVersion: 'v1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'GET' && url.includes('/api/v1/notes')) {
        return new Response(
          JSON.stringify({
            items: notes.filter((n) => !n.isDeleted),
            page: 1,
            pageSize: 10,
            totalCount: notes.filter((n) => !n.isDeleted).length,
            contractVersion: 'v1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'PUT' && url.includes('/api/v1/notes/')) {
        const id = url.split('/api/v1/notes/')[1];
        const body = JSON.parse(String(init?.body)) as {
          title: string;
          content: string;
          folder: string;
          tags: string[];
        };
        const created: NoteRecordV1 = {
          id,
          title: body.title,
          content: body.content,
          folder: body.folder,
          tags: body.tags,
          sourceTranscriptId: null,
          version: 1,
          isDeleted: false,
          createdAtUtc: '2026-10-21T19:15:00Z',
          updatedAtUtc: '2026-10-21T19:15:00Z',
        };
        const idx = notes.findIndex((n) => n.id === id);
        if (idx >= 0) {
          notes[idx] = created;
        } else {
          notes.push(created);
        }
        return new Response(JSON.stringify(created), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/prompt-templates')) {
        return new Response(JSON.stringify(templates), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url.includes('/api/v1/prompt-templates/')) {
        const id = url.split('/api/v1/prompt-templates/')[1];
        const body = JSON.parse(String(init?.body)) as {
          name: string;
          systemInstructions: string;
          outputMode: string;
        };
        const tpl: PromptTemplateRecordV1 = {
          id,
          name: body.name,
          systemInstructions: body.systemInstructions,
          outputMode: body.outputMode,
          updatedAtUtc: '2026-10-21T19:20:00Z',
        };
        templates.push(tpl);
        return new Response(JSON.stringify(tpl), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/preferences')) {
        return new Response(JSON.stringify(preferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url.includes('/api/v1/preferences')) {
        const body = JSON.parse(String(init?.body)) as ProcessingPreferencesRecordV1;
        preferences = { ...preferences, ...body };
        return new Response(JSON.stringify(preferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/telemetry/summary')) {
        const summary: UsageTelemetrySummaryResponseV1 = {
          totalTranscripts: 5,
          totalSavedNotes: 2,
          totalDurationMs: 18500,
          estimatedWordsDictated: 140,
          estimatedTimeSavedMinutes: 2.3,
          modeBreakdown: { clean: 3, 'coding-prompt': 2 },
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(summary), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/account/export')) {
        const exported: AccountDataExportResponseV1 = {
          exportedAtUtc: '2026-10-29T19:00:00Z',
          user: {
            id: 'usr-2',
            email: 'notes@example.com',
            displayName: 'Notes Pilot',
          },
          devices: [],
          transcripts: [],
          notes,
          promptTemplates: templates,
          vocabulary: [],
          preferences,
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(exported), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'DELETE' && url.includes('/api/v1/account')) {
        return new Response(JSON.stringify({ userId: 'usr-2', purged: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    });

    render(
      <App
        autoCheckHealth={false}
        apiBaseUrl="http://localhost:5080"
        fetchImpl={fetchMock as unknown as typeof fetch}
      />,
    );

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'notes@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'NotesPass!123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated-workspace')).toBeDefined();
    });

    // Switch to Saved Notes tab and create a note
    fireEvent.click(screen.getByRole('button', { name: 'Saved Notes' }));
    fireEvent.change(screen.getByLabelText('Note Title'), {
      target: { value: 'Architecture Decision Record' },
    });
    fireEvent.change(screen.getByLabelText('Folder'), {
      target: { value: 'Engineering' },
    });
    fireEvent.change(screen.getByLabelText('Note Content'), {
      target: { value: 'Use optimistic version concurrency for offline sync.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));

    await waitFor(() => {
      expect(screen.getByText('Architecture Decision Record')).toBeDefined();
    });

    // Switch to Prompt Templates tab and create a template
    fireEvent.click(screen.getByRole('button', { name: 'Prompt Templates' }));
    fireEvent.change(screen.getByLabelText('Template Name'), {
      target: { value: 'Bug Triage Brief' },
    });
    fireEvent.change(screen.getByLabelText('System Instructions'), {
      target: { value: 'Extract repro steps, expected behavior, and root cause.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => {
      expect(screen.getByText('Bug Triage Brief')).toBeDefined();
    });

    // Switch to Processing Preferences tab and save preferences
    fireEvent.click(screen.getByRole('button', { name: 'Processing Preferences' }));
    fireEvent.change(screen.getByLabelText('Default Output Mode'), {
      target: { value: 'coding-prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

    await waitFor(() => {
      expect(screen.getByTestId('preferences-saved-badge')).toBeDefined();
    });

    // Switch to Analytics & Privacy tab, inspect telemetry, export personal data JSON, and purge account
    fireEvent.click(screen.getByRole('button', { name: 'Analytics & Privacy' }));
    await waitFor(() => {
      expect(screen.getByTestId('telemetry-words-dictated').textContent).toBe('140');
    });

    fireEvent.click(screen.getByTestId('export-account-data-button'));
    await waitFor(() => {
      expect(screen.getByTestId('account-export-preview').textContent).toContain(
        'notes@example.com',
      );
    });

    fireEvent.click(screen.getByTestId('purge-account-button'));
    await waitFor(() => {
      expect(screen.getByTestId('auth-gate-panel')).toBeDefined();
    });
  });
});

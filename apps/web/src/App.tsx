import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONTRACT_VERSION_V1,
  HEALTH_PATHS_V1,
  isHealthStatusResponseV1,
  type AuthSessionResponseV1,
  type ContractOutputModeV1,
  type HealthStatusResponseV1,
  type NoteRecordV1,
  type ProcessingPreferencesRecordV1,
  type PromptTemplateRecordV1,
  type TranscriptRecordV1,
  type VocabularyEntryRecordV1,
} from '@flowpilot/contracts';
import { WebApiClient } from './apiClient.js';

const DEFAULT_API_BASE_URL = 'http://localhost:5080';
const WEB_SESSION_STORAGE_KEY = 'flowpilot_web_auth_session_v1';

type WebRouteTab = 'transcripts' | 'notes' | 'vocabulary' | 'templates' | 'preferences';

export interface AppProps {
  apiBaseUrl?: string;
  autoCheckHealth?: boolean;
  fetchImpl?: typeof fetch;
}

let webIdCounter = 0;
function createClientRecordId(prefix: string): string {
  webIdCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${webIdCounter}`;
}

export function App({ apiBaseUrl, autoCheckHealth = true, fetchImpl }: AppProps) {
  const resolvedBaseUrl = apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const effectiveFetch = useMemo(
    () => fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    [fetchImpl],
  );

  const client = useMemo(
    () => new WebApiClient(resolvedBaseUrl, effectiveFetch),
    [resolvedBaseUrl, effectiveFetch],
  );

  const [health, setHealth] = useState<HealthStatusResponseV1 | null>(null);
  const [connectionState, setConnectionState] = useState<
    'idle' | 'checking' | 'connected' | 'offline'
  >('idle');

  const [session, setSession] = useState<AuthSessionResponseV1 | null>(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(WEB_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as AuthSessionResponseV1;
      client.setAccessToken(parsed.accessToken);
      return parsed;
    } catch {
      return null;
    }
  });

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');

  const [activeTab, setActiveTab] = useState<WebRouteTab>('transcripts');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Transcripts state
  const [transcripts, setTranscripts] = useState<TranscriptRecordV1[]>([]);
  const [transcriptSearch, setTranscriptSearch] = useState<string>('');
  const [transcriptPage, setTranscriptPage] = useState<number>(1);
  const [transcriptTotal, setTranscriptTotal] = useState<number>(0);
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editingTranscriptText, setEditingTranscriptText] = useState<string>('');

  // Notes state
  const [notes, setNotes] = useState<NoteRecordV1[]>([]);
  const [noteFolderFilter, setNoteFolderFilter] = useState<string>('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteFolder, setNoteFolder] = useState<string>('General');
  const [noteTags, setNoteTags] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');

  // Prompt Templates state
  const [templates, setTemplates] = useState<PromptTemplateRecordV1[]>([]);
  const [templateName, setTemplateName] = useState<string>('');
  const [templateMode, setTemplateMode] = useState<string>('clean');
  const [templateInstructions, setTemplateInstructions] = useState<string>('');

  // Custom Vocabulary state
  const [vocabList, setVocabList] = useState<VocabularyEntryRecordV1[]>([]);
  const [vocabSpoken, setVocabSpoken] = useState<string>('');
  const [vocabReplacement, setVocabReplacement] = useState<string>('');
  const [vocabCategory, setVocabCategory] = useState<string>('Product');

  // Processing Preferences state
  const [preferences, setPreferences] = useState<ProcessingPreferencesRecordV1>({
    defaultOutputMode: 'clean',
    defaultLanguage: 'auto',
    preferredSpeechMode: 'local',
    preferredRefinementMode: 'local',
    autoCopyToClipboard: false,
    syncEnabled: true,
    updatedAtUtc: '',
  });
  const [preferencesSaved, setPreferencesSaved] = useState<boolean>(false);

  const checkApiHealth = useCallback(async () => {
    setConnectionState('checking');
    try {
      const response = await effectiveFetch(`${resolvedBaseUrl}${HEALTH_PATHS_V1.v1}`);
      if (!response.ok) {
        setConnectionState('offline');
        return;
      }
      const data: unknown = await response.json();
      if (isHealthStatusResponseV1(data)) {
        setHealth(data);
        setConnectionState('connected');
      } else {
        setConnectionState('offline');
      }
    } catch {
      setConnectionState('offline');
    }
  }, [resolvedBaseUrl, effectiveFetch]);

  useEffect(() => {
    if (autoCheckHealth) {
      void checkApiHealth();
    }
  }, [autoCheckHealth, checkApiHealth]);

  const loadWorkspaceData = useCallback(async () => {
    if (!session) {
      return;
    }
    setSyncState('syncing');
    setErrorMessage(null);
    try {
      const [transcriptPageRes, notesPageRes, templateList, prefs] = await Promise.all([
        client.listTranscripts({
          page: transcriptPage,
          pageSize: 10,
          search: transcriptSearch,
        }),
        client.listNotes({
          page: 1,
          pageSize: 50,
          folder: noteFolderFilter,
        }),
        client.listPromptTemplates(),
        client.getPreferences(),
      ]);

      setTranscripts(transcriptPageRes.items);
      setTranscriptTotal(transcriptPageRes.totalCount);
      setNotes(notesPageRes.items);
      setTemplates(templateList);
      setPreferences(prefs);
      setSyncState('synced');
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to synchronize workspace.');
    }
  }, [session, client, transcriptPage, transcriptSearch, noteFolderFilter]);

  useEffect(() => {
    if (session) {
      void loadWorkspaceData();
    }
  }, [session, loadWorkspaceData]);

  const handleAuthenticate = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSyncState('syncing');
    try {
      const authSession =
        authMode === 'login'
          ? await client.login(email, password)
          : await client.register(email, password, displayName);

      // Security requirement: never store passwords in frontend state or storage
      setPassword('');
      setSession(authSession);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(authSession));
      }
      setSyncState('synced');
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.');
    }
  };

  const handleLogout = async () => {
    await client.logout();
    setSession(null);
    setTranscripts([]);
    setNotes([]);
    setTemplates([]);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(WEB_SESSION_STORAGE_KEY);
    }
  };

  const handleSaveTranscriptEdit = async (record: TranscriptRecordV1) => {
    setSyncState('syncing');
    setErrorMessage(null);
    try {
      await client.upsertTranscript(record.id, {
        idempotencyKey: createClientRecordId('idem-web-tr'),
        expectedVersion: record.version,
        deviceId: 'flowpilot-web-companion',
        originalTranscript: record.originalTranscript,
        refinedTranscript: record.refinedTranscript,
        editedText: editingTranscriptText,
        outputMode: record.outputMode,
        providerId: record.providerId,
        durationMs: record.durationMs,
        clientUpdatedAtUtc: new Date().toISOString(),
      });
      setEditingTranscriptId(null);
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update transcript.');
    }
  };

  const handleDeleteTranscript = async (id: string, permanent = false) => {
    setSyncState('syncing');
    setErrorMessage(null);
    try {
      await client.deleteTranscript(id, permanent);
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete transcript.');
    }
  };

  const handleSaveNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) {
      return;
    }

    setSyncState('syncing');
    setErrorMessage(null);
    try {
      const id = editingNoteId ?? createClientRecordId('note');
      const existing = notes.find((n) => n.id === id);
      const parsedTags = noteTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await client.upsertNote(id, {
        idempotencyKey: createClientRecordId('idem-web-note'),
        expectedVersion: existing?.version ?? 0,
        deviceId: 'flowpilot-web-companion',
        title: noteTitle.trim(),
        content: noteContent.trim(),
        folder: noteFolder.trim() || 'General',
        tags: parsedTags,
        sourceTranscriptId: existing?.sourceTranscriptId ?? null,
        clientUpdatedAtUtc: new Date().toISOString(),
      });

      setEditingNoteId(null);
      setNoteTitle('');
      setNoteContent('');
      setNoteTags('');
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save note.');
    }
  };

  const handleDeleteNote = async (id: string) => {
    setSyncState('syncing');
    try {
      await client.deleteNote(id, false);
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete note.');
    }
  };

  const handleSaveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateName.trim() || !templateInstructions.trim()) {
      return;
    }

    setSyncState('syncing');
    try {
      const id = createClientRecordId('tpl');
      await client.upsertPromptTemplate(id, {
        name: templateName.trim(),
        systemInstructions: templateInstructions.trim(),
        outputMode: templateMode,
      });
      setTemplateName('');
      setTemplateInstructions('');
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save template.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    setSyncState('syncing');
    try {
      await client.deletePromptTemplate(id);
      await loadWorkspaceData();
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete template.');
    }
  };

  const handleSaveVocab = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vocabSpoken.trim() || !vocabReplacement.trim()) {
      return;
    }
    setSyncState('syncing');
    try {
      const id = createClientRecordId('voc');
      const saved = await client.upsertVocabulary(id, {
        spokenPhrase: vocabSpoken.trim(),
        replacementTerm: vocabReplacement.trim(),
        category: vocabCategory.trim() || 'Product',
      });
      setVocabList((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      setVocabSpoken('');
      setVocabReplacement('');
      setSyncState('synced');
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save vocabulary entry.');
    }
  };

  const handleDeleteVocab = async (id: string) => {
    setSyncState('syncing');
    try {
      await client.deleteVocabulary(id);
      setVocabList((prev) => prev.filter((item) => item.id !== id));
      setSyncState('synced');
    } catch (error) {
      setSyncState('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to delete vocabulary entry.',
      );
    }
  };

  const handleSavePreferences = async (event: React.FormEvent) => {
    event.preventDefault();
    setPreferencesSaved(false);
    setSyncState('syncing');
    try {
      const updated = await client.updatePreferences({
        defaultOutputMode: preferences.defaultOutputMode as ContractOutputModeV1,
        defaultLanguage: preferences.defaultLanguage,
        preferredSpeechMode: preferences.preferredSpeechMode as 'local' | 'cloud',
        preferredRefinementMode: preferences.preferredRefinementMode as 'local' | 'cloud',
        autoCopyToClipboard: preferences.autoCopyToClipboard,
        syncEnabled: preferences.syncEnabled,
      });
      setPreferences(updated);
      setPreferencesSaved(true);
      setSyncState('synced');
    } catch (error) {
      setSyncState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save preferences.');
    }
  };

  return (
    <main className="app-shell">
      <header className="header">
        <div>
          <h1>FlowPilot Web Companion</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.25rem' }}>
            Personal AI Dictation — Account &amp; Cloud Sync Portal
          </p>
        </div>
        <div className="header-badges">
          <span className="badge" data-testid="web-sync-state-badge">
            Sync: {syncState}
          </span>
          <span className="badge">Contract {CONTRACT_VERSION_V1}</span>
        </div>
      </header>

      {errorMessage && (
        <section className="alert-banner" role="alert" data-testid="web-error-banner">
          <strong>Synchronization / API Notice:</strong> {errorMessage}
        </section>
      )}

      {!session ? (
        <div className="card-grid">
          <section className="card" data-testid="auth-gate-panel">
            <h2>{authMode === 'login' ? 'Sign In to FlowPilot' : 'Create FlowPilot Account'}</h2>
            <p>
              Sign in to access your synchronized desktop transcripts, saved notes, prompt
              templates, and processing preferences.
            </p>
            <form className="form-stack" onSubmit={(e) => void handleAuthenticate(e)}>
              {authMode === 'register' && (
                <div className="field-row">
                  <label htmlFor="web-auth-display-name">Display Name</label>
                  <input
                    id="web-auth-display-name"
                    type="text"
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="field-row">
                <label htmlFor="web-auth-email">Email Address</label>
                <input
                  id="web-auth-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field-row">
                <label htmlFor="web-auth-password">Password</label>
                <input
                  id="web-auth-password"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="button-row">
                <button type="submit" className="button">
                  {authMode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                >
                  {authMode === 'login'
                    ? 'Need an account? Register'
                    : 'Already registered? Sign In'}
                </button>
              </div>
            </form>
          </section>

          <article className="card">
            <h2>Shared Backend API Status</h2>
            <p>
              Connects to the ASP.NET Core Web API via explicit OpenAPI ({CONTRACT_VERSION_V1})
              contracts backed by PostgreSQL for shared account data.
            </p>
            <ul className="meta-list">
              <li>
                <span>Endpoint</span>
                <code>
                  {resolvedBaseUrl}
                  {HEALTH_PATHS_V1.v1}
                </code>
              </li>
              <li>
                <span>Connection State</span>
                <strong data-testid="api-connection-state">{connectionState}</strong>
              </li>
              <li>
                <span>API Status</span>
                <strong data-testid="api-health-status">{health?.status ?? 'Not checked'}</strong>
              </li>
            </ul>
            <button type="button" className="button" onClick={() => void checkApiHealth()}>
              Check API Health
            </button>
          </article>
        </div>
      ) : (
        <section data-testid="authenticated-workspace">
          <div className="workspace-bar">
            <div>
              <strong>Signed in as:</strong> {session.user.displayName} ({session.user.email})
              <span style={{ marginLeft: '1rem', color: '#94a3b8' }}>
                API State: <span data-testid="api-connection-state">{connectionState}</span>
              </span>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void loadWorkspaceData()}
              >
                Refresh Sync
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void handleLogout()}
              >
                Sign Out
              </button>
            </div>
          </div>

          <nav className="tab-nav" aria-label="Authenticated Sections">
            <button
              type="button"
              className={`button ${activeTab === 'transcripts' ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab('transcripts')}
            >
              Transcript History
            </button>
            <button
              type="button"
              className={`button ${activeTab === 'notes' ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab('notes')}
            >
              Saved Notes
            </button>
            <button
              type="button"
              className={`button ${activeTab === 'vocabulary' ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab('vocabulary')}
            >
              Custom Vocabulary
            </button>
            <button
              type="button"
              className={`button ${activeTab === 'templates' ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab('templates')}
            >
              Prompt Templates
            </button>
            <button
              type="button"
              className={`button ${activeTab === 'preferences' ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab('preferences')}
            >
              Processing Preferences
            </button>
          </nav>

          {activeTab === 'transcripts' && (
            <section className="card" data-testid="transcripts-view">
              <div className="section-header">
                <h2>Synchronized Transcript History ({transcriptTotal})</h2>
                <div className="field-inline">
                  <label htmlFor="web-transcript-search">Search Transcripts</label>
                  <input
                    id="web-transcript-search"
                    type="search"
                    className="input"
                    placeholder="Search transcripts..."
                    value={transcriptSearch}
                    onChange={(e) => {
                      setTranscriptPage(1);
                      setTranscriptSearch(e.target.value);
                    }}
                  />
                </div>
              </div>

              {transcripts.length === 0 ? (
                <p style={{ marginTop: '1rem' }}>No synchronized transcripts found.</p>
              ) : (
                <ul className="record-list" data-testid="web-transcript-list">
                  {transcripts.map((tr) => (
                    <li key={tr.id} className="record-item">
                      <div className="record-meta">
                        <span className="badge">{tr.outputMode}</span>
                        <span>
                          Device: {tr.deviceId} | v{tr.version}
                        </span>
                      </div>

                      {editingTranscriptId === tr.id ? (
                        <div className="form-stack">
                          <textarea
                            data-testid={`transcript-edit-input-${tr.id}`}
                            className="input"
                            rows={3}
                            value={editingTranscriptText}
                            onChange={(e) => setEditingTranscriptText(e.target.value)}
                          />
                          <div className="button-row">
                            <button
                              type="button"
                              className="button"
                              data-testid={`save-transcript-${tr.id}`}
                              onClick={() => void handleSaveTranscriptEdit(tr)}
                            >
                              Save Changes
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => setEditingTranscriptId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="record-primary">{tr.editedText}</p>
                          <p className="record-secondary">Original: {tr.originalTranscript}</p>
                          <div className="button-row">
                            <button
                              type="button"
                              className="button button-secondary"
                              data-testid={`edit-transcript-${tr.id}`}
                              onClick={() => {
                                setEditingTranscriptId(tr.id);
                                setEditingTranscriptText(tr.editedText);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button-danger"
                              data-testid={`delete-transcript-${tr.id}`}
                              onClick={() => void handleDeleteTranscript(tr.id, false)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="pagination-bar">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={transcriptPage <= 1}
                  onClick={() => setTranscriptPage((p) => Math.max(1, p - 1))}
                >
                  Previous Page
                </button>
                <span>Page {transcriptPage}</span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={transcriptPage * 10 >= transcriptTotal}
                  onClick={() => setTranscriptPage((p) => p + 1)}
                >
                  Next Page
                </button>
              </div>
            </section>
          )}

          {activeTab === 'notes' && (
            <div className="card-grid" data-testid="notes-view">
              <section className="card">
                <h2>{editingNoteId ? 'Edit Note' : 'Create Saved Note'}</h2>
                <form className="form-stack" onSubmit={(e) => void handleSaveNote(e)}>
                  <div className="field-row">
                    <label htmlFor="note-title-input">Note Title</label>
                    <input
                      id="note-title-input"
                      type="text"
                      className="input"
                      value={noteTitle}
                      onChange={(e) => setNoteTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="note-folder-input">Folder</label>
                    <input
                      id="note-folder-input"
                      type="text"
                      className="input"
                      value={noteFolder}
                      onChange={(e) => setNoteFolder(e.target.value)}
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="note-tags-input">Tags (comma-separated)</label>
                    <input
                      id="note-tags-input"
                      type="text"
                      className="input"
                      value={noteTags}
                      onChange={(e) => setNoteTags(e.target.value)}
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="note-content-input">Note Content</label>
                    <textarea
                      id="note-content-input"
                      className="input"
                      rows={4}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="button">
                    Save Note
                  </button>
                </form>
              </section>

              <section className="card">
                <div className="section-header">
                  <h2>Saved Notes ({notes.length})</h2>
                  <input
                    type="search"
                    className="input"
                    placeholder="Filter by folder..."
                    aria-label="Filter by folder"
                    value={noteFolderFilter}
                    onChange={(e) => setNoteFolderFilter(e.target.value)}
                  />
                </div>
                {notes.length === 0 ? (
                  <p style={{ marginTop: '1rem' }}>No saved notes yet.</p>
                ) : (
                  <ul className="record-list" data-testid="web-notes-list">
                    {notes.map((note) => (
                      <li key={note.id} className="record-item">
                        <div className="record-meta">
                          <span className="badge">{note.folder}</span>
                          <span>v{note.version}</span>
                        </div>
                        <strong>{note.title}</strong>
                        <p className="record-primary">{note.content}</p>
                        <div className="button-row">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => {
                              setEditingNoteId(note.id);
                              setNoteTitle(note.title);
                              setNoteFolder(note.folder);
                              setNoteTags(note.tags.join(', '));
                              setNoteContent(note.content);
                            }}
                          >
                            Edit Note
                          </button>
                          <button
                            type="button"
                            className="button button-danger"
                            onClick={() => void handleDeleteNote(note.id)}
                          >
                            Delete Note
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {activeTab === 'vocabulary' && (
            <div className="card-grid" data-testid="vocabulary-view">
              <section className="card">
                <h2>Add Custom Vocabulary Rule</h2>
                <form className="form-stack" onSubmit={(e) => void handleSaveVocab(e)}>
                  <div className="field-row">
                    <label htmlFor="vocab-spoken-input">Spoken Phrase</label>
                    <input
                      id="vocab-spoken-input"
                      type="text"
                      className="input"
                      placeholder="e.g. flow pilot"
                      value={vocabSpoken}
                      onChange={(e) => setVocabSpoken(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="vocab-replacement-input">Replacement Term</label>
                    <input
                      id="vocab-replacement-input"
                      type="text"
                      className="input"
                      placeholder="e.g. FlowPilot"
                      value={vocabReplacement}
                      onChange={(e) => setVocabReplacement(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="vocab-category-input">Category</label>
                    <input
                      id="vocab-category-input"
                      type="text"
                      className="input"
                      value={vocabCategory}
                      onChange={(e) => setVocabCategory(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="button">
                    Save Vocabulary Term
                  </button>
                </form>
              </section>

              <section className="card">
                <h2>Personal Dictionary ({vocabList.length})</h2>
                {vocabList.length === 0 ? (
                  <p style={{ marginTop: '1rem' }}>
                    No custom vocabulary rules saved yet. Add spoken-to-written replacements to
                    standardize technical terms across devices.
                  </p>
                ) : (
                  <ul className="record-list" data-testid="web-vocabulary-list">
                    {vocabList.map((item) => (
                      <li key={item.id} className="record-item">
                        <div className="record-meta">
                          <span className="badge">{item.category}</span>
                        </div>
                        <p className="record-primary">
                          &ldquo;{item.spokenPhrase}&rdquo; &rarr;{' '}
                          <strong>{item.replacementTerm}</strong>
                        </p>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => void handleDeleteVocab(item.id)}
                        >
                          Delete Term
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="card-grid" data-testid="templates-view">
              <section className="card">
                <h2>Create Prompt Template</h2>
                <form className="form-stack" onSubmit={(e) => void handleSaveTemplate(e)}>
                  <div className="field-row">
                    <label htmlFor="tpl-name-input">Template Name</label>
                    <input
                      id="tpl-name-input"
                      type="text"
                      className="input"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="tpl-mode-select">Target Output Mode</label>
                    <select
                      id="tpl-mode-select"
                      className="input"
                      value={templateMode}
                      onChange={(e) => setTemplateMode(e.target.value)}
                    >
                      <option value="raw">Raw Transcription</option>
                      <option value="clean">Clean Text</option>
                      <option value="professional">Professional Message</option>
                      <option value="coding-prompt">Coding Prompt</option>
                      <option value="quick-note">Quick Note</option>
                    </select>
                  </div>
                  <div className="field-row">
                    <label htmlFor="tpl-instructions-input">System Instructions</label>
                    <textarea
                      id="tpl-instructions-input"
                      className="input"
                      rows={4}
                      value={templateInstructions}
                      onChange={(e) => setTemplateInstructions(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="button">
                    Save Template
                  </button>
                </form>
              </section>

              <section className="card">
                <h2>Saved Prompt Templates ({templates.length})</h2>
                {templates.length === 0 ? (
                  <p style={{ marginTop: '1rem' }}>No custom prompt templates saved yet.</p>
                ) : (
                  <ul className="record-list">
                    {templates.map((tpl) => (
                      <li key={tpl.id} className="record-item">
                        <div className="record-meta">
                          <strong>{tpl.name}</strong>
                          <span className="badge">{tpl.outputMode}</span>
                        </div>
                        <p className="record-primary">{tpl.systemInstructions}</p>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => void handleDeleteTemplate(tpl.id)}
                        >
                          Delete Template
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {activeTab === 'preferences' && (
            <section className="card" data-testid="preferences-view">
              <h2>Processing &amp; Synchronization Preferences</h2>
              <form className="form-stack" onSubmit={(e) => void handleSavePreferences(e)}>
                <div className="field-row">
                  <label htmlFor="pref-output-mode">Default Output Mode</label>
                  <select
                    id="pref-output-mode"
                    className="input"
                    value={preferences.defaultOutputMode}
                    onChange={(e) =>
                      setPreferences({ ...preferences, defaultOutputMode: e.target.value })
                    }
                  >
                    <option value="raw">Raw Transcription</option>
                    <option value="clean">Clean Text</option>
                    <option value="professional">Professional Message</option>
                    <option value="coding-prompt">Coding Prompt</option>
                    <option value="quick-note">Quick Note</option>
                  </select>
                </div>

                <div className="field-row">
                  <label htmlFor="pref-language">Default Language</label>
                  <select
                    id="pref-language"
                    className="input"
                    value={preferences.defaultLanguage}
                    onChange={(e) =>
                      setPreferences({ ...preferences, defaultLanguage: e.target.value })
                    }
                  >
                    <option value="auto">Auto-Detect</option>
                    <option value="en">English (en)</option>
                    <option value="es">Spanish (es)</option>
                    <option value="fr">French (fr)</option>
                    <option value="de">German (de)</option>
                    <option value="ur">Urdu (ur)</option>
                    <option value="ja">Japanese (ja)</option>
                  </select>
                </div>

                <div className="field-row">
                  <label htmlFor="pref-speech-mode">Preferred Speech Mode</label>
                  <select
                    id="pref-speech-mode"
                    className="input"
                    value={preferences.preferredSpeechMode}
                    onChange={(e) =>
                      setPreferences({ ...preferences, preferredSpeechMode: e.target.value })
                    }
                  >
                    <option value="local">Local (whisper.cpp Offline)</option>
                    <option value="cloud">Cloud (FlowPilot Backend Proxy)</option>
                  </select>
                </div>

                <div className="field-row">
                  <label htmlFor="pref-refinement-mode">Preferred Refinement Mode</label>
                  <select
                    id="pref-refinement-mode"
                    className="input"
                    value={preferences.preferredRefinementMode}
                    onChange={(e) =>
                      setPreferences({ ...preferences, preferredRefinementMode: e.target.value })
                    }
                  >
                    <option value="local">Local (On-Device Deterministic)</option>
                    <option value="cloud">Cloud (FlowPilot Refinement API)</option>
                  </select>
                </div>

                <div className="field-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences.autoCopyToClipboard}
                      onChange={(e) =>
                        setPreferences({ ...preferences, autoCopyToClipboard: e.target.checked })
                      }
                    />{' '}
                    Automatically copy refined text to clipboard
                  </label>
                </div>

                <div className="field-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences.syncEnabled}
                      onChange={(e) =>
                        setPreferences({ ...preferences, syncEnabled: e.target.checked })
                      }
                    />{' '}
                    Enable opt-in cloud transcript &amp; note synchronization
                  </label>
                </div>

                <div className="button-row">
                  <button type="submit" className="button">
                    Save Preferences
                  </button>
                  {preferencesSaved && (
                    <span className="badge" data-testid="preferences-saved-badge">
                      Preferences Saved
                    </span>
                  )}
                </div>
              </form>
            </section>
          )}
        </section>
      )}
    </main>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMediaAudioCaptureService } from './dictation/audioCapture.js';
import { SystemClipboardService } from './dictation/clipboardService.js';
import {
  DictationController,
  type DictationControllerDependencies,
  type DictationSnapshot,
} from './dictation/dictationController.js';
import { LocalDictationHistoryRepository } from './dictation/historyRepository.js';
import { DeterministicTextRefinementService } from './dictation/textRefinement.js';
import { OpenAiWhisperTranscriptionProvider } from './dictation/transcriptionProvider.js';
import {
  OUTPUT_MODES,
  OUTPUT_MODE_LABELS,
  type DictationHistoryEntry,
  type OutputMode,
} from './dictation/types.js';
import { getDesktopStorageStatus, type DesktopStorageStatus } from './tauriBridge.js';

export interface AppProps {
  services?: DictationControllerDependencies;
}

export function App({ services }: AppProps) {
  const [runtimeApiKey, setRuntimeApiKey] = useState<string>(() => {
    const envKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
    return envKey ? envKey.trim() : '';
  });
  const apiKeyRef = useRef<string>(runtimeApiKey);
  apiKeyRef.current = runtimeApiKey;

  const controller = useMemo(() => {
    if (services) {
      return new DictationController(services);
    }

    return new DictationController({
      audioCapture: new BrowserMediaAudioCaptureService(),
      provider: new OpenAiWhisperTranscriptionProvider({
        getApiKey: () => apiKeyRef.current,
      }),
      textRefiner: new DeterministicTextRefinementService(),
      clipboard: new SystemClipboardService(),
      historyRepository: new LocalDictationHistoryRepository(),
    });
  }, [services]);

  const historyRepository = useMemo(() => {
    return services?.historyRepository ?? new LocalDictationHistoryRepository();
  }, [services]);

  const [snapshot, setSnapshot] = useState<DictationSnapshot>(() => controller.getSnapshot());
  const [storageStatus, setStorageStatus] = useState<DesktopStorageStatus>({
    runtime: 'browser-shell',
    sqliteEngine: 'rusqlite (initializing)',
    offlineReady: true,
    schemaVersion: 2,
  });

  const [historyEntries, setHistoryEntries] = useState<DictationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const refreshHistory = useCallback(
    async (query: string) => {
      setHistoryLoading(true);
      try {
        const list = await historyRepository.listHistory(query);
        setHistoryEntries(list);
      } finally {
        setHistoryLoading(false);
      }
    },
    [historyRepository],
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void getDesktopStorageStatus().then(setStorageStatus);
    void refreshHistory('');
    return unsubscribe;
  }, [controller, refreshHistory]);

  useEffect(() => {
    void refreshHistory(searchQuery);
  }, [searchQuery, refreshHistory]);

  // Accessible keyboard shortcuts: Escape cancels active recording/processing
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const current = controller.getSnapshot().workflowState;
        if (
          current === 'recording' ||
          current === 'requesting-permission' ||
          current === 'stopping' ||
          current === 'processing'
        ) {
          event.preventDefault();
          controller.cancel();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [controller]);

  const isBusy =
    snapshot.workflowState === 'requesting-permission' ||
    snapshot.workflowState === 'stopping' ||
    snapshot.workflowState === 'processing';

  const isRecording = snapshot.workflowState === 'recording';
  const canCancel = isRecording || isBusy;

  const handleSaveToHistory = async () => {
    setSaveFeedback(null);
    try {
      await controller.saveCurrentSession();
      setSaveFeedback('Saved to local history.');
      await refreshHistory(searchQuery);
    } catch {
      // Error is surfaced through controller snapshot.error
    }
  };

  const handleDeleteHistoryItem = async (id: string) => {
    await historyRepository.deleteEntry(id);
    await refreshHistory(searchQuery);
  };

  const handleLoadHistoryItem = (entry: DictationHistoryEntry) => {
    void controller.setOutputMode(entry.outputMode);
    controller.updateEditedText(entry.editedText);
  };

  return (
    <main className="desktop-shell">
      <header className="desktop-header">
        <div>
          <h1>FlowPilot Desktop</h1>
          <p className="subtitle">
            Personal AI Dictation — Real Audio Capture, Output Modes &amp; Local History
          </p>
        </div>
        <div className="header-badges">
          <span
            className={`status-pill state-${snapshot.workflowState}`}
            role="status"
            aria-live="polite"
            data-testid="workflow-state-badge"
          >
            State: {snapshot.workflowState}
          </span>
          <span className="status-pill" data-testid="desktop-runtime-pill">
            Runtime: {storageStatus.runtime}
          </span>
        </div>
      </header>

      {/* Permission Denied Banner */}
      {snapshot.workflowState === 'permission-denied' && (
        <section
          className="banner banner-warning"
          role="alert"
          data-testid="permission-denied-banner"
        >
          <strong>Microphone Access Denied</strong>
          <p>
            {snapshot.error?.message ??
              'Microphone permission was denied. Enable microphone access in Windows Settings > Privacy & security > Microphone and try again.'}
          </p>
        </section>
      )}

      {/* Explicit Error Banner */}
      {snapshot.error && snapshot.workflowState !== 'permission-denied' && (
        <section className="banner banner-error" role="alert" data-testid="error-state-banner">
          <strong>Error ({snapshot.error.code})</strong>
          <p>{snapshot.error.message}</p>
        </section>
      )}

      <div className="workspace-grid">
        {/* Left Column: Capture Controls & Transcript Editor */}
        <section className="panel" aria-labelledby="dictation-controls-heading">
          <div className="panel-header-row">
            <h2 id="dictation-controls-heading">Dictation Studio</h2>
            <div className="mode-selector-group">
              <label htmlFor="output-mode-select">Output Mode</label>
              <select
                id="output-mode-select"
                className="select-input"
                value={snapshot.outputMode}
                onChange={(e) => void controller.setOutputMode(e.target.value as OutputMode)}
              >
                {OUTPUT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {OUTPUT_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Provider Configuration */}
          {!services && (
            <div className="provider-config-row">
              <label htmlFor="openai-api-key-input">
                OpenAI API Key (Whisper-1 Speech Provider)
              </label>
              <input
                id="openai-api-key-input"
                type="password"
                className="text-input"
                placeholder="sk-... (or set VITE_OPENAI_API_KEY in .env)"
                value={runtimeApiKey}
                onChange={(e) => setRuntimeApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {/* Primary Action Toolbar */}
          <div className="control-toolbar" role="group" aria-label="Recording Controls">
            {!isRecording ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={isBusy}
                onClick={() => void controller.startRecording()}
              >
                Start Recording
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-stop"
                onClick={() => void controller.stopRecording()}
              >
                Stop &amp; Transcribe
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              disabled={!canCancel}
              onClick={() => controller.cancel()}
            >
              Cancel (Esc)
            </button>
          </div>

          {/* Loading / Processing Indicator */}
          {isBusy && (
            <div className="loading-indicator" role="status" data-testid="processing-state">
              {snapshot.workflowState === 'requesting-permission' &&
                'Requesting microphone permission...'}
              {snapshot.workflowState === 'stopping' && 'Finalizing captured audio...'}
              {snapshot.workflowState === 'processing' &&
                'Transcribing audio with speech provider...'}
            </div>
          )}

          {/* Transcript Workspace */}
          {!snapshot.originalTranscript && !isBusy ? (
            <div className="empty-box" data-testid="empty-transcript-state">
              <p>
                No active transcript yet. Click <strong>Start Recording</strong> to capture real
                microphone audio. Raw audio is discarded immediately after transcription completes.
              </p>
            </div>
          ) : (
            snapshot.originalTranscript && (
              <div className="transcript-section">
                <div className="original-box">
                  <div className="label-row">
                    <span>Original Verbatim Transcript (Preserved)</span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => controller.resetEditedToOriginal()}
                    >
                      Reset Editor to Original
                    </button>
                  </div>
                  <p data-testid="original-transcript-display">{snapshot.originalTranscript}</p>
                </div>

                <div className="editor-box">
                  <label htmlFor="editable-output-textarea">
                    Editable Output Text ({OUTPUT_MODE_LABELS[snapshot.outputMode]})
                  </label>
                  <textarea
                    id="editable-output-textarea"
                    className="textarea-input"
                    rows={6}
                    value={snapshot.editedText}
                    onChange={(e) => controller.updateEditedText(e.target.value)}
                  />
                </div>

                <div className="action-bar">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!snapshot.editedText.trim()}
                    onClick={() => {
                      void controller.copyEditedText().catch(() => {
                        // Error state already set in controller
                      });
                    }}
                  >
                    {snapshot.copiedToClipboard ? 'Copied to Clipboard!' : 'Copy to Clipboard'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!snapshot.editedText.trim()}
                    onClick={() => void handleSaveToHistory()}
                  >
                    Save to History
                  </button>

                  {saveFeedback && (
                    <span className="feedback-text" role="status">
                      {saveFeedback}
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </section>

        {/* Right Column: Searchable Local History */}
        <section className="panel" aria-labelledby="history-heading">
          <div className="panel-header-row">
            <h2 id="history-heading">Local Transcript History</h2>
            <span className="storage-meta" data-testid="offline-ready">
              SQLite Ready: {storageStatus.offlineReady ? 'Yes' : 'No'}
            </span>
          </div>

          <div className="search-row">
            <label htmlFor="history-search-input">Search History</label>
            <input
              id="history-search-input"
              type="search"
              className="text-input"
              placeholder="Search original or edited transcripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {historyLoading ? (
            <div className="empty-box" data-testid="history-loading-state">
              <p>Loading saved transcripts...</p>
            </div>
          ) : historyEntries.length === 0 ? (
            searchQuery.trim().length > 0 ? (
              <div className="empty-box" data-testid="empty-history-search-state">
                <p>No transcripts match &ldquo;{searchQuery}&rdquo;.</p>
              </div>
            ) : (
              <div className="empty-box" data-testid="empty-history-state">
                <p>No saved transcripts yet. Save a dictation session to access it offline.</p>
              </div>
            )
          ) : (
            <ul className="history-list" data-testid="history-list">
              {historyEntries.map((item) => (
                <li key={item.id} className="history-item">
                  <div className="history-item-header">
                    <span className="mode-tag">{OUTPUT_MODE_LABELS[item.outputMode]}</span>
                    <span className="timestamp">
                      {new Date(item.createdAtUtc).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="history-edited-text">{item.editedText}</p>
                  {item.originalTranscript !== item.editedText && (
                    <p className="history-original-preview">
                      Original: <em>{item.originalTranscript}</em>
                    </p>
                  )}
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => handleLoadHistoryItem(item)}
                    >
                      Load in Editor
                    </button>
                    <button
                      type="button"
                      className="btn-small btn-danger"
                      onClick={() => void handleDeleteHistoryItem(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

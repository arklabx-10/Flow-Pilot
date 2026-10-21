import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMediaAudioCaptureService } from './dictation/audioCapture.js';
import {
  CloudApiSpeechRecognitionProvider,
  CloudTextRefinementService,
  syncTranscriptEntryToCloud,
} from './dictation/cloudSpeechProvider.js';
import { SystemClipboardService } from './dictation/clipboardService.js';
import {
  DictationController,
  type DictationControllerDependencies,
  type DictationSnapshot,
} from './dictation/dictationController.js';
import { LocalDictationHistoryRepository } from './dictation/historyRepository.js';
import type { NoteRecordV1 } from '@flowpilot/contracts';
import {
  LocalWhisperModelManager,
  LocalWhisperSpeechProvider,
} from './dictation/localWhisperProvider.js';
import { DictationSettingsRepository } from './dictation/settingsRepository.js';
import {
  DesktopSyncEngine,
  type DesktopSyncStatus,
  type TranscriptConflictItem,
} from './dictation/syncEngine.js';
import { DeterministicTextRefinementService } from './dictation/textRefinement.js';
import {
  OUTPUT_MODES,
  OUTPUT_MODE_LABELS,
  SUPPORTED_LANGUAGES,
  type DictationHistoryEntry,
  type LocalWhisperModelId,
  type LocalWhisperModelStatus,
  type OutputMode,
  type RefinementProviderMode,
  type SpeechProviderMode,
  type TranscriptionLanguage,
} from './dictation/types.js';
import { getDesktopStorageStatus, type DesktopStorageStatus } from './tauriBridge.js';

export interface AppProps {
  services?: DictationControllerDependencies;
  modelManager?: LocalWhisperModelManager;
  syncEngine?: DesktopSyncEngine;
}

export function App({
  services,
  modelManager: injectedModelManager,
  syncEngine: injectedSyncEngine,
}: AppProps) {
  const localModelManager = useMemo(() => {
    return injectedModelManager ?? new LocalWhisperModelManager();
  }, [injectedModelManager]);

  const historyRepository = useMemo(() => {
    return services?.historyRepository ?? new LocalDictationHistoryRepository();
  }, [services]);

  const syncEngine = useMemo(() => {
    return injectedSyncEngine ?? new DesktopSyncEngine({ historyRepository });
  }, [injectedSyncEngine, historyRepository]);

  const selectedModelRef = useRef<LocalWhisperModelId>('tiny.en');

  const controller = useMemo(() => {
    if (services) {
      return new DictationController(services);
    }

    const settingsRepo = new DictationSettingsRepository();
    const initialSettings = settingsRepo.loadSettings();
    selectedModelRef.current = initialSettings.selectedLocalModelId;

    const localSpeech = new LocalWhisperSpeechProvider({
      modelManager: localModelManager,
      getSelectedModelId: () => selectedModelRef.current,
    });
    const cloudSpeech = new CloudApiSpeechRecognitionProvider();
    const localRefiner = new DeterministicTextRefinementService();
    const cloudRefiner = new CloudTextRefinementService();

    return new DictationController({
      audioCapture: new BrowserMediaAudioCaptureService(),
      provider: localSpeech,
      localSpeechProvider: localSpeech,
      cloudSpeechProvider: cloudSpeech,
      textRefiner: localRefiner,
      localTextRefiner: localRefiner,
      cloudTextRefiner: cloudRefiner,
      clipboard: new SystemClipboardService(),
      historyRepository,
      settingsRepository: settingsRepo,
      syncTranscriptToCloud: async (entry) => {
        await syncEngine.enqueueTranscriptUpsert(entry);
        await syncEngine.syncNow({ syncEnabled: true });
        await syncTranscriptEntryToCloud(entry);
      },
    });
  }, [services, localModelManager, historyRepository, syncEngine]);

  const [snapshot, setSnapshot] = useState<DictationSnapshot>(() => controller.getSnapshot());
  selectedModelRef.current = snapshot.settings.selectedLocalModelId;

  const [modelStatus, setModelStatus] = useState<LocalWhisperModelStatus>(() =>
    localModelManager.getModelStatus(snapshot.settings.selectedLocalModelId),
  );

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

  const [syncStatus, setSyncStatus] = useState<DesktopSyncStatus>(() => syncEngine.getStatus());
  const [conflicts, setConflicts] = useState<TranscriptConflictItem[]>([]);
  const [syncedNotes, setSyncedNotes] = useState<NoteRecordV1[]>(() =>
    syncEngine.listSyncedNotes(),
  );

  const refreshSyncState = useCallback(async () => {
    const conflictList = await syncEngine.listConflicts();
    setConflicts(conflictList);
    setSyncedNotes(syncEngine.listSyncedNotes());
    setSyncStatus(syncEngine.getStatus());
  }, [syncEngine]);

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
    void refreshSyncState();
    return unsubscribe;
  }, [controller, refreshHistory, refreshSyncState]);

  useEffect(() => {
    setModelStatus(localModelManager.getModelStatus(snapshot.settings.selectedLocalModelId));
  }, [localModelManager, snapshot.settings.selectedLocalModelId]);

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
      setSaveFeedback(
        snapshot.settings.syncTranscriptsToCloud
          ? 'Saved locally and synced to cloud.'
          : 'Saved to local history (offline-only).',
      );
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

  const handleDownloadModel = async () => {
    const modelId = snapshot.settings.selectedLocalModelId;
    try {
      await localModelManager.downloadModel(modelId, (status) => {
        setModelStatus(status);
      });
    } catch {
      setModelStatus(localModelManager.getModelStatus(modelId));
    }
  };

  const handleCancelModelDownload = () => {
    const modelId = snapshot.settings.selectedLocalModelId;
    localModelManager.cancelDownload(modelId);
    setModelStatus(localModelManager.getModelStatus(modelId));
  };

  const handleSyncNow = async () => {
    await syncEngine.syncNow({
      syncEnabled: snapshot.settings.syncTranscriptsToCloud,
      forceIgnoreBackoff: true,
    });
    await refreshSyncState();
    await refreshHistory(searchQuery);
  };

  const handleKeepLocalConflict = async (entityId: string) => {
    await syncEngine.resolveConflictKeepLocal(entityId);
    await handleSyncNow();
  };

  const handleAcceptServerConflict = async (entityId: string) => {
    await syncEngine.resolveConflictAcceptServer(entityId);
    await refreshSyncState();
    await refreshHistory(searchQuery);
  };

  return (
    <main className="desktop-shell">
      <header className="desktop-header">
        <div>
          <h1>FlowPilot Desktop</h1>
          <p className="subtitle">
            Personal AI Dictation — Local whisper.cpp &amp; Cloud Speech with Privacy Controls
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

      {/* Explicit Outbound Audio Transfer Notice when Cloud Speech is active */}
      {snapshot.settings.speechProviderMode === 'cloud' && (
        <section className="banner banner-info" role="status" data-testid="outbound-audio-notice">
          <strong>Outbound Audio Notice (Cloud Speech Mode Active)</strong>
          <p>
            Captured microphone audio will be transmitted over HTTPS to the configured FlowPilot
            Cloud Speech API for transcription. Switch Speech Provider to{' '}
            <strong>Local (whisper.cpp)</strong> to keep all audio on-device.
          </p>
        </section>
      )}

      {/* Explicit Opt-In Cloud Synchronization Disclosure */}
      {snapshot.settings.syncTranscriptsToCloud && (
        <section className="banner banner-info" role="status" data-testid="sync-disclosure-banner">
          <strong>Opt-In Cloud Synchronization Active (What Leaves This Device)</strong>
          <p>
            Only saved transcript text, refined/edited text, output mode, duration metadata, and
            your device identifier leave this device to sync with your authenticated FlowPilot
            account. <strong>Raw microphone audio is never uploaded during history sync.</strong>
          </p>
        </section>
      )}

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
        {/* Left Column: Capture Controls, Provider/Privacy Settings & Transcript Editor */}
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

          {/* Independent Speech, Refinement, Language & Privacy Settings */}
          <div className="settings-grid" role="group" aria-label="Provider and Privacy Settings">
            <div className="field-group">
              <label htmlFor="speech-provider-select">Speech Provider</label>
              <select
                id="speech-provider-select"
                className="select-input"
                value={snapshot.settings.speechProviderMode}
                onChange={(e) =>
                  controller.updateSettings({
                    speechProviderMode: e.target.value as SpeechProviderMode,
                  })
                }
              >
                <option value="local">Local (whisper.cpp Offline)</option>
                <option value="cloud">Cloud (FlowPilot Backend Proxy)</option>
              </select>
            </div>

            {snapshot.settings.speechProviderMode === 'local' ? (
              <div className="field-group">
                <label htmlFor="local-model-select">Local Whisper Model</label>
                <select
                  id="local-model-select"
                  className="select-input"
                  value={snapshot.settings.selectedLocalModelId}
                  onChange={(e) =>
                    controller.updateSettings({
                      selectedLocalModelId: e.target.value as LocalWhisperModelId,
                    })
                  }
                >
                  {localModelManager.listModels().map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName} ({model.sizeMb} MB)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field-group">
                <label htmlFor="cloud-provider-select">Configured Cloud Provider</label>
                <select
                  id="cloud-provider-select"
                  className="select-input"
                  value={snapshot.settings.selectedCloudProviderId}
                  onChange={(e) =>
                    controller.updateSettings({
                      selectedCloudProviderId: e.target.value,
                    })
                  }
                >
                  <option value="flowpilot-cloud-openai">
                    FlowPilot Cloud Speech (Server-Managed Credentials)
                  </option>
                </select>
              </div>
            )}

            <div className="field-group">
              <label htmlFor="transcription-language-select">Transcription Language</label>
              <select
                id="transcription-language-select"
                className="select-input"
                value={snapshot.settings.language}
                onChange={(e) =>
                  controller.updateSettings({
                    language: e.target.value as TranscriptionLanguage,
                  })
                }
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="refinement-provider-select">Text-Refinement Provider</label>
              <select
                id="refinement-provider-select"
                className="select-input"
                value={snapshot.settings.refinementProviderMode}
                onChange={(e) =>
                  controller.updateSettings({
                    refinementProviderMode: e.target.value as RefinementProviderMode,
                  })
                }
              >
                <option value="local">Local (On-Device Deterministic)</option>
                <option value="cloud">Cloud (FlowPilot Refinement API)</option>
              </select>
            </div>
          </div>

          {/* Local Model Download & Status Bar */}
          {snapshot.settings.speechProviderMode === 'local' && (
            <div className="model-status-box" data-testid="local-model-status-box">
              <div className="model-status-info">
                <span>
                  Model Status ({snapshot.settings.selectedLocalModelId}):{' '}
                  <strong data-testid="local-model-state">{modelStatus.state}</strong>
                  {modelStatus.state === 'downloading' && ` (${modelStatus.progressPercent}%)`}
                </span>
                {modelStatus.errorMessage && (
                  <span className="model-error-text">{modelStatus.errorMessage}</span>
                )}
              </div>
              <div className="model-status-actions">
                {modelStatus.state !== 'ready' && modelStatus.state !== 'downloading' && (
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => void handleDownloadModel()}
                  >
                    Download Model
                  </button>
                )}
                {modelStatus.state === 'downloading' && (
                  <button
                    type="button"
                    className="btn-small btn-danger"
                    onClick={handleCancelModelDownload}
                  >
                    Cancel Download
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Privacy Checkboxes */}
          <div className="privacy-toggles-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={snapshot.settings.translateToEnglish}
                onChange={(e) =>
                  controller.updateSettings({ translateToEnglish: e.target.checked })
                }
              />
              Translate speech to English
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={snapshot.settings.syncTranscriptsToCloud}
                onChange={(e) =>
                  controller.updateSettings({ syncTranscriptsToCloud: e.target.checked })
                }
              />
              Sync saved transcripts to cloud
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={snapshot.settings.retainRecordings}
                onChange={(e) => controller.updateSettings({ retainRecordings: e.target.checked })}
              />
              Retain audio recording in session
            </label>
          </div>

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
                microphone audio. Raw audio is discarded immediately after transcription completes
                unless recording retention is enabled.
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

          {/* Cloud Synchronization Status, Conflict Resolution, and Synced Web Notes */}
          {snapshot.settings.syncTranscriptsToCloud && (
            <div className="sync-panel-box" data-testid="desktop-sync-panel">
              <div className="panel-header-row">
                <h3>Cloud Sync &amp; Shared Notes</h3>
                <button type="button" className="btn-small" onClick={() => void handleSyncNow()}>
                  Sync Now
                </button>
              </div>
              <p className="storage-meta" data-testid="desktop-sync-status-text">
                Sync Status: <strong>{syncStatus.state}</strong> | Pending Queue:{' '}
                {syncStatus.pendingCount}
              </p>

              {syncStatus.lastErrorMessage && (
                <p className="model-error-text" role="alert">
                  {syncStatus.lastErrorMessage}
                </p>
              )}

              {conflicts.length > 0 && (
                <div className="conflict-list" data-testid="desktop-conflict-list">
                  <strong>Concurrent Edit Conflicts Detected</strong>
                  {conflicts.map((conflict) => (
                    <div key={conflict.queueItemId} className="history-item">
                      <p>
                        <strong>Local Edit:</strong> {conflict.localPayload.editedText}
                      </p>
                      <p>
                        <strong>Server (v{conflict.serverVersion}):</strong>{' '}
                        {conflict.serverRecord.editedText}
                      </p>
                      <div className="history-item-actions">
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => void handleKeepLocalConflict(conflict.entityId)}
                        >
                          Keep Local Edit
                        </button>
                        <button
                          type="button"
                          className="btn-small btn-secondary"
                          onClick={() => void handleAcceptServerConflict(conflict.entityId)}
                        >
                          Accept Server Version
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="synced-notes-section" data-testid="desktop-synced-notes">
                <h4>Synced Notes from Web Companion ({syncedNotes.length})</h4>
                {syncedNotes.length === 0 ? (
                  <p className="storage-meta">
                    No cloud notes synced yet. Notes saved in the Web Companion appear here after
                    synchronization.
                  </p>
                ) : (
                  <ul className="history-list">
                    {syncedNotes.map((note) => (
                      <li key={note.id} className="history-item">
                        <div className="history-item-header">
                          <span className="mode-tag">{note.folder}</span>
                          <span className="timestamp">v{note.version}</span>
                        </div>
                        <strong>{note.title}</strong>
                        <p className="history-edited-text">{note.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

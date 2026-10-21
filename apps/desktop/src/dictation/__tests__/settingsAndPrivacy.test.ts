import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DictationController } from '../dictationController.js';
import { LocalDictationHistoryRepository } from '../historyRepository.js';
import { DictationSettingsRepository } from '../settingsRepository.js';
import { DeterministicTextRefinementService } from '../textRefinement.js';
import type {
  AudioCaptureService,
  ClipboardService,
  ISpeechRecognitionProvider,
  TextRefinementService,
} from '../types.js';

describe('DictationSettingsRepository & Independent Provider/Privacy Controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists independent speech provider, refinement provider, language, sync, and recording retention settings', () => {
    const repo = new DictationSettingsRepository({ storageKey: 'flowpilot_test_settings' });
    const defaults = repo.loadSettings();

    expect(defaults.speechProviderMode).toBe('local');
    expect(defaults.selectedLocalModelId).toBe('tiny.en');
    expect(defaults.refinementProviderMode).toBe('local');
    expect(defaults.syncTranscriptsToCloud).toBe(false);
    expect(defaults.retainRecordings).toBe(false);

    const updated = repo.updateSettings({
      speechProviderMode: 'local',
      refinementProviderMode: 'cloud',
      language: 'es',
      translateToEnglish: true,
      syncTranscriptsToCloud: true,
      retainRecordings: true,
    });

    expect(updated.speechProviderMode).toBe('local');
    expect(updated.refinementProviderMode).toBe('cloud');
    expect(updated.language).toBe('es');
    expect(updated.translateToEnglish).toBe(true);
    expect(updated.syncTranscriptsToCloud).toBe(true);
    expect(updated.retainRecordings).toBe(true);

    const reloaded = repo.loadSettings();
    expect(reloaded).toEqual(updated);
  });

  it('allows combining Local Speech with Cloud Refinement and respects retainRecordings and syncTranscriptsToCloud', async () => {
    const rawBytes = new Uint8Array([11, 22, 33, 44]);
    const audioCapture: AudioCaptureService = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      stopRecording: vi.fn().mockImplementation(async () => ({
        bytes: new Uint8Array(rawBytes),
        mimeType: 'audio/webm',
        durationMs: 1500,
      })),
      abortRecording: vi.fn(),
      isRecording: vi.fn().mockReturnValue(false),
    };

    const localSpeechProvider: ISpeechRecognitionProvider = {
      id: 'local-whisper-cpp',
      displayName: 'Local whisper.cpp',
      requiresOutboundAudioTransfer: false,
      isConfigured: () => true,
      transcribe: vi.fn().mockResolvedValue({
        transcript: 'um local whisper transcript',
        providerId: 'local-whisper-cpp',
      }),
    };

    const cloudSpeechProvider: ISpeechRecognitionProvider = {
      id: 'flowpilot-cloud-openai',
      displayName: 'FlowPilot Cloud Speech',
      requiresOutboundAudioTransfer: true,
      isConfigured: () => true,
      transcribe: vi.fn().mockResolvedValue({
        transcript: 'cloud transcript',
        providerId: 'flowpilot-cloud-openai',
      }),
    };

    const localRefiner = new DeterministicTextRefinementService();
    const cloudRefiner: TextRefinementService = {
      refine: vi.fn().mockResolvedValue('Cloud-refined output text.'),
    };

    const clipboard: ClipboardService = {
      copyText: vi.fn().mockResolvedValue(undefined),
    };

    const historyRepository = new LocalDictationHistoryRepository({
      storageKey: 'flowpilot_test_priv_history',
    });
    const settingsRepository = new DictationSettingsRepository({
      storageKey: 'flowpilot_test_priv_settings',
    });

    const cloudSyncSpy = vi.fn().mockResolvedValue(undefined);

    const controller = new DictationController({
      audioCapture,
      provider: localSpeechProvider,
      localSpeechProvider,
      cloudSpeechProvider,
      textRefiner: localRefiner,
      localTextRefiner: localRefiner,
      cloudTextRefiner: cloudRefiner,
      clipboard,
      historyRepository,
      settingsRepository,
      syncTranscriptToCloud: cloudSyncSpy,
    });

    // Configure Local Speech + Cloud Refinement + retainRecordings = false + syncTranscriptsToCloud = false
    controller.updateSettings({
      speechProviderMode: 'local',
      refinementProviderMode: 'cloud',
      retainRecordings: false,
      syncTranscriptsToCloud: false,
    });

    await controller.startRecording();
    await controller.stopRecording('clean');

    expect(localSpeechProvider.transcribe).toHaveBeenCalledTimes(1);
    expect(cloudSpeechProvider.transcribe).not.toHaveBeenCalled();
    expect(cloudRefiner.refine).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().refinedTranscript).toBe('Cloud-refined output text.');
    expect(controller.getSnapshot().retainedAudioBytes).toBeNull();

    await controller.saveCurrentSession();
    expect(cloudSyncSpy).not.toHaveBeenCalled();

    // Now enable retainRecordings and syncTranscriptsToCloud
    controller.updateSettings({
      retainRecordings: true,
      syncTranscriptsToCloud: true,
    });

    await controller.startRecording();
    await controller.stopRecording('clean');
    expect(controller.getSnapshot().retainedAudioBytes).toBe(4);

    await controller.saveCurrentSession();
    expect(cloudSyncSpy).toHaveBeenCalledTimes(1);
  });
});

import { invoke } from '@tauri-apps/api/core';

export interface DesktopStorageStatus {
  runtime: 'tauri-native' | 'browser-shell';
  sqliteEngine: string;
  offlineReady: boolean;
  schemaVersion: number;
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getDesktopStorageStatus(): Promise<DesktopStorageStatus> {
  if (!isTauriEnvironment()) {
    return {
      runtime: 'browser-shell',
      sqliteEngine: 'rusqlite (simulated in browser shell)',
      offlineReady: true,
      schemaVersion: 1,
    };
  }

  try {
    return await invoke<DesktopStorageStatus>('get_desktop_storage_status');
  } catch {
    return {
      runtime: 'tauri-native',
      sqliteEngine: 'rusqlite',
      offlineReady: false,
      schemaVersion: 1,
    };
  }
}

import { useEffect, useState } from 'react';
import { CONTRACT_VERSION_V1, HEALTH_PATHS_V1 } from '@flowpilot/contracts';
import { getDesktopStorageStatus, type DesktopStorageStatus } from './tauriBridge.js';

export function App() {
  const [storageStatus, setStorageStatus] = useState<DesktopStorageStatus>({
    runtime: 'browser-shell',
    sqliteEngine: 'rusqlite (initializing)',
    offlineReady: true,
    schemaVersion: 1,
  });

  useEffect(() => {
    void getDesktopStorageStatus().then(setStorageStatus);
  }, []);

  return (
    <main className="desktop-shell">
      <header className="desktop-header">
        <div>
          <h1>FlowPilot Desktop</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.25rem' }}>
            Windows AI Dictation Shell — Offline-First SQLite + Cloud Sync
          </p>
        </div>
        <span className="status-pill" data-testid="desktop-runtime-pill">
          Runtime: {storageStatus.runtime}
        </span>
      </header>

      <section className="panel-grid" aria-label="Desktop Diagnostics">
        <article className="panel">
          <h2>Local SQLite Persistence</h2>
          <p>
            Offline dictation sessions, shortcut bindings, and pending sync queues are persisted
            locally on Windows via Tauri 2 + SQLite.
          </p>
          <ul className="kv-list">
            <li>
              <span>Storage Engine</span>
              <strong data-testid="sqlite-engine">{storageStatus.sqliteEngine}</strong>
            </li>
            <li>
              <span>Offline Mode Ready</span>
              <strong data-testid="offline-ready">
                {storageStatus.offlineReady ? 'Yes' : 'No'}
              </strong>
            </li>
            <li>
              <span>Local Schema Version</span>
              <strong>v{storageStatus.schemaVersion}</strong>
            </li>
          </ul>
        </article>

        <article className="panel">
          <h2>Cloud Sync Contract</h2>
          <p>
            Synchronizes shared account dictionary and settings with the FlowPilot ASP.NET Core Web
            API when online.
          </p>
          <ul className="kv-list">
            <li>
              <span>Contract Version</span>
              <strong>{CONTRACT_VERSION_V1}</strong>
            </li>
            <li>
              <span>Health Probe Path</span>
              <code>{HEALTH_PATHS_V1.v1}</code>
            </li>
            <li>
              <span>Shared Account Store</span>
              <strong>PostgreSQL</strong>
            </li>
          </ul>
        </article>
      </section>
    </main>
  );
}

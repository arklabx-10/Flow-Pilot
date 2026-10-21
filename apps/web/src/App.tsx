import { useCallback, useEffect, useState } from 'react';
import {
  CONTRACT_VERSION_V1,
  HEALTH_PATHS_V1,
  isHealthStatusResponseV1,
  type HealthStatusResponseV1,
} from '@flowpilot/contracts';

const DEFAULT_API_BASE_URL = 'http://localhost:5080';

export interface AppProps {
  apiBaseUrl?: string;
  autoCheckHealth?: boolean;
}

export function App({ apiBaseUrl, autoCheckHealth = true }: AppProps) {
  const resolvedBaseUrl = apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  const [health, setHealth] = useState<HealthStatusResponseV1 | null>(null);
  const [connectionState, setConnectionState] = useState<
    'idle' | 'checking' | 'connected' | 'offline'
  >('idle');

  const checkApiHealth = useCallback(async () => {
    setConnectionState('checking');
    try {
      const response = await fetch(`${resolvedBaseUrl}${HEALTH_PATHS_V1.v1}`);
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
  }, [resolvedBaseUrl]);

  useEffect(() => {
    if (autoCheckHealth) {
      void checkApiHealth();
    }
  }, [autoCheckHealth, checkApiHealth]);

  return (
    <main className="app-shell">
      <header className="header">
        <div>
          <h1>FlowPilot Web Companion</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.25rem' }}>
            Personal AI Dictation — Account &amp; Cloud Sync Portal
          </p>
        </div>
        <span className="badge">Contract {CONTRACT_VERSION_V1}</span>
      </header>

      <section className="card-grid" aria-label="Companion Status">
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
            <li>
              <span>PostgreSQL Config</span>
              <strong>{health?.postgresMode ?? 'Unknown'}</strong>
            </li>
          </ul>
          <button type="button" className="button" onClick={() => void checkApiHealth()}>
            Check API Health
          </button>
        </article>

        <article className="card">
          <h2>Phase 1 Foundation</h2>
          <p>
            This web shell is independently buildable and shares strict contract definitions with
            the Windows Tauri 2 desktop client and ASP.NET Core API.
          </p>
          <ul className="meta-list">
            <li>
              <span>Shared Account Store</span>
              <strong>PostgreSQL 17</strong>
            </li>
            <li>
              <span>Desktop Offline Store</span>
              <strong>SQLite (Local)</strong>
            </li>
            <li>
              <span>OpenAPI Spec</span>
              <code>{HEALTH_PATHS_V1.openApiDocument}</code>
            </li>
          </ul>
        </article>
      </section>
    </main>
  );
}

# FlowPilot

**FlowPilot** is an offline-first personal AI dictation product featuring a native Windows desktop application (Tauri 2 + React 19 + TypeScript + local SQLite + `whisper.cpp`) and a web companion application (React 19 + TypeScript), backed by an ASP.NET Core Web API (.NET 10 LTS + PostgreSQL) and explicit OpenAPI 3.1 contracts.

---

## Completed Capabilities (Phases 1–7)

1. **Phase 1 — Monorepo & Contract-First Foundation**:
   - Strict workspace boundaries (`apps/desktop`, `apps/web`, `services/api`, `packages/contracts`, `docs`, `scripts`), `AGENTS.md` charter, and self-contained CI verification.
2. **Phase 2 — Real Desktop Dictation Vertical Slice**:
   - Microphone capture (`MediaRecorder`), deterministic output modes (**Raw Transcription**, **Clean Text**, **Professional Message**, **Coding Prompt**, **Quick Note**), verbatim transcript preservation, Windows clipboard integration, and local SQLite/browser history.
3. **Phase 3 — Local (`whisper.cpp`) & Cloud Speech Providers**:
   - Pluggable `ISpeechRecognitionProvider` with non-blocking local `whisper.cpp` GGML model management (selection, download progress, cancellation) and server-proxied Cloud Speech with explicit outbound audio privacy notices.
4. **Phase 4 — Shared History & Offline Synchronization**:
   - Authenticated ASP.NET Core endpoints (`/api/v1/auth/*`, `/devices`, `/transcripts`, `/notes`, `/prompt-templates`, `/preferences`), PostgreSQL migrations & composite indexes, PBKDF2 + HMAC-SHA256 Bearer auth, record-level ownership, optimistic version concurrency (`HTTP 409 Conflict`), idempotent `PUT` operations, soft/hard deletion policy, and `DesktopSyncEngine` with bounded exponential backoff.
5. **Phase 5 — Global Windows Shortcuts, System Tray & Custom Vocabulary**:
   - Configurable keyboard shortcuts (`Ctrl+Shift+Space` toggle recording, `Ctrl+Shift+C` copy output, `Escape` cancel), system tray preferences, and cross-device Custom Vocabulary (`/api/v1/vocabulary`) for automatic spoken-to-written term replacement.
6. **Phase 6 — Usage Telemetry, Personal Data Export/Deletion Compliance & Active-Window Auto-Paste**:
   - Productivity telemetry aggregation (`/api/v1/telemetry/summary` and local desktop productivity metrics), GDPR/privacy JSON personal data export (`/api/v1/account/export`), full account & data purge (`DELETE /api/v1/account`), and Windows active-window auto-paste readiness (`simulate_active_window_paste`).
7. **Phase 7 — Production Release Packaging, Containerization & Unified Dev Stack Runner**:
   - Automated Windows `.msi`/`.exe` installer release pipeline (`.github/workflows/release-desktop.yml`), multi-stage production Dockerfiles (`services/api/Dockerfile`, `apps/web/Dockerfile`), full-stack Docker Compose profile (`docker compose --profile full-stack up --build`), and zero-config unified local runner (`npm run dev:all`).

---

## Monorepo Structure

| Path                                         | Description                                                      | Tech Stack                                                      |
| :------------------------------------------- | :--------------------------------------------------------------- | :-------------------------------------------------------------- |
| [`apps/desktop`](./apps/desktop)             | Windows desktop application shell & local offline persistence    | Tauri 2 (Rust), React 19, TypeScript, Vite, SQLite (`rusqlite`) |
| [`apps/web`](./apps/web)                     | Web companion application for account & dictionary management    | React 19, TypeScript, Vite                                      |
| [`services/api`](./services/api)             | Shared backend HTTP API & health checks                          | ASP.NET Core (.NET 10 LTS), OpenAPI, PostgreSQL (`Npgsql`)      |
| [`packages/contracts`](./packages/contracts) | Versioned OpenAPI specifications & shared TypeScript DTOs        | OpenAPI 3.1, TypeScript, Vitest                                 |
| [`docs/`](./docs)                            | Architecture, local development, and Windows setup documentation | Markdown                                                        |
| [`scripts/`](./scripts)                      | Environment verification and monorepo check scripts              | Node.js ESM (`.mjs`)                                            |

---

## Quick Start

### 1. Check Prerequisites

Run the environment diagnostic script to inspect your local toolchains:

```bash
node scripts/check-env.mjs
```

See [docs/windows-prerequisites.md](./docs/windows-prerequisites.md) for installing Node.js, .NET 10 LTS SDK, Rust, and Windows desktop build dependencies.

### 2. Configure Environment Variables

Copy the safe placeholder template to `.env`:

```bash
cp .env.example .env
```

_(On Windows PowerShell: `Copy-Item .env.example .env`)_

### 3. Install Dependencies & Build Contracts

```bash
npm install
npm run build
```

### 4. Start Local PostgreSQL (Optional for Phase 1 Health Checks)

```bash
docker compose up -d
```

### 5. Run the Applications

Launch the entire local stack (`FlowPilot.Api` on `:5080`, `Web Companion` on `:5173`, and `Desktop App UI Shell` on `:1420`) with a single command (automatically falls back to EF Core InMemory if local PostgreSQL on `:5432` is not running):

```bash
npm run dev:all
```

Or start each application independently:

- **Backend API (`http://localhost:5080`)**:

  ```bash
  npm run dev:api
  ```
  - Infrastructure Health Probe: `http://localhost:5080/health`
  - Versioned v1 Health Endpoint: `http://localhost:5080/api/v1/health`
  - OpenAPI v1 Specification: `http://localhost:5080/openapi/v1.json`

- **Web Companion (`http://localhost:5173`)**:

  ```bash
  npm run dev:web
  ```

- **Desktop App UI Shell (`http://localhost:1420`)**:
  ```bash
  npm run dev:desktop
  ```
  _(To launch the native Tauri 2 Windows shell with Rust + WebView2: `npm --workspace=@flowpilot/desktop run tauri:dev`)_

---

## Verification & Testing

Run all formatting, linting, type checking, and test suites across the monorepo:

```bash
npm run verify
```

Or run individual checks:

- `npm run format:check` — Verify Prettier and `.NET` code formatting
- `npm run lint` — Run ESLint across all TypeScript/React workspaces
- `npm run typecheck` — Run `tsc --noEmit` across all workspaces
- `npm run test` — Run Vitest suites (`packages/contracts`, `apps/web`, `apps/desktop`)
- `npm run test:api` — Run xUnit integration tests for `services/api`

---

## Documentation

- [AGENTS.md](./AGENTS.md) — Architecture charter, commands, conventions, testing, and security rules
- [docs/architecture.md](./docs/architecture.md) — System architecture, data boundaries (SQLite vs. PostgreSQL), and contract versioning
- [docs/local-development.md](./docs/local-development.md) — Detailed local development workflow and Docker Compose guide
- [docs/windows-prerequisites.md](./docs/windows-prerequisites.md) — Windows desktop development prerequisites (Rust, MSVC, WebView2, Node.js, .NET SDK)
- [docs/local-speech-models.md](./docs/local-speech-models.md) — Local `whisper.cpp` GGML model licensing, storage requirements, resource usage, and offline setup
- [docs/windows-manual-testing.md](./docs/windows-manual-testing.md) — Repeatable manual test checklist for Windows recording, local/cloud transcription, clipboard, and local history

# FlowPilot

**FlowPilot** is a personal AI dictation product featuring a native Windows desktop application (Tauri 2 + React + TypeScript + local SQLite) and a web companion application (React + TypeScript), backed by an ASP.NET Core Web API (.NET 10 LTS + PostgreSQL) and explicit OpenAPI contracts.

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

Each application can be started independently:

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
- [docs/windows-manual-testing.md](./docs/windows-manual-testing.md) — Repeatable manual test checklist for Windows recording, transcription, clipboard, and local history

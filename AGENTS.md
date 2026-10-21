# AGENTS.md — FlowPilot Architecture & Engineering Charter

This document defines the architectural boundaries, commands, coding standards, testing expectations, and security rules for human developers and AI coding agents working in the **FlowPilot** monorepo.

---

## 1. System Architecture & Monorepo Layout

FlowPilot is a personal AI dictation product consisting of a Windows desktop application, a web companion application, and a shared backend API.

```text
Flow Pilot/
├── apps/
│   ├── desktop/          # Tauri 2 (Rust) + React 19 + TypeScript Windows desktop app
│   └── web/              # React 19 + TypeScript + Vite web companion app
├── services/
│   └── api/              # ASP.NET Core Web API (.NET 10.0 LTS)
│       ├── src/FlowPilot.Api/
│       └── tests/FlowPilot.Api.Tests/
├── packages/
│   └── contracts/        # Versioned OpenAPI specifications & shared TypeScript contracts
├── docs/                 # Architecture, local development, and Windows prerequisite guides
└── scripts/              # Cross-platform environment diagnostics and verification runners
```

### Data Persistence Boundaries

1. **Desktop-Local Storage (SQLite)**:
   - Managed inside `apps/desktop/src-tauri` using `rusqlite` (bundled SQLite).
   - Stores offline dictation sessions, local audio processing metadata, user shortcut preferences, and pending sync queues.
   - Enables the desktop application to operate offline-first without requiring constant connectivity to the cloud API.
2. **Shared Cloud Storage (PostgreSQL)**:
   - Managed exclusively by `services/api` (`FlowPilot.Api`) via Entity Framework Core / `Npgsql`.
   - Stores shared account profiles, cross-device dictionary/vocabulary sync, usage telemetry metadata, and billing/subscription state.
   - Desktop and Web clients **never** connect directly to PostgreSQL; all shared operations go through versioned HTTP endpoints defined in `packages/contracts`.
3. **API Contracts (OpenAPI 3.1)**:
   - Stored under `packages/contracts/openapi/v1/openapi.yaml` and exposed at runtime by `FlowPilot.Api` (`/openapi/v1.json`).
   - All breaking API changes require introducing a new version namespace (e.g., `v2`) rather than mutating existing published contracts incompatibly.

---

## 2. Canonical Commands

Every workspace is independently buildable and testable, and can also be orchestrated from the repository root.

### Root Workspace Commands

| Task                                          | Command                                                |
| :-------------------------------------------- | :----------------------------------------------------- |
| Check local prerequisites                     | `npm run check:env`                                    |
| Install JS/TS dependencies                    | `npm install`                                          |
| Build all JS/TS packages & apps               | `npm run build`                                        |
| Build .NET API solution                       | `npm run build:api` (or `dotnet build FlowPilot.slnx`) |
| Run ESLint across monorepo                    | `npm run lint`                                         |
| Run TypeScript type checking                  | `npm run typecheck`                                    |
| Check formatting (Prettier + `dotnet format`) | `npm run format:check`                                 |
| Auto-format codebase                          | `npm run format`                                       |
| Run JS/TS unit tests (Vitest)                 | `npm run test`                                         |
| Run .NET integration/unit tests (xUnit)       | `npm run test:api` (or `dotnet test FlowPilot.slnx`)   |
| Run full verification suite                   | `npm run verify`                                       |

### Per-Application Independent Commands

- **Contracts (`packages/contracts`)**:
  - `npm --workspace=@flowpilot/contracts run build`
  - `npm --workspace=@flowpilot/contracts run typecheck`
  - `npm --workspace=@flowpilot/contracts run test`
- **Web Companion (`apps/web`)**:
  - `npm --workspace=@flowpilot/web run dev` (starts on `http://localhost:5173`)
  - `npm --workspace=@flowpilot/web run build`
  - `npm --workspace=@flowpilot/web run test`
- **Desktop App (`apps/desktop`)**:
  - `npm --workspace=@flowpilot/desktop run dev` (starts Vite UI shell on `http://localhost:1420`)
  - `npm --workspace=@flowpilot/desktop run tauri:dev` (launches Tauri 2 native desktop window; requires Rust & Windows SDK)
  - `npm --workspace=@flowpilot/desktop run build` (builds frontend bundle)
  - `npm --workspace=@flowpilot/desktop run tauri:build` (builds Windows installer/executable)
  - `npm --workspace=@flowpilot/desktop run test`
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` (runs Rust unit tests when Rust toolchain is installed)
- **Backend API (`services/api`)**:
  - `dotnet run --project services/api/src/FlowPilot.Api/FlowPilot.Api.csproj` (starts on `http://localhost:5080`)
  - `dotnet build services/api/src/FlowPilot.Api/FlowPilot.Api.csproj`
  - `dotnet test services/api/tests/FlowPilot.Api.Tests/FlowPilot.Api.Tests.csproj`

---

## 3. Code Conventions

### TypeScript & React (`apps/desktop`, `apps/web`, `packages/contracts`)

- **Strict TypeScript**: All projects extend `tsconfig.base.json` with `strict: true`, `noUnusedLocals: true`, and `noImplicitOverride: true`. Avoid `any`.
- **Type Imports**: Enforce `import type { ... }` for type-only imports (`@typescript-eslint/consistent-type-imports`).
- **Contract-First Consumption**: Import API response/request types from `@flowpilot/contracts` rather than duplicating DTO shapes in `apps/web` or `apps/desktop`.
- **Desktop Resilience**: Desktop frontend components must gracefully handle running inside either the Tauri WebView2 runtime or a standard browser/Vitest environment.

### C# / ASP.NET Core (`services/api`)

- **Target Framework**: `.NET 10.0 LTS` (`net10.0`) with `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>`.
- **API Versioning**: Prefix versioned routes under `/api/v1/...` while maintaining `/health` for infrastructure probes.
- **DTO Immutability**: Prefer `sealed record` types with `System.Text.Json` camelCase serialization matching `packages/contracts`.

### Rust / Tauri 2 (`apps/desktop/src-tauri`)

- **Edition**: Rust 2021 (`1.85+`).
- **Error Handling**: Use structured `Result<T, E>` types (`thiserror` / serializable command errors) instead of `.unwrap()` in Tauri command handlers.
- **Principle of Least Privilege**: Configure Tauri v2 capabilities explicitly in `apps/desktop/src-tauri/capabilities/default.json`.

---

## 4. Testing Expectations

1. **Self-Contained Tests**: All unit and integration tests (`npm run test` and `dotnet test`) **must** pass without requiring production credentials, external cloud APIs, or a live PostgreSQL instance.
2. **Contract Alignment**: Any update to `/health` or `/api/v1/*` endpoints in `FlowPilot.Api` must be accompanied by corresponding updates in `packages/contracts/openapi/v1/openapi.yaml`, `@flowpilot/contracts` TypeScript types, and `FlowPilot.Api.Tests`.
3. **Pre-Commit Verification**: Always run `npm run verify` (or `npm run lint`, `npm run typecheck`, `npm run test`, and `dotnet test`) before completing a task.

---

## 5. Security & Privacy Rules (Mandatory)

1. **No Secrets in Git**: Never commit `.env` files, API keys, JWT signing keys, database passwords, or certificates. Only `.env.example` with safe, non-sensitive local placeholders may be committed.
2. **No Speech Models in Git**: Never commit downloaded speech recognition or LLM weights (`*.bin`, `*.gguf`, `*.onnx`, `*.pt`, `*.safetensors`). Models must be downloaded at runtime into ignored user application data directories.
3. **No User Audio or Transcripts in Git**: Never commit user audio recordings (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`, `*.webm`) or personal dictation transcripts. Test fixtures must use synthetic metadata only.
4. **No Local Database Files in Git**: Never commit SQLite databases (`*.db`, `*.sqlite`, `*.sqlite3`) or WAL/SHM files.

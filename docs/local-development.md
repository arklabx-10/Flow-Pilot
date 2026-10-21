# Local Development Guide

This guide covers setting up, running, and testing the FlowPilot monorepo on a local development machine.

---

## 1. Environment Setup

### 1.1 Verify Tooling

Run the prerequisite check script from the repository root:

```bash
node scripts/check-env.mjs
```

### 1.2 Environment Variables (`.env`)

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

All default values in `.env.example` are safe local placeholders configured for:

- API Server: `http://localhost:5080`
- Web Companion: `http://localhost:5173`
- Desktop UI Dev Server: `http://localhost:1420`
- PostgreSQL (Docker Compose): `localhost:5432` (`flowpilot_dev`)

> [!IMPORTANT]
> Never commit `.env` or real credentials to Git. `.gitignore` blocks `.env` and `.env.*` automatically.

---

## 2. Installing Dependencies & Building Contracts

Install workspace dependencies from the repository root and build `@flowpilot/contracts`:

```bash
npm install
npm --workspace=@flowpilot/contracts run build
```

---

## 3. Running PostgreSQL via Docker Compose

To start a local PostgreSQL 17 instance for shared account data:

```bash
docker compose up -d
```

To check database container health:

```bash
docker compose ps
```

To stop and remove the container (preserving data in the `flowpilot_postgres_data` volume):

```bash
docker compose down
```

> [!NOTE]
> In Phase 1, `FlowPilot.Api` health checks (`/health` and `/api/v1/health`) and all integration tests run without requiring the PostgreSQL container to be active.

---

## 4. Running Each Application

### 4.1 ASP.NET Core Web API (`services/api`)

```bash
npm run dev:api
# Or directly via .NET CLI:
dotnet run --project services/api/src/FlowPilot.Api/FlowPilot.Api.csproj
```

Verify the health endpoints once running:

- `curl http://localhost:5080/health`
- `curl http://localhost:5080/api/v1/health`
- `curl http://localhost:5080/openapi/v1.json`

### 4.2 Web Companion (`apps/web`)

```bash
npm run dev:web
```

Open `http://localhost:5173` in your browser. If `FlowPilot.Api` is running on port `5080`, the Web Companion will automatically display `Healthy` connection status.

### 4.3 Windows Desktop App (`apps/desktop`)

To develop the React + TypeScript desktop UI shell in a browser with fast HMR:

```bash
npm run dev:desktop
```

Open `http://localhost:1420`.

To launch the full native Windows Tauri 2 application (requires Rust + Windows C++ Build Tools + WebView2):

```bash
npm --workspace=@flowpilot/desktop run tauri:dev
```

---

## 5. Formatting, Linting, Type Checking, and Testing

Run the complete verification suite before opening a pull request:

```bash
npm run verify
```

Individual commands:

- **Format code**: `npm run format`
- **Check formatting**: `npm run format:check`
- **Lint TypeScript/React**: `npm run lint`
- **Typecheck workspaces**: `npm run typecheck`
- **Run Vitest unit tests**: `npm run test`
- **Run .NET API integration tests**: `npm run test:api`

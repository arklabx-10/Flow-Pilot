# Windows Desktop Development Prerequisites

Developing and building the native FlowPilot Windows desktop application (`apps/desktop`) and backend services requires the following supported toolchains on Windows 10 (version 1809+) or Windows 11.

---

## 1. Supported Toolchain Matrix

| Requirement                     | Supported Version                               | Purpose                                                            |
| :------------------------------ | :---------------------------------------------- | :----------------------------------------------------------------- |
| **Node.js**                     | `22.x LTS` or `24.x LTS` (with `npm >= 10`)     | Frontend builds, OpenAPI contracts, workspace scripts              |
| **.NET SDK**                    | `10.0 LTS` (`10.0.100+`)                        | Building and testing `services/api` (`FlowPilot.Api`)              |
| **Rust (`rustup`)**             | `1.85+` stable (`x86_64-pc-windows-msvc`)       | Compiling Tauri 2 core (`apps/desktop/src-tauri`) & `rusqlite`     |
| **Microsoft Visual C++ (MSVC)** | Visual Studio 2022 Build Tools                  | Native C/C++ linker required by Rust on Windows and bundled SQLite |
| **Windows SDK**                 | Windows 10/11 SDK (`10.0.19041.0+`)             | Native Windows headers & libraries for Tauri / WebView2            |
| **Microsoft Edge WebView2**     | Evergreen Runtime (pre-installed on Windows 11) | Rendering engine for Tauri 2 windows                               |
| **Docker Desktop**              | Latest stable (WSL 2 backend recommended)       | Running local PostgreSQL 17 via `docker-compose.yml`               |

---

## 2. Step-by-Step Windows Installation

### 2.1 Microsoft Visual Studio C++ Build Tools

Tauri 2 and `rusqlite` (bundled SQLite) require the MSVC linker and Windows SDK:

1. Download **Visual Studio 2022 Build Tools** from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or install via `winget`:
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```
2. In the Visual Studio Installer, select the **"Desktop development with C++"** workload and ensure these components are checked:
   - MSVC v143 - VS 2022 C++ x64/x86 build tools
   - Windows 10 SDK or Windows 11 SDK

### 2.2 Rust Toolchain (`rustup`)

Install Rust using `rustup` targeting the MSVC ABI:

```powershell
winget install Rustlang.Rustup
```

After installation, open a new terminal and verify:

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustc --version
cargo --version
```

### 2.3 Node.js LTS

Install Node.js LTS (`22.x` or `24.x`):

```powershell
winget install OpenJS.NodeJS.LTS
node --version
npm --version
```

### 2.4 .NET 10.0 LTS SDK

Install the .NET 10 LTS SDK:

```powershell
winget install Microsoft.DotNet.SDK.10
dotnet --list-sdks
```

### 2.5 Microsoft Edge WebView2 Runtime

Windows 11 includes the Evergreen WebView2 Runtime by default. On Windows 10 machines where it is not present, install it via:

```powershell
winget install Microsoft.EdgeWebView2Runtime
```

### 2.6 Docker Desktop (Optional for Local PostgreSQL)

```powershell
winget install Docker.DockerDesktop
```

---

## 3. Verifying Your Windows Setup

Run the included diagnostic script from the repository root:

```powershell
node scripts/check-env.mjs
```

Once Rust and the MSVC Build Tools are installed, verify the Tauri 2 Rust crate and bundled SQLite tests directly:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

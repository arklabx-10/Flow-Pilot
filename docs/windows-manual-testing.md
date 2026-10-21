# Repeatable Manual Test Plan — Windows Desktop Recording & Transcription

This document provides a repeatable, step-by-step manual verification checklist for testing the FlowPilot desktop workflow on Windows 10/11, including **optional manual tests for real local `whisper.cpp` inference and real cloud inference**.

---

## Core UI & Privacy Workflow Checks (No Paid Credentials Required)

### Test Case 1: Local vs. Cloud Privacy Notice & Independent Settings

1. Start the desktop shell (`npm run dev:desktop` $\rightarrow$ `http://localhost:1420`).
2. Verify **Speech Provider** defaults to **Local (whisper.cpp Offline)** and no outbound audio warning banner is shown.
3. Switch **Speech Provider** to **Cloud (FlowPilot Backend Proxy)**.
4. **Expected Result**:
   - The blue **Outbound Audio Notice (Cloud Speech Mode Active)** banner appears immediately, explicitly informing the user that captured microphone audio will be transmitted over HTTPS.
5. Verify that **Text-Refinement Provider** (`Local` vs. `Cloud`), **Transcription Language**, **Sync saved transcripts to cloud**, and **Retain audio recording in session** can each be toggled independently.

### Test Case 2: Microphone Permission Denied State

1. Block microphone access for `http://localhost:1420` (or disable microphone access in **Windows Settings > Privacy & security > Microphone**).
2. Click **Start Recording**.
3. **Expected Result**:
   - The state badge transitions to `permission-denied`.
   - The amber **Microphone Access Denied** alert banner is displayed with instructions to re-enable microphone access.

### Test Case 3: Recording Cancellation (`Cancel` Button & `Escape` Key)

1. Re-enable microphone access and click **Start Recording**.
2. While `State: recording` is active, press the `Escape` key (or click **Cancel (Esc)**).
3. **Expected Result**:
   - The microphone hardware indicator in the Windows taskbar turns off immediately.
   - The state badge transitions to `cancelled`.

---

## [OPTIONAL MANUAL TEST] Real Local `whisper.cpp` Offline Inference

> [!NOTE]
> This optional test requires the native Tauri 2 Windows runtime (`rustc`/`cargo` + MSVC Build Tools), the `whisper-cli.exe` binary, and a downloaded GGML model file (`ggml-tiny.en.bin`). See [docs/local-speech-models.md](./local-speech-models.md) for setup details.

1. Ensure `whisper-cli.exe` is on `PATH` (or in `%LOCALAPPDATA%\com.flowpilot.desktop\bin\whisper-cli.exe`) and `ggml-tiny.en.bin` is downloaded in `%LOCALAPPDATA%\com.flowpilot.desktop\models\`.
2. Launch the native desktop app:
   ```powershell
   npm --workspace=@flowpilot/desktop run tauri:dev
   ```
3. Select **Speech Provider: Local (whisper.cpp Offline)** and **Local Whisper Model: Whisper Tiny (English-only, Fast)**.
4. **Disconnect your Windows machine from Wi-Fi / Ethernet** (Airplane mode) to verify true offline capability.
5. Click **Start Recording**, speak a sentence clearly, and click **Stop & Transcribe**.
6. **Expected Result**:
   - The UI remains responsive (non-blocking) while `whisper-cli` runs on a background thread.
   - The verbatim transcript appears in **Original Verbatim Transcript (Preserved)** and the formatted output appears in **Editable Output Text** with zero network connectivity.

---

## [OPTIONAL MANUAL TEST] Real Cloud Speech Proxy Inference

> [!NOTE]
> This optional test requires a valid OpenAI API key configured on the **backend server only** (`FlowPilot.Api`). No API keys are ever entered into or shipped with the desktop client bundle.

1. Start `FlowPilot.Api` with your OpenAI API key set in the server environment:
   ```powershell
   $env:SpeechProvider__OpenAi__ApiKey = "sk-your-server-key"
   dotnet run --project services/api/src/FlowPilot.Api/FlowPilot.Api.csproj
   ```
2. Start the desktop shell (`npm run dev:desktop` $\rightarrow$ `http://localhost:1420`).
3. Select **Speech Provider: Cloud (FlowPilot Backend Proxy)** and confirm the **Outbound Audio Notice** is displayed.
4. Click **Start Recording**, speak:
   > _"Um we need to finalize the Windows dictation release notes and send them to the engineering team"_
5. Click **Stop & Transcribe**.
6. **Expected Result**:
   - `FlowPilot.Api` forwards the audio to OpenAI Whisper using its server-side key and returns the `v1` contract response.
   - **Original Verbatim Transcript** and **Editable Output Text** populate accurately.
   - Switching across **Raw Transcription**, **Clean Text**, **Professional Message**, **Coding Prompt**, and **Quick Note** updates the refined output while preserving the original transcript untouched.
   - Clicking **Copy to Clipboard** copies the edited text to the Windows clipboard (`Ctrl+V` in `notepad.exe`), and **Save to History** stores the transcript in searchable local history.

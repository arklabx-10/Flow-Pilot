# Repeatable Manual Test Plan — Windows Desktop Recording & Transcription

This document provides a repeatable, step-by-step manual verification checklist for testing the **Phase 2 Dictation Vertical Slice** on Windows 10/11.

---

## Prerequisites

1. A working microphone connected and enabled in **Windows Settings > Privacy & security > Microphone**.
2. A valid **OpenAI API key** with access to the `whisper-1` audio transcriptions endpoint (`https://api.openai.com/v1/audio/transcriptions`).
3. Start the desktop shell via either:
   - **Browser / WebView Shell**: `npm run dev:desktop` (opens `http://localhost:1420`)
   - **Native Tauri 2 Windows App** (when Rust & MSVC Build Tools are installed): `npm --workspace=@flowpilot/desktop run tauri:dev`

---

## Test Case 1: Unconfigured Provider Error State (No Fake Success)

1. Leave the **OpenAI API Key** field empty.
2. Click **Start Recording** and grant microphone permission when prompted.
3. Speak for 2–3 seconds, then click **Stop & Transcribe**.
4. **Expected Result**:
   - The state badge transitions `recording` $\rightarrow$ `stopping` $\rightarrow$ `processing` $\rightarrow$ `error`.
   - An alert banner (`PROVIDER_UNCONFIGURED`) is displayed explaining that an OpenAI API key is required.
   - No fake or simulated transcript is generated.

---

## Test Case 2: Microphone Permission Denied State

1. Block microphone access for `http://localhost:1420` (or disable microphone access in **Windows Settings > Privacy & security > Microphone**).
2. Click **Start Recording**.
3. **Expected Result**:
   - The state badge transitions to `permission-denied`.
   - The amber **Microphone Access Denied** alert banner is displayed with instructions to re-enable microphone access.

---

## Test Case 3: Recording Cancellation (`Cancel` Button & `Escape` Key)

1. Re-enable microphone access and click **Start Recording**.
2. While `State: recording` is active, press the `Escape` key (or click **Cancel (Esc)**).
3. **Expected Result**:
   - The microphone hardware indicator in the Windows taskbar turns off immediately.
   - The state badge transitions to `cancelled`.
   - No network request is sent to the transcription provider.

---

## Test Case 4: Real Audio Capture, Output Modes, Editing, Clipboard & History

1. Enter a valid OpenAI API key (`sk-...`) in the **OpenAI API Key** input (or set `VITE_OPENAI_API_KEY` in your local `.env`).
2. Select **Clean Text** in the **Output Mode** dropdown.
3. Click **Start Recording** and speak clearly:
   > _"Um we need to finalize the Windows dictation release notes and send them to the engineering team"_
4. Click **Stop & Transcribe**.
5. **Expected Result**:
   - State transitions to `processing` and then `success`.
   - **Original Verbatim Transcript (Preserved)** displays the raw Whisper transcript.
   - **Editable Output Text (Clean Text)** displays the cleaned sentence with filler words removed and punctuation normalized.
6. Switch **Output Mode** across all 5 modes:
   - **Raw Transcription**
   - **Clean Text**
   - **Professional Message**
   - **Coding Prompt**
   - **Quick Note**
   - Verify that **Original Verbatim Transcript** remains unchanged across every mode switch.
7. Edit the text in the **Editable Output Text** textarea and click **Reset Editor to Original** to verify you can restore the original transcript, then re-select **Clean Text** and make a custom edit.
8. Click **Copy to Clipboard**, open Windows Notepad (`notepad.exe`), and press `Ctrl+V`.
   - **Expected Result**: The exact edited text is pasted into Notepad.
9. Click **Save to History**.
   - **Expected Result**: The entry appears immediately in **Local Transcript History** with both the edited text and the preserved original transcript preview.
10. Type a keyword into **Search History** (both matching and non-matching terms).
    - **Expected Result**: Matching entries remain visible; non-matching queries display the empty search state (`No transcripts match "..."`).

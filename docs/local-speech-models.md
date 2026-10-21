# Local Speech Models Guide (`whisper.cpp` GGML)

FlowPilot supports **100% offline on-device speech recognition** via `whisper.cpp` behind the `ISpeechRecognitionProvider` interface (`LocalWhisperSpeechProvider`).

---

## 1. Supported Models, Licensing, Storage & Resource Usage

All supported GGML model weights are derived from OpenAI Whisper and distributed under the **MIT License** (`ggerganov/whisper.cpp`).

| Model ID   | Filename            | Languages               | Disk Size | Peak RAM Usage | CPU Profile                         | License |
| :--------- | :------------------ | :---------------------- | :-------- | :------------- | :---------------------------------- | :------ |
| `tiny.en`  | `ggml-tiny.en.bin`  | English-only            | `75 MB`   | `~270 MB`      | Ultra-fast on modern 4+ core CPUs   | MIT     |
| `tiny`     | `ggml-tiny.bin`     | Multilingual (99 langs) | `75 MB`   | `~270 MB`      | Fast on modern 4+ core CPUs         | MIT     |
| `base.en`  | `ggml-base.en.bin`  | English-only            | `142 MB`  | `~390 MB`      | Balanced speed & accuracy           | MIT     |
| `base`     | `ggml-base.bin`     | Multilingual (99 langs) | `142 MB`  | `~390 MB`      | Balanced multilingual accuracy      | MIT     |
| `small.en` | `ggml-small.en.bin` | English-only            | `466 MB`  | `~850 MB`      | High accuracy; AVX2 CPU recommended | MIT     |

---

## 2. Storage Boundaries & Git Exclusion

- **Runtime Model Directory**:
  - Downloaded `.bin` weights are stored in the user's application data directory (`%LOCALAPPDATA%\com.flowpilot.desktop\models\` on Windows) and never inside the repository source tree.
- **Source Control Protection**:
  - `.gitignore` explicitly blocks `*.bin`, `*.gguf`, `*.onnx`, `*.pt`, `*.safetensors`, and `models/` so speech weights can never be accidentally committed.

---

## 3. Non-Blocking Execution Architecture

- In the native Tauri 2 Windows runtime (`apps/desktop/src-tauri/src/whisper_local.rs`), `transcribe_local_whisper` executes `whisper-cli` inside `tauri::async_runtime::spawn_blocking`.
- This guarantees that model loading and CPU inference run on a background worker thread without blocking the React/WebView2 UI thread or freezing the Cancel button.
- Temporary audio files written for `whisper-cli` are deleted immediately after inference completes.

---

## 4. Installing `whisper-cli` (`whisper.cpp`) on Windows

1. Download the latest prebuilt Windows `whisper.cpp` binary release (`whisper-bin-x64.zip`) from the official [`ggerganov/whisper.cpp` Releases](https://github.com/ggerganov/whisper.cpp/releases) or build from source with CMake + MSVC.
2. Place `whisper-cli.exe` either:
   - On your system `PATH`, **or**
   - Inside `%LOCALAPPDATA%\com.flowpilot.desktop\bin\whisper-cli.exe`.
3. Download your preferred GGML model (`ggml-tiny.en.bin` or `ggml-base.en.bin`) into `%LOCALAPPDATA%\com.flowpilot.desktop\models\` (or use the **Download Model** button inside the Tauri Desktop app).
4. Disconnect from the internet and record a dictation session with **Speech Provider: Local (whisper.cpp Offline)** selected to verify zero-network offline operation.

use std::path::Path;
use std::process::Command;

/// Checks whether the `whisper-cli` (whisper.cpp) binary is available on the host PATH
/// or in the application's local bin directory.
pub fn is_whisper_cli_available(app_data_dir: &Path) -> bool {
    let local_bin = app_data_dir.join("bin").join(if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    });

    if local_bin.exists() {
        return true;
    }

    Command::new("whisper-cli")
        .arg("--help")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Runs whisper.cpp CLI inference synchronously (intended to be called inside
/// `tauri::async_runtime::spawn_blocking` so the UI thread is never blocked).
pub fn run_whisper_cli_inference(
    app_data_dir: &Path,
    model_file_name: &str,
    audio_bytes: &[u8],
    language: &str,
    translate_to_english: bool,
) -> Result<String, String> {
    let models_dir = app_data_dir.join("models");
    let model_path = models_dir.join(model_file_name);
    if !model_path.exists() {
        return Err(format!(
            "Local Whisper model file '{}' does not exist in {}",
            model_file_name,
            models_dir.display()
        ));
    }

    let temp_audio_path = std::env::temp_dir().join(format!(
        "flowpilot_capture_{}.wav",
        std::process::id()
    ));

    std::fs::write(&temp_audio_path, audio_bytes)
        .map_err(|e| format!("Failed to write temporary audio buffer: {e}"))?;

    let local_bin = app_data_dir.join("bin").join(if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    });
    let binary = if local_bin.exists() {
        local_bin.to_string_lossy().to_string()
    } else {
        "whisper-cli".to_string()
    };

    let mut cmd = Command::new(binary);
    cmd.arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&temp_audio_path)
        .arg("--no-timestamps");

    if !language.is_empty() && language != "auto" {
        cmd.arg("-l").arg(language);
    }
    if translate_to_english {
        cmd.arg("--translate");
    }

    let output_result = cmd.output();
    // Always remove temporary audio capture immediately after inference completes
    let _ = std::fs::remove_file(&temp_audio_path);

    let output = output_result.map_err(|e| format!("Failed to launch whisper-cli: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper-cli exited with error: {stderr}"));
    }

    let transcript = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(transcript)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_error_when_model_file_is_missing() {
        let temp_dir = std::env::temp_dir().join("flowpilot_whisper_test_dir");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let result = run_whisper_cli_inference(
            &temp_dir,
            "ggml-tiny.en.bin",
            &[1, 2, 3, 4],
            "en",
            false,
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Local Whisper model file 'ggml-tiny.en.bin' does not exist"));
    }
}

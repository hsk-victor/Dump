use std::fs;
use std::path::Path;

use dump_desktop::capture_native::{parse_shortcut, register_shortcut, DEFAULT_SHORTCUT};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{capture_window::Capture, tray};

const FILE: &str = "capture-shortcut.json";

#[derive(Deserialize, Serialize)]
pub struct ShortcutSettings {
    binding: String,
    error: Option<String>,
}

fn read_binding(path: &Path) -> String {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ShortcutSettings>(&bytes).ok())
        .map(|settings| settings.binding)
        .filter(|binding| parse_shortcut(binding).is_ok())
        .unwrap_or_else(|| DEFAULT_SHORTCUT.into())
}

fn persist(path: &Path, binding: &str) -> Result<(), String> {
    let bytes = serde_json::to_vec(&ShortcutSettings {
        binding: binding.into(),
        error: None,
    })
    .map_err(|_| "Couldn’t save the shortcut.")?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes)
        .and_then(|_| fs::rename(temp, path))
        .map_err(|_| "Couldn’t save the shortcut.".into())
}

pub fn load(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        app.state::<Capture>().lock().unwrap().binding = read_binding(&dir.join(FILE));
    }
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let port = window.app_handle().state::<Capture>().lock().unwrap().port;
    let url = window.url().map_err(|error| error.to_string())?;
    if window.label() != "main"
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(port)
    {
        return Err("Shortcut settings are only available in the library.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn shortcut_settings(window: WebviewWindow) -> Result<ShortcutSettings, String> {
    authorize(&window)?;
    let state = window.app_handle().state::<Capture>();
    let state = state.lock().unwrap();
    Ok(ShortcutSettings {
        binding: state.binding.clone(),
        error: state.shortcut_error.clone(),
    })
}

#[tauri::command]
pub fn set_capture_shortcut(
    window: WebviewWindow,
    binding: String,
) -> Result<ShortcutSettings, String> {
    authorize(&window)?;
    let binding = binding.trim();
    parse_shortcut(binding)?;
    let app = window.app_handle();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Couldn’t save the shortcut.")?;
    fs::create_dir_all(&dir).map_err(|_| "Couldn’t save the shortcut.")?;
    persist(&dir.join(FILE), binding)?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|_| "Couldn’t change the shortcut.")?;
    let error = register_shortcut(app, binding).err().map(str::to_owned);
    {
        let state = app.state::<Capture>();
        let mut state = state.lock().unwrap();
        state.binding = binding.into();
        state.shortcut_error = error.clone();
    }
    tray::update_binding(app, binding)?;
    Ok(ShortcutSettings {
        binding: binding.into(),
        error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_valid_configuration_and_defaults_missing_corrupt_or_invalid_files() {
        let dir = std::env::temp_dir().join(format!("dump-shortcut-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        assert_eq!(read_binding(&path), DEFAULT_SHORTCUT);
        persist(&path, "Ctrl+Alt+D").unwrap();
        assert_eq!(read_binding(&path), "Ctrl+Alt+D");
        persist(&path, "Ctrl+Shift+Space").unwrap();
        assert_eq!(read_binding(&path), DEFAULT_SHORTCUT);
        persist(&path, "A").unwrap();
        assert_eq!(read_binding(&path), DEFAULT_SHORTCUT);
        fs::write(&path, b"broken").unwrap();
        assert_eq!(read_binding(&path), DEFAULT_SHORTCUT);
        assert!(persist(&dir.join("missing").join(FILE), "Ctrl+Alt+D").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}

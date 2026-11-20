use std::path::{Path, PathBuf};

use arboard::{Clipboard, Error, ImageData};
use tauri::{plugin::TauriPlugin, AppHandle, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";
const MAX_FILE_BYTES: u64 = 15 * 1024 * 1024;

pub fn shortcut_plugin(
    on_capture: impl Fn(&AppHandle) + Send + Sync + 'static,
) -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                on_capture(app);
            }
        })
        .build()
}

pub fn register_shortcut(app: &AppHandle, binding: &str) -> Result<Shortcut, &'static str> {
    let shortcut = parse_shortcut(binding)?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|_| "Shortcut unavailable")?;
    Ok(shortcut)
}

fn parse_shortcut(binding: &str) -> Result<Shortcut, &'static str> {
    let binding = binding.trim();
    binding
        .parse::<Shortcut>()
        .ok()
        .filter(|shortcut| {
            shortcut
                .mods
                .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
        })
        .filter(|_| binding.len() <= 64)
        .ok_or("Use a shortcut like Ctrl+Shift+Space.")
}

pub enum ClipboardCapture {
    File(PathBuf),
    Image(ImageData<'static>),
    Text(String),
}

pub fn read_clipboard() -> Result<ClipboardCapture, &'static str> {
    let mut clipboard = Clipboard::new().map_err(|_| "Couldn’t open the clipboard.")?;
    match clipboard.get().file_list() {
        Ok(files) if !files.is_empty() => return select_file(files).map(ClipboardCapture::File),
        Ok(_) | Err(Error::ContentNotAvailable) => {}
        Err(_) => return Err("Couldn’t read files from the clipboard."),
    }
    match clipboard.get_image() {
        Ok(image) => return Ok(ClipboardCapture::Image(image)),
        Err(Error::ContentNotAvailable) => {}
        Err(_) => return Err("Couldn’t read the clipboard image."),
    }
    match clipboard.get_text() {
        Ok(text) if !text.trim().is_empty() => Ok(ClipboardCapture::Text(text)),
        Ok(_) | Err(Error::ContentNotAvailable) => {
            Err("The clipboard has no link, note, image or file.")
        }
        Err(_) => Err("Couldn’t read the clipboard text."),
    }
}

fn select_file(mut files: Vec<PathBuf>) -> Result<PathBuf, &'static str> {
    if files.len() != 1 {
        return Err("Dump one file at a time.");
    }
    let file = files.pop().unwrap();
    check_file(&file)?;
    Ok(file)
}

fn check_file(path: &Path) -> Result<(), &'static str> {
    let metadata = path
        .metadata()
        .map_err(|_| "Couldn’t read the clipboard file.")?;
    if !metadata.is_file() {
        return Err("Folders can’t be dumped. Choose a file instead.");
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("Choose a file up to 15 MB.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_default_and_rejects_unmodified_keys() {
        assert!(parse_shortcut(DEFAULT_SHORTCUT).is_ok());
        assert!(parse_shortcut("A").is_err());
        assert!(parse_shortcut("Shift+Space").is_err());
    }

    #[test]
    fn rejects_multiple_files_and_folders_without_silently_picking_one() {
        let folder = std::env::temp_dir();
        assert_eq!(
            select_file(vec![folder.clone(), folder.clone()]).unwrap_err(),
            "Dump one file at a time."
        );
        assert_eq!(
            select_file(vec![folder]).unwrap_err(),
            "Folders can’t be dumped. Choose a file instead."
        );
    }
}

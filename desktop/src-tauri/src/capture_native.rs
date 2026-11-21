use std::io::Read;
use std::path::{Path, PathBuf};

use arboard::{Clipboard, Error, ImageData};
use base64::{engine::general_purpose::STANDARD, Engine};
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

pub fn clipboard_payload() -> Result<serde_json::Value, &'static str> {
    payload_for_capture(read_clipboard()?)
}

fn payload_for_capture(value: ClipboardCapture) -> Result<serde_json::Value, &'static str> {
    let (name, mime, bytes) = match value {
        ClipboardCapture::Text(text) => return Ok(serde_json::json!({ "text": text })),
        ClipboardCapture::File(path) => {
            check_file(&path)?;
            let mut bytes = Vec::new();
            std::fs::File::open(&path)
                .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes))
                .map_err(|_| "Couldn’t read the clipboard file.")?;
            let name = path
                .file_name()
                .ok_or("Couldn’t read the clipboard filename.")?
                .to_string_lossy()
                .into_owned();
            let mime = match path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "avif" => "image/avif",
                "pdf" => "application/pdf",
                _ => "application/octet-stream",
            };
            (name, mime, bytes)
        }
        ClipboardCapture::Image(image) => {
            if image.width == 0
                || image.height == 0
                || image
                    .width
                    .checked_mul(image.height)
                    .and_then(|pixels| pixels.checked_mul(4))
                    != Some(image.bytes.len())
            {
                return Err("Couldn’t read the clipboard image.");
            }
            let width = u32::try_from(image.width).map_err(|_| "Clipboard image is too large.")?;
            let height =
                u32::try_from(image.height).map_err(|_| "Clipboard image is too large.")?;
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, width, height);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder
                    .write_header()
                    .map_err(|_| "Couldn’t encode the clipboard image.")?;
                writer
                    .write_image_data(&image.bytes)
                    .map_err(|_| "Couldn’t encode the clipboard image.")?;
            }
            ("image.png".into(), "image/png", bytes)
        }
    };
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Choose a file up to 15 MB.");
    }
    Ok(
        serde_json::json!({ "file": { "name": name, "type": mime, "base64": STANDARD.encode(bytes) } }),
    )
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

    #[test]
    fn encodes_clipboard_rgba_as_a_real_png_and_rejects_invalid_images() {
        let image = ImageData {
            width: 1,
            height: 1,
            bytes: std::borrow::Cow::Owned(vec![255, 0, 0, 255]),
        };
        let payload = payload_for_capture(ClipboardCapture::Image(image)).unwrap();
        assert_eq!(payload["file"]["type"], "image/png");
        let bytes = STANDARD
            .decode(payload["file"]["base64"].as_str().unwrap())
            .unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut decoded).unwrap();
        assert_eq!(decoded, vec![255, 0, 0, 255]);
        let image = ImageData {
            width: 1,
            height: 1,
            bytes: std::borrow::Cow::Owned(Vec::new()),
        };
        assert_eq!(
            payload_for_capture(ClipboardCapture::Image(image)).unwrap_err(),
            "Couldn’t read the clipboard image."
        );
    }

    #[test]
    fn transports_text_and_file_bytes_without_exposing_paths() {
        let text = "a note\nhttps://example.com";
        assert_eq!(
            payload_for_capture(ClipboardCapture::Text(text.into())).unwrap()["text"],
            text
        );
        let path = std::env::temp_dir().join(format!("dump-clipboard-{}.pdf", std::process::id()));
        std::fs::write(&path, b"file bytes").unwrap();
        let payload = payload_for_capture(ClipboardCapture::File(path.clone())).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            payload["file"]["name"],
            path.file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(payload["file"]["type"], "application/pdf");
        assert_eq!(
            STANDARD
                .decode(payload["file"]["base64"].as_str().unwrap())
                .unwrap(),
            b"file bytes"
        );
        assert!(payload_for_capture(ClipboardCapture::File(path)).is_err());
    }
}

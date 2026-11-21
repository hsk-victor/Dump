use std::collections::HashSet;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::capture_window::{self, Capture};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Recent {
    id: String,
    label: String,
}

struct TrayState {
    capture: MenuItem<tauri::Wry>,
    submenu: Submenu<tauri::Wry>,
    clipboard: MenuItem<tauri::Wry>,
    recents: Vec<Recent>,
}

#[derive(Default)]
pub struct Tray(Mutex<Option<TrayState>>);

pub fn poll_recents(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let Some(window) = app.get_webview_window("capture") else {
            break;
        };
        let _ = window.eval("window.dispatchEvent(new Event('dump:recents-refresh'))");
    });
}

pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Open Dump", true, None::<&str>)?;
    let binding = app.state::<Capture>().lock().unwrap().binding.clone();
    let capture = MenuItem::with_id(
        app,
        "capture",
        format!("Quick capture…\t{binding}"),
        true,
        None::<&str>,
    )?;
    let clipboard = MenuItem::with_id(app, "clipboard", "Dump clipboard", false, None::<&str>)?;
    let submenu = Submenu::new(app, "Recent saves", false)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Dump", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &capture, &clipboard, &submenu, &separator, &quit],
    )?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Packaged tray icon is missing")?;
    TrayIconBuilder::with_id("dump")
        .icon(icon)
        .tooltip("Dump")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                crate::open_library(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::open_library(app),
            "capture" => capture_window::open(app),
            "clipboard" => {
                let Some(window) = app.get_webview_window("capture") else { return };
                let (action, hidden) = capture_window::begin_clipboard(&window);
                let app = app.clone();
                std::thread::spawn(move || {
                    let mut payload = dump_desktop::capture_native::clipboard_payload()
                        .unwrap_or_else(|message| serde_json::json!({ "message": message }));
                    payload["action"] = serde_json::json!(action);
                    payload["startedHidden"] = serde_json::json!(hidden);
                    if let Some(window) = app.get_webview_window("capture") {
                        let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('dump:clipboard-payload',{{detail:{payload}}}))"));
                    }
                });
            }
            "quit" => crate::lifecycle::quit(app),
            id => {
                let Some(id) = id.strip_prefix("recent:") else { return };
                let exists = app.state::<Tray>().0.lock().unwrap().as_ref()
                    .is_some_and(|state| state.recents.iter().any(|recent| recent.id == id));
                if !exists { return; }
                crate::open_library(app);
                if let Some(window) = app.get_webview_window("main") {
                    let detail = serde_json::json!({ "id": id });
                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('dump:reveal',{{detail:{detail}}}))"));
                }
            }
        })
        .build(app)?;
    *app.state::<Tray>().0.lock().unwrap() = Some(TrayState {
        capture,
        submenu,
        clipboard,
        recents: Vec::new(),
    });
    Ok(())
}

pub fn initialized(app: &AppHandle) -> bool {
    app.state::<Tray>().0.lock().unwrap().is_some()
}

pub fn update_binding(app: &AppHandle, binding: &str) -> Result<(), String> {
    if let Some(state) = app.state::<Tray>().0.lock().unwrap().as_ref() {
        state.capture.set_text(format!("Quick capture…\t{binding}"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalize(items: Vec<Recent>) -> Vec<Recent> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| !item.id.is_empty() && item.id.len() <= 128 && seen.insert(item.id.clone()))
        .take(3)
        .map(|mut item| {
            item.label = item
                .label
                .chars()
                .filter(|c| !c.is_control() && *c != '&')
                .take(48)
                .collect::<String>()
                .trim()
                .to_owned();
            if item.label.is_empty() {
                item.label = "File".into();
            }
            item
        })
        .collect()
}

#[tauri::command]
pub fn capture_recents(window: WebviewWindow, items: Vec<Recent>) -> Result<(), String> {
    capture_window::authorize(&window)?;
    let app = window.app_handle().clone();
    window
        .app_handle()
        .run_on_main_thread(move || {
            if let Err(error) = update_recents(&app, normalize(items)) {
                eprintln!("Couldn't refresh recent saves: {error}");
            }
        })
        .map_err(|error| error.to_string())
}

fn update_recents(app: &AppHandle, items: Vec<Recent>) -> Result<(), String> {
    let state = app.state::<Tray>();
    let mut guard = state.0.lock().unwrap();
    let Some(state) = guard.as_mut() else {
        return Ok(());
    };
    state
        .clipboard
        .set_enabled(true)
        .map_err(|error| error.to_string())?;
    if items == state.recents {
        return Ok(());
    }
    for item in state.submenu.items().map_err(|error| error.to_string())? {
        state
            .submenu
            .remove(&item)
            .map_err(|error| error.to_string())?;
    }
    for item in &items {
        let entry = MenuItem::with_id(
            app,
            format!("recent:{}", item.id),
            &item.label,
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        state
            .submenu
            .append(&entry)
            .map_err(|error| error.to_string())?;
    }
    state
        .submenu
        .set_enabled(!items.is_empty())
        .map_err(|error| error.to_string())?;
    state.recents = items;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_and_sanitizes_untrusted_recent_labels() {
        let entry = |id: &str, label: &str| Recent {
            id: id.into(),
            label: label.into(),
        };
        let items = normalize(vec![
            entry("a", "A&B\t\n"),
            entry("a", "duplicate"),
            entry("b", "&\n"),
            entry("c", &"🎉".repeat(60)),
            entry("d", "fourth"),
        ]);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].label, "AB");
        assert_eq!(items[1].label, "File");
        assert_eq!(items[2].label.chars().count(), 48);
        assert!(normalize(vec![entry("", "bad"), entry(&"a".repeat(129), "bad")]).is_empty());
        assert!(normalize(Vec::new()).is_empty());
    }
}

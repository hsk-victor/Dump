use std::sync::Mutex;

use dump_desktop::capture_native::{register_shortcut, DEFAULT_SHORTCUT};
use dump_desktop::desktop_windows::{ForegroundWindow, WorkArea};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, IsWindowVisible, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut std::ffi::c_void,
        attribute: u32,
        value: *const std::ffi::c_void,
        size: u32,
    ) -> i32;
}

#[derive(Clone, Copy)]
enum ReturnTarget {
    Library,
    External(ForegroundWindow),
}

pub struct CaptureState {
    target: Option<ReturnTarget>,
    height: f64,
    pub writing: bool,
    pub shortcut_error: Option<String>,
    pub binding: String,
    port: u16,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            target: None,
            height: 164.0,
            writing: false,
            shortcut_error: None,
            binding: DEFAULT_SHORTCUT.into(),
            port: 0,
        }
    }
}

pub type Capture = Mutex<CaptureState>;

pub fn create(app: &AppHandle, port: u16, token: &str) -> tauri::Result<()> {
    app.state::<Capture>().lock().unwrap().port = port;
    let url = tauri::Url::parse(&format!(
        "http://127.0.0.1:{port}/capture?dump_token={token}"
    ))
    .unwrap();
    let nav_app = app.clone();
    let window = WebviewWindowBuilder::new(app, "capture", WebviewUrl::External(url))
        .title("Quick capture")
        .inner_size(480.0, 164.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(port)
                && url.path() == "/capture"
            {
                true
            } else {
                crate::open_external(&nav_app, url);
                false
            }
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let raw = hwnd.0.cast();
            let style = GetWindowLongPtrW(raw, GWL_EXSTYLE);
            SetWindowLongPtrW(
                raw,
                GWL_EXSTYLE,
                (style & !(WS_EX_APPWINDOW as isize)) | WS_EX_TOOLWINDOW as isize,
            );
            let disabled = 1u32;
            let rounded = 2u32;
            DwmSetWindowAttribute(raw, 3, (&disabled as *const u32).cast(), 4);
            DwmSetWindowAttribute(raw, 33, (&rounded as *const u32).cast(), 4);
        }
    }
    let binding = app.state::<Capture>().lock().unwrap().binding.clone();
    let error = register_shortcut(app, &binding).err().map(str::to_owned);
    app.state::<Capture>().lock().unwrap().shortcut_error = error;
    crate::tray::poll_recents(app);
    Ok(())
}

fn raw_window(window: &WebviewWindow) -> Option<ForegroundWindow> {
    window
        .hwnd()
        .ok()
        .map(|hwnd| ForegroundWindow::from_raw(hwnd.0 as isize))
}

fn geometry(area: &WorkArea, height: f64) -> (PhysicalSize<u32>, PhysicalPosition<i32>) {
    let gutter = (16.0 * area.scale).round() as i32;
    let width = (480.0 * area.scale)
        .round()
        .min(f64::from((area.width - 2 * gutter).max(1))) as u32;
    let height = (height * area.scale)
        .round()
        .clamp(1.0, f64::from((area.height - 2 * gutter).max(1))) as u32;
    let x = area.x + (area.width - width as i32) / 2;
    let y = area.y
        + (area.height / 3 - height as i32 / 2).clamp(
            gutter.min(area.height - height as i32),
            (area.height - height as i32 - gutter).max(0),
        );
    (
        PhysicalSize::new(width, height),
        PhysicalPosition::new(x, y),
    )
}

pub fn open(app: &AppHandle) {
    let Some(window) = app.get_webview_window("capture") else {
        return;
    };
    let foreground = ForegroundWindow::current();
    let already_foreground = foreground.is_some() && foreground == raw_window(&window);
    if !already_foreground {
        let target = foreground.map(|foreground| {
            if app.get_webview_window("main").as_ref().and_then(raw_window) == Some(foreground) {
                ReturnTarget::Library
            } else {
                ReturnTarget::External(foreground)
            }
        });
        let height = {
            let state = app.state::<Capture>();
            let mut state = state.lock().unwrap();
            state.target = target;
            state.height
        };
        if let Some(area) = foreground
            .and_then(ForegroundWindow::work_area)
            .or_else(WorkArea::for_pointer)
        {
            let (size, position) = geometry(&area, height);
            let _ = window.set_position(position);
            let _ = window.set_size(size);
        }
    }
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval("window.dispatchEvent(new Event('dump:capture-open'));document.querySelector('textarea')?.focus()");
    // Apply after Tao's queued visibility/style updates, which replace extended styles.
    let _ = app.run_on_main_thread(move || {
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let raw = hwnd.0.cast();
                if IsWindowVisible(raw) != 0 {
                    let style = GetWindowLongPtrW(raw, GWL_EXSTYLE);
                    SetWindowLongPtrW(
                        raw,
                        GWL_EXSTYLE,
                        (style & !(WS_EX_APPWINDOW as isize)) | WS_EX_TOOLWINDOW as isize,
                    );
                    SetWindowPos(
                        raw,
                        HWND_TOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
            }
        }
    });
}

pub(crate) fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let port = window.app_handle().state::<Capture>().lock().unwrap().port;
    let url = window.url().map_err(|error| error.to_string())?;
    if window.label() != "capture"
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(port)
    {
        return Err("Capture command is only available to the capture window.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn capture_hide(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let was_foreground = ForegroundWindow::current() == raw_window(&window);
    window.hide().map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(false);
    let target = window
        .app_handle()
        .state::<Capture>()
        .lock()
        .unwrap()
        .target
        .take();
    if was_foreground {
        match target {
            Some(ReturnTarget::Library) => {
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            Some(ReturnTarget::External(target)) => {
                target.restore();
            }
            None => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub fn capture_resize(window: WebviewWindow, height: f64) -> Result<(), String> {
    authorize(&window)?;
    if !height.is_finite() || height <= 0.0 {
        return Err("Invalid capture height.".into());
    }
    window
        .app_handle()
        .state::<Capture>()
        .lock()
        .unwrap()
        .height = height;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    if let Some(area) = raw_window(&window).and_then(ForegroundWindow::work_area) {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let bottom = area.y + area.height - (16.0 * scale).round() as i32;
        let height = (height * scale)
            .round()
            .clamp(1.0, f64::from((bottom - position.y).max(1))) as u32;
        let width = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .width;
        window
            .set_size(PhysicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn capture_saved(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    if let Some(main) = window.app_handle().get_webview_window("main") {
        main.eval("window.dispatchEvent(new Event('dump:refresh'))")
            .map_err(|error| error.to_string())?;
    }
    window
        .eval("window.dispatchEvent(new Event('dump:recents-refresh'))")
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn capture_attention(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    open(window.app_handle());
    Ok(())
}

#[tauri::command]
pub fn capture_writing(window: WebviewWindow, writing: bool) -> Result<(), String> {
    authorize(&window)?;
    window
        .app_handle()
        .state::<Capture>()
        .lock()
        .unwrap()
        .writing = writing;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_on_the_foreground_monitor_with_logical_size() {
        let area = WorkArea {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1040,
            scale: 1.5,
        };
        let (size, position) = geometry(&area, 164.0);
        assert_eq!(size, PhysicalSize::new(720, 246));
        assert_eq!(position, PhysicalPosition::new(-1320, 263));
    }

    #[test]
    fn caps_to_small_work_areas() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            scale: 1.0,
        };
        let (size, position) = geometry(&area, 500.0);
        assert_eq!(size, PhysicalSize::new(268, 168));
        assert_eq!(position, PhysicalPosition::new(16, 16));
    }
}

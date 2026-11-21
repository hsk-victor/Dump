use std::fs;
use std::sync::Mutex;

use dump_desktop::desktop_windows::{ForegroundWindow, WorkArea};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
};

const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 860.0;
const MIN_WIDTH: f64 = 400.0;
const MIN_HEIGHT: f64 = 500.0;
const FILE: &str = "window-bounds.json";

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Bounds {
    monitor_x: i32,
    monitor_y: i32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

#[derive(Default)]
pub struct WindowBounds(Mutex<Option<Bounds>>);

pub fn restore(window: &WebviewWindow) {
    let app = window.app_handle();
    let saved = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| fs::read(dir.join(FILE)).ok())
        .and_then(|bytes| serde_json::from_slice::<Bounds>(&bytes).ok())
        .filter(|bounds| bounds.width > 0.0 && bounds.height > 0.0);
    let saved_area =
        saved.and_then(|bounds| WorkArea::at(bounds.monitor_x, bounds.monitor_y, false));
    let same_monitor = saved_area.is_some();
    if let Some(area) = saved_area.or_else(WorkArea::for_pointer) {
        let frame = decoration(window, area.scale);
        let (size, position) = fit(saved, same_monitor, &area, frame);
        let min = PhysicalSize::new(
            (((MIN_WIDTH * area.scale).round() as u32).min(size.width)).max(1),
            (((MIN_HEIGHT * area.scale).round() as u32).min(size.height)).max(1),
        );
        let _ = window.set_min_size(Some(min));
        let _ = window.set_position(position);
        let _ = window.set_size(size);
    }
    let _ = window.show();
    remember(window);
    if saved.is_some_and(|bounds| bounds.maximized) {
        let _ = window.maximize();
        if let Some(bounds) = &mut *app.state::<WindowBounds>().0.lock().unwrap() {
            bounds.maximized = true;
        }
    }
    let _ = window.set_focus();
    let library = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }
        ) {
            remember(&library);
        }
    });
}

fn decoration(window: &WebviewWindow, target_scale: f64) -> PhysicalSize<u32> {
    let (Ok(outer), Ok(inner), Ok(scale)) = (
        window.outer_size(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return PhysicalSize::new(0, 0);
    };
    let factor = target_scale / scale;
    PhysicalSize::new(
        (f64::from(outer.width.saturating_sub(inner.width)) * factor).round() as u32,
        (f64::from(outer.height.saturating_sub(inner.height)) * factor).round() as u32,
    )
}

fn fit(
    saved: Option<Bounds>,
    same_monitor: bool,
    area: &WorkArea,
    frame: PhysicalSize<u32>,
) -> (PhysicalSize<u32>, PhysicalPosition<i32>) {
    let limit_width = (area.width - frame.width as i32).max(1) as u32;
    let limit_height = (area.height - frame.height as i32).max(1) as u32;
    let width = MIN_WIDTH.max(saved.map_or(DEFAULT_WIDTH, |b| b.width));
    let height = MIN_HEIGHT.max(saved.map_or(DEFAULT_HEIGHT, |b| b.height));
    let size = PhysicalSize::new(
        ((width * area.scale).round() as u32).clamp(1, limit_width),
        ((height * area.scale).round() as u32).clamp(1, limit_height),
    );
    let free_x = (limit_width - size.width) as i32;
    let free_y = (limit_height - size.height) as i32;
    let (dx, dy) = match saved.filter(|_| same_monitor) {
        Some(b) => (
            ((b.x * area.scale).round() as i32).clamp(0, free_x),
            ((b.y * area.scale).round() as i32).clamp(0, free_y),
        ),
        None => (free_x / 2, free_y / 2),
    };
    (size, PhysicalPosition::new(area.x + dx, area.y + dy))
}

pub(crate) fn remember(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let raw = hwnd.0.cast();
    if unsafe { IsWindowVisible(raw) == 0 || IsIconic(raw) != 0 } {
        return;
    }
    let state = window.app_handle().state::<WindowBounds>();
    let mut saved = state.0.lock().unwrap();
    if unsafe { IsZoomed(raw) != 0 } {
        if let Some(bounds) = saved.as_mut() {
            bounds.maximized = true;
        }
        return;
    }
    let Some(area) = ForegroundWindow::from_raw(hwnd.0 as isize).work_area() else {
        return;
    };
    let mut outer = Default::default();
    let mut client = Default::default();
    if unsafe { GetWindowRect(raw, &mut outer) == 0 || GetClientRect(raw, &mut client) == 0 } {
        return;
    }
    let width = client.right - client.left;
    let height = client.bottom - client.top;
    if width <= 0 || height <= 0 {
        return;
    }
    *saved = Some(Bounds {
        monitor_x: area.x + area.width / 2,
        monitor_y: area.y + area.height / 2,
        x: f64::from(outer.left - area.x) / area.scale,
        y: f64::from(outer.top - area.y) / area.scale,
        width: f64::from(width) / area.scale,
        height: f64::from(height) / area.scale,
        maximized: false,
    });
}

pub fn persist(app: &AppHandle) {
    let Some(bounds) = *app.state::<WindowBounds>().0.lock().unwrap() else {
        return;
    };
    if let (Ok(dir), Ok(bytes)) = (app.path().app_data_dir(), serde_json::to_vec(&bounds)) {
        if fs::create_dir_all(&dir).is_err() {
            return;
        }
        let path = dir.join(FILE);
        let temp = path.with_extension("tmp");
        if fs::write(&temp, bytes).is_ok() {
            let _ = fs::rename(&temp, path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAVED: Bounds = Bounds {
        monitor_x: 1800,
        monitor_y: 500,
        x: 180.0,
        y: 120.0,
        width: 900.0,
        height: 720.0,
        maximized: true,
    };

    #[test]
    fn restores_relative_position_and_logical_size_after_dpi_change() {
        let area = WorkArea {
            x: -1800,
            y: 0,
            width: 1800,
            height: 1400,
            scale: 1.5,
        };
        let (size, position) = fit(Some(SAVED), true, &area, PhysicalSize::new(16, 48));
        assert_eq!(size, PhysicalSize::new(1350, 1080));
        assert_eq!(position, PhysicalPosition::new(-1530, 180));
    }

    #[test]
    fn caps_the_size_on_a_smaller_remaining_monitor() {
        let area = WorkArea {
            x: 0,
            y: 40,
            width: 760,
            height: 480,
            scale: 1.0,
        };
        let (size, position) = fit(Some(SAVED), false, &area, PhysicalSize::new(16, 38));
        assert_eq!(size, PhysicalSize::new(744, 442));
        assert_eq!(position, PhysicalPosition::new(0, 40));
    }
}

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
};
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, IsWindow, IsWindowVisible, SetForegroundWindow,
};

pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

#[derive(Clone, Copy)]
pub struct ForegroundWindow(isize);

impl ForegroundWindow {
    pub fn current() -> Option<Self> {
        let hwnd = unsafe { GetForegroundWindow() };
        (!hwnd.is_null() && unsafe { IsWindowVisible(hwnd) } != 0).then_some(Self(hwnd as isize))
    }

    pub fn from_raw(hwnd: isize) -> Self {
        Self(hwnd)
    }

    pub fn restore(self) -> bool {
        let hwnd = self.0 as HWND;
        unsafe {
            IsWindow(hwnd) != 0 && IsWindowVisible(hwnd) != 0 && SetForegroundWindow(hwnd) != 0
        }
    }

    pub fn work_area(self) -> Option<WorkArea> {
        work_area(unsafe { MonitorFromWindow(self.0 as HWND, MONITOR_DEFAULTTONULL) })
    }
}

impl WorkArea {
    pub fn at(x: i32, y: i32, nearest: bool) -> Option<Self> {
        let policy = if nearest {
            MONITOR_DEFAULTTONEAREST
        } else {
            MONITOR_DEFAULTTONULL
        };
        work_area(unsafe { MonitorFromPoint(POINT { x, y }, policy) })
    }

    pub fn for_pointer() -> Option<Self> {
        let mut pos = POINT::default();
        if unsafe { GetCursorPos(&mut pos) } == 0 {
            return None;
        }
        Self::at(pos.x, pos.y, true)
    }
}

fn work_area(monitor: HMONITOR) -> Option<WorkArea> {
    if monitor == null_mut() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return None;
    }
    let (mut dx, mut dy) = (96, 96);
    let scale = if unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) } >= 0 {
        f64::from(dx) / 96.0
    } else {
        1.0
    };
    let area = info.rcWork;
    Some(WorkArea {
        x: area.left,
        y: area.top,
        width: area.right - area.left,
        height: area.bottom - area.top,
        scale,
    })
}

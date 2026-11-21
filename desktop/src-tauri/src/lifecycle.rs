use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

use crate::{capture_window::Capture, tray, window_bounds};

#[derive(Default)]
pub struct Lifecycle(AtomicBool);

fn hide_on_close(tray_ready: bool, quitting: bool) -> bool {
    tray_ready && !quitting
}

pub fn install(window: &WebviewWindow) {
    let library = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let app = library.app_handle();
            window_bounds::remember(&library);
            window_bounds::persist(app);
            let quitting = app.state::<Lifecycle>().0.load(Ordering::SeqCst);
            if hide_on_close(tray::initialized(app), quitting) {
                api.prevent_close();
                let _ = library.hide();
            } else if !quitting {
                app.exit(0);
            }
        }
    });
}

fn wait_for_write(mut writing: impl FnMut() -> bool, limit: Duration) {
    let start = Instant::now();
    while start.elapsed() < limit && writing() {
        std::thread::sleep(Duration::from_millis(50).min(limit.saturating_sub(start.elapsed())));
    }
}

pub fn quit(app: &AppHandle) {
    if app.state::<Lifecycle>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        wait_for_write(
            || app.state::<Capture>().lock().unwrap().writing,
            Duration::from_secs(5),
        );
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hides_with_a_working_tray_outside_quit() {
        assert!(hide_on_close(true, false));
        assert!(!hide_on_close(false, false));
        assert!(!hide_on_close(true, true));
        assert!(!hide_on_close(false, true));
    }

    #[test]
    fn quit_waits_for_settled_writes_but_never_past_the_deadline() {
        let mut checks = 0;
        wait_for_write(
            || {
                checks += 1;
                checks < 2
            },
            Duration::from_secs(1),
        );
        assert_eq!(checks, 2);
        wait_for_write(|| panic!("must check writing"), Duration::ZERO);
        let start = Instant::now();
        wait_for_write(|| true, Duration::from_millis(10));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}

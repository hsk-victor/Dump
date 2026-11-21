use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

pub fn prepare(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if attempt(&app).await {
                return;
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn attempt(app: &AppHandle) -> bool {
    let updater = match app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .restart_after_install(false)
        .build()
    {
        Ok(updater) => updater,
        Err(_) => {
            log(app, "The desktop updater is not configured correctly.");
            return false;
        }
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return false,
        Err(_) => {
            log(app, "Could not check for a desktop update.");
            return false;
        }
    };
    match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => {
            *app.state::<PendingUpdate>().0.lock().unwrap() = Some((update, bytes));
            true
        }
        Err(_) => {
            log(app, "Could not download or verify the desktop update.");
            false
        }
    }
}

pub fn install_on_exit(app: &AppHandle) {
    let pending = app.state::<PendingUpdate>().0.lock().unwrap().take();
    if let Some((update, bytes)) = pending {
        if update.install(bytes).is_err() {
            log(
                app,
                "Could not install the desktop update. Dump will retry on the next launch.",
            );
        }
    }
}

fn log(app: &AppHandle, message: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(mut file) = OpenOptions::new()
        .append(true)
        .create(true)
        .open(dir.join("updater.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

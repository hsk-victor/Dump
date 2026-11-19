// Dump desktop: starts the bundled Dump server (Node + Next.js standalone) on
// localhost and shows it in the app window. Data lives in the OS app-data folder.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

// A fixed port keeps the page origin, and with it localStorage (theme, density), stable across launches.
const PREFERRED_PORT: u16 = 47913;
const START_TIMEOUT: Duration = Duration::from_secs(45);

struct Server(Mutex<Option<Child>>);

fn pick_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(PREFERRED_PORT)
}

fn spawn_server(server_dir: &Path, data_dir: &Path, log_dir: &Path, port: u16) -> std::io::Result<Child> {
    fs::create_dir_all(data_dir)?;
    fs::create_dir_all(log_dir)?;
    let log = File::create(log_dir.join("server.log"))?;
    let mut cmd = Command::new(server_dir.join("node.exe"));
    cmd.arg(server_dir.join("server-entry.cjs"))
        .current_dir(server_dir)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("DUMP_DATA_DIR", data_dir)
        .env("DUMP_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

fn wait_for_port(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let js = format!(
            "var s=document.getElementById('status');s.className='failed';s.textContent={:?};",
            message
        );
        let _ = window.eval(&js);
    }
}

fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let server_dir = dunce::simplified(&app.path().resource_dir()?.join("server")).to_path_buf();
    let data_dir: PathBuf = app.path().app_data_dir()?;
    let log_dir: PathBuf = app.path().app_log_dir()?;
    let port = pick_port();
    let child = spawn_server(&server_dir, &data_dir, &log_dir, port)?;
    *app.state::<Server>().0.lock().unwrap() = Some(child);

    let handle = app.clone();
    thread::spawn(move || {
        if wait_for_port(port) {
            if let Some(window) = handle.get_webview_window("main") {
                let url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
                let _ = window.navigate(url);
            }
        } else {
            let log = log_dir.join("server.log");
            show_error(
                &handle,
                &format!("Dump's server didn't start.\nDetails are in {}", log.display()),
            );
        }
    });
    Ok(())
}

fn stop_server(app: &AppHandle) {
    if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Dump")
                .inner_size(1280.0, 860.0)
                .min_inner_size(400.0, 500.0)
                .build()?;
            if let Err(e) = start(app.handle()) {
                show_error(app.handle(), &format!("Dump couldn't start: {e}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Dump")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}

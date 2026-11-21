// Dump desktop: starts the bundled Dump server (Node + Next.js standalone) on
// localhost and shows it in the app window. Data lives in the OS app-data folder.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod updater;
#[cfg(windows)]
mod window_bounds;
#[cfg(windows)]
mod capture_window;
#[cfg(windows)]
mod tray;
#[cfg(windows)]
mod lifecycle;
#[cfg(windows)]
mod shortcut_settings;

use std::fs::{self, File};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

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

fn random_hex() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

// A per-launch secret the server requires (src/middleware.ts), so other Windows accounts can't use the
// loopback port. It goes in the environment, which other accounts can't read, unlike the command line.
fn launch_token() -> std::io::Result<String> {
    random_hex()
}

// The bookmarklet runs in the user's browser, which never sees the launch token, so it carries this
// key instead. It lasts across launches (the bookmark keeps working) and only lets `/dump` save a page.
// It lives in the per-user app-data folder, which other accounts can't read.
fn bookmarklet_key(data_dir: &Path) -> std::io::Result<String> {
    let path = data_dir.join("bookmarklet.key");
    if let Ok(key) = fs::read_to_string(&path) {
        let key = key.trim();
        if key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ok(key.to_string());
        }
    }
    let key = random_hex()?;
    fs::write(&path, &key)?;
    Ok(key)
}

fn spawn_server(
    server_dir: &Path,
    data_dir: &Path,
    log_dir: &Path,
    port: u16,
    token: &str,
) -> std::io::Result<Child> {
    fs::create_dir_all(data_dir)?;
    fs::create_dir_all(log_dir)?;
    let bookmarklet_key = bookmarklet_key(data_dir)?;
    let log = File::create(log_dir.join("server.log"))?;
    let mut cmd = Command::new(server_dir.join("node.exe"));
    cmd.arg(server_dir.join("server-entry.cjs"))
        .current_dir(server_dir)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("DUMP_DATA_DIR", data_dir)
        .env("DUMP_PARENT_PID", std::process::id().to_string())
        .env("DUMP_DESKTOP_TOKEN", token)
        .env("DUMP_BOOKMARKLET_KEY", bookmarklet_key)
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

// The window only shows the splash and the local server; any other page opens in the default browser.
fn is_app_url(url: &Url, port: u16) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" => {
            let host = url.host_str();
            host == Some("tauri.localhost") || (host == Some("127.0.0.1") && url.port() == Some(port))
        }
        _ => false,
    }
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn start(app: &AppHandle, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let server_dir = dunce::simplified(&app.path().resource_dir()?.join("server")).to_path_buf();
    let data_dir: PathBuf = app.path().app_data_dir()?;
    let log_dir: PathBuf = app.path().app_log_dir()?;
    let token = launch_token()?;
    let child = spawn_server(&server_dir, &data_dir, &log_dir, port, &token)?;
    *app.state::<Server>().0.lock().unwrap() = Some(child);

    let handle = app.clone();
    thread::spawn(move || {
        if wait_for_port(port) {
            if let Some(window) = handle.get_webview_window("main") {
                let url = Url::parse(&format!("http://127.0.0.1:{port}/?dump_token={token}")).unwrap();
                let _ = window.navigate(url);
            }
            #[cfg(windows)]
            {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Err(error) = capture_window::create(&app, port, &token) {
                        eprintln!("Couldn't create quick capture: {error}");
                    }
                });
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

fn open_library(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let builder = tauri::Builder::default()
        // A second launch focuses the running window instead of starting another server on the same library.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_library(app);
        }))
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(Server(Mutex::new(None)));
    #[cfg(windows)]
    let builder = builder
        .manage(window_bounds::WindowBounds::default())
        .manage(capture_window::Capture::default())
        .manage(tray::Tray::default())
        .manage(lifecycle::Lifecycle::default())
        .plugin(dump_desktop::capture_native::shortcut_plugin(capture_window::open))
        .invoke_handler(tauri::generate_handler![
            capture_window::capture_hide,
            capture_window::capture_resize,
            capture_window::capture_saved,
            capture_window::capture_writing,
            capture_window::capture_attention,
            tray::capture_recents,
            shortcut_settings::shortcut_settings,
            shortcut_settings::set_capture_shortcut,
        ]);
    #[cfg(windows)]
    let builder = builder.manage(updater::PendingUpdate::default());
    builder
        .setup(|app| {
            #[cfg(windows)]
            let updater_enabled = app.config().plugins.0.contains_key("updater");
            #[cfg(windows)]
            if updater_enabled {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let port = pick_port();
            let nav_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Dump")
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(400.0, 500.0)
                    .visible(!cfg!(windows))
                    .on_navigation(move |url| {
                        if is_app_url(url, port) {
                            return true;
                        }
                        open_external(&nav_app, url);
                        false
                    })
                    .on_new_window(move |url, _features| {
                        open_external(&popup_app, &url);
                        NewWindowResponse::Deny
                    })
                    .build()?;
            #[cfg(windows)]
            window_bounds::restore(&window);
            #[cfg(windows)]
            shortcut_settings::load(app.handle());
            #[cfg(windows)]
            if let Err(error) = tray::create(app.handle()) {
                eprintln!("Couldn't create the tray: {error}");
            }
            #[cfg(windows)]
            lifecycle::install(&window);
            #[cfg(not(windows))]
            drop(window);
            if let Err(e) = start(app.handle(), port) {
                show_error(app.handle(), &format!("Dump couldn't start: {e}"));
            }
            #[cfg(windows)]
            if updater_enabled {
                updater::prepare(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Dump")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                #[cfg(windows)]
                window_bounds::persist(app);
                stop_server(app);
                #[cfg(windows)]
                updater::install_on_exit(app);
            }
        });
}

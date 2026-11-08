//! Folio for Mac: a window that starts Folio's server and shows it.
//! The page itself gets no access to the app; links, downloads and updates are handled here.

mod downloads;
mod links;
mod port;
mod server;
mod update;

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, RunEvent, Url, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_window_state::StateFlags;

const FIRST_PORT: u16 = 5174;
const PORTS: u16 = 5;

/// The port Folio's server answers on, once known (0 before).
static PORT: AtomicU16 = AtomicU16::new(0);

/// Folio's server, when this app started it. Empty when the app reuses a Folio that was already running.
struct Server(Mutex<Option<CommandChild>>);

pub fn run() {
    let app = tauri::Builder::default()
        // Opening Folio again brings back the window that's already there.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // Remember size and place, but not "hidden": closing the window only hides it.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Folio")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                // Let Folio's own drop zones receive files dragged from Finder.
                .disable_drag_drop_handler()
                .initialization_script(links::EXTERNAL_LINKS_SCRIPT)
                .on_navigation(|url| links::allows_navigation(url, PORT.load(Ordering::Relaxed)))
                .on_new_window(|url, _features| {
                    if links::opens_in_browser(&url) {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .on_download(save_download)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || boot(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Folio couldn't start");

    app.run(|app, event| match event {
        // The red button hides the window; Folio keeps running until ⌘Q.
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::Exit => stop_server(app),
        _ => {}
    });
}

/// Starts (or finds) Folio's server, then shows it in the window.
fn boot(app: &AppHandle) {
    let Some((port, reuse)) = port::choose_port(first_port(), PORTS, port::probe) else {
        return show_error(app, "Ports 5174 to 5178 are all used by other apps. Quit one of them and open Folio again.");
    };
    if !reuse {
        let handle = app.clone();
        let on_stop = move || {
            // Still stored means nobody asked it to stop: it crashed or was killed.
            if take_server(&handle).is_some() {
                show_error(&handle, "Folio stopped unexpectedly.");
            }
        };
        match server::start(app, port, on_stop) {
            Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
            Err(e) => return show_error(app, &format!("Folio couldn't start: {e}")),
        }
    }
    PORT.store(port, Ordering::Relaxed);
    if server::wait_ready(port, Duration::from_secs(30)) {
        if let (Some(window), Ok(url)) = (app.get_webview_window("main"), Url::parse(&format!("http://localhost:{port}/"))) {
            let _ = window.navigate(url);
        }
        tauri::async_runtime::spawn(update::offer_update(app.clone()));
    } else {
        stop_server(app);
        show_error(app, "Folio didn't start within 30 seconds.");
    }
}

/// Saves downloads (exports, backups, CSVs) to Downloads under a free name, then shows them in Finder.
fn save_download(webview: Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let dir = webview.app_handle().path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
            let name = destination
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_owned)
                .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(str::to_owned))
                .unwrap_or_default();
            *destination = downloads::unique_path(&dir, &name, |p| p.exists());
        }
        DownloadEvent::Finished { path: Some(path), success: true, .. } => {
            let _ = tauri_plugin_opener::reveal_item_in_dir(path);
        }
        _ => {}
    }
    true
}

fn first_port() -> u16 {
    // Debug builds only: try the app while your everyday Folio keeps port 5174.
    #[cfg(debug_assertions)]
    if let Some(port) = std::env::var("FOLIO_FIRST_PORT").ok().and_then(|v| v.parse().ok()) {
        return port;
    }
    FIRST_PORT
}

/// Shows the start-up page with a message, the log's location and a Restart button.
fn show_error(app: &AppHandle, message: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(mut url) = Url::parse("tauri://localhost/index.html") else { return };
    let log = server::log_path(app).map(|p| p.display().to_string()).unwrap_or_default();
    url.query_pairs_mut().append_pair("error", message).append_pair("log", &log);
    let _ = window.navigate(url);
    show_main(app);
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn take_server(app: &AppHandle) -> Option<CommandChild> {
    app.state::<Server>().0.lock().ok()?.take()
}

/// Stops the server this app started. A Folio that was already running is left alone.
pub(crate) fn stop_server(app: &AppHandle) {
    if let Some(child) = take_server(app) {
        let _ = child.kill();
    }
}

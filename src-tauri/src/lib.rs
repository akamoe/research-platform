//! Folio for Mac: a window that starts Folio's server and shows it.
//! The page itself gets no access to the app; links, downloads and updates are handled here.

mod downloads;
mod links;
mod port;
mod server;
mod update;

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};

use port::{Choice, PortState};
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
            #[cfg(target_os = "macos")]
            app.set_menu(menu_with_safe_quit(app.handle())?)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || boot(&handle));
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == QUIT_ID {
                quit(app);
            }
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
        // Any other way of quitting that asks first: save, then quit.
        RunEvent::ExitRequested { api, .. } if !QUITTING.load(Ordering::SeqCst) => {
            api.prevent_exit();
            quit(app);
        }
        RunEvent::Exit => stop_server(app),
        _ => {}
    });
}

/// Set once Folio is quitting or restarting, so a server that stops isn't reported as a crash.
static QUITTING: AtomicBool = AtomicBool::new(false);
/// Set when the server this app started has ended (crash, kill or quit).
static ENDED: AtomicBool = AtomicBool::new(false);
static UPDATE_OFFERED: AtomicBool = AtomicBool::new(false);

/// Starts (or finds) Folio's server, then shows it in the window.
fn boot(app: &AppHandle) {
    let (port, reuse) = match port::choose_port(first_port(), PORTS, port::probe) {
        Some(Choice::Start(port)) => (port, false),
        Some(Choice::Reuse(port)) => (port, true),
        Some(Choice::Wait(port)) => {
            return show_error(app, &format!("A Folio on port {port} isn't answering. Wait a moment, then press Restart."));
        }
        None => return show_error(app, "Ports 5174 to 5178 are all used by other apps. Quit one of them and open Folio again."),
    };
    if !reuse {
        ENDED.store(false, Ordering::SeqCst);
        let handle = app.clone();
        let on_stop = move || {
            ENDED.store(true, Ordering::SeqCst);
            // Still stored means nobody asked it to stop: it crashed or was killed.
            if take_server(&handle).is_some() && !QUITTING.load(Ordering::SeqCst) {
                show_error(&handle, "Folio stopped unexpectedly.");
            }
        };
        match server::start(app, port, on_stop) {
            Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
            Err(e) => return show_error(app, &format!("Folio couldn't start: {e}")),
        }
    }
    PORT.store(port, Ordering::Relaxed);
    let alive = || reuse || !ENDED.load(Ordering::SeqCst);
    if server::wait_ready(port, Duration::from_secs(30), alive) {
        if let (Some(window), Ok(url)) = (app.get_webview_window("main"), Url::parse(&format!("http://localhost:{port}/"))) {
            let _ = window.navigate(url);
        }
        if !UPDATE_OFFERED.swap(true, Ordering::SeqCst) {
            tauri::async_runtime::spawn(update::offer_update(app.clone()));
        }
        if reuse {
            let app = app.clone();
            std::thread::spawn(move || watch_reused(&app, port));
        }
    } else if QUITTING.load(Ordering::SeqCst) {
    } else if ENDED.load(Ordering::SeqCst) {
        show_error(app, "Folio stopped unexpectedly.");
    } else {
        stop_server(app);
        show_error(app, "Folio didn't start within 30 seconds.");
    }
}

/// A Folio this app didn't start can stop at any time (`npm run stop`, or one left behind by a
/// crash that is about to exit). When nothing listens on its port any more, start our own.
fn watch_reused(app: &AppHandle, port: u16) {
    loop {
        std::thread::sleep(Duration::from_secs(2));
        if QUITTING.load(Ordering::SeqCst) {
            return;
        }
        if port::probe(port) == PortState::Free {
            return boot(app);
        }
    }
}

const QUIT_ID: &str = "folio-quit";

/// The standard menu, but ⌘Q is our own item: macOS's built-in Quit ends the app at once,
/// before the page can save what's still waiting.
#[cfg(target_os = "macos")]
fn menu_with_safe_quit(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        if let Some(MenuItemKind::Predefined(builtin_quit)) = app_menu.items()?.into_iter().last() {
            app_menu.remove(&builtin_quit)?;
        }
        app_menu.append(&MenuItem::with_id(app, QUIT_ID, "Quit Folio", true, Some("CmdOrCtrl+Q"))?)?;
    }
    Ok(menu)
}

/// Saves, stops the server we started, then quits. Runs once.
fn quit(app: &AppHandle) {
    if QUITTING.load(Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        flush_and_stop(&app);
        app.exit(0);
    });
}

/// Lets the page save edits that are still waiting (the same `beforeunload` a closing tab
/// gets), gives the saves a moment to reach the server, then stops the server we started.
pub(crate) fn flush_and_stop(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        if window.url().is_ok_and(|u| u.scheme() == "http") {
            let _ = window.eval("window.dispatchEvent(new Event('beforeunload'))");
            std::thread::sleep(Duration::from_millis(1500));
        }
    }
    stop_server(app);
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

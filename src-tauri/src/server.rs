//! Starts Folio's server (server/index.ts) with the Node.js the app carries.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::port::{probe, PortState};

/// Apps opened from Finder or the Dock get a bare PATH; these are where TeX, pandoc and git usually live.
const EXTRA_PATH: &str = "/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin";

/// The server's output from the last time the app started it.
pub fn log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|dir| dir.join("server.log"))
}

/// Starts the server on `port`. `on_stop` runs when the server process ends.
pub fn start(app: &AppHandle, port: u16, on_stop: impl Fn() + Send + 'static) -> Result<CommandChild, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("app");
    let entry = dir.join("server").join("index.ts");
    let path = match std::env::var("PATH") {
        Ok(p) if !p.is_empty() => format!("{p}:{EXTRA_PATH}"),
        _ => format!("/usr/bin:/bin:/usr/sbin:/sbin:{EXTRA_PATH}"),
    };
    let (mut events, child) = app
        .shell()
        .sidecar("node")
        .map_err(|e| e.to_string())?
        .args([entry.to_string_lossy().into_owned()])
        .current_dir(&dir)
        .env("PATH", path)
        .env("RP_PORT", port.to_string())
        .env("RP_DESKTOP", "1")
        .env("RP_DESKTOP_VERSION", app.package_info().version.to_string())
        .env("RP_PARENT_PID", std::process::id().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    let log = log_path(app);
    if let Some(parent) = log.as_ref().and_then(|p| p.parent()) {
        let _ = fs::create_dir_all(parent);
    }
    tauri::async_runtime::spawn(async move {
        let mut file = log.and_then(|p| OpenOptions::new().create(true).write(true).truncate(true).open(p).ok());
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    if let Some(f) = file.as_mut() {
                        let _ = f.write_all(&line);
                        if !line.ends_with(b"\n") {
                            let _ = f.write_all(b"\n");
                        }
                    }
                }
                CommandEvent::Terminated(_) => {
                    on_stop();
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

/// Waits until Folio answers on `port`.
pub fn wait_ready(port: u16, timeout: Duration) -> bool {
    let end = Instant::now() + timeout;
    while Instant::now() < end {
        if probe(port) == PortState::Folio {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

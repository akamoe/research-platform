//! Checks GitHub Releases for a newer Folio for Mac once the window shows Folio, and offers it.
//! Updates are signed (minisign); the public key is in tauri.conf.json.

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_updater::UpdaterExt;

pub async fn offer_update(app: AppHandle) {
    // Development builds aren't installed copies; never replace them.
    if cfg!(debug_assertions) {
        return;
    }
    tokio_sleep(Duration::from_secs(5)).await;
    if let Err(e) = try_update(&app).await {
        eprintln!("Folio update check failed: {e}");
    }
}

async fn try_update(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    // macOS shows this as a system alert, and an alert closed any other way than a click
    // returns its default (first) button. So "Later" is the default and only an explicit
    // "Install and restart" installs. (Attached to the window as a sheet, rfd answered at once.)
    let answer = app
        .dialog()
        .message("Install it now? Folio will restart. Your projects stay where they are.")
        .title(format!("Folio {} is ready", update.version))
        .buttons(MessageDialogButtons::OkCancelCustom(LATER.into(), INSTALL.into()))
        .blocking_show_with_result();
    if !is_install(&answer) {
        return Ok(());
    }
    update.download_and_install(|_, _| {}, || {}).await?;
    // Stop our server first: a restart may skip the exit event that normally does it.
    crate::stop_server(app);
    app.restart();
}

const LATER: &str = "Later";
const INSTALL: &str = "Install and restart";

/// Only a click on "Install and restart" counts; anything else (Later, closed, dismissed) waits.
fn is_install(answer: &MessageDialogResult) -> bool {
    matches!(answer, MessageDialogResult::Custom(label) if label == INSTALL)
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_explicit_install_click_installs() {
        assert!(is_install(&MessageDialogResult::Custom(INSTALL.into())));
        assert!(!is_install(&MessageDialogResult::Custom(LATER.into())));
        // What a dismissed or failed dialog can come back as.
        assert!(!is_install(&MessageDialogResult::Ok));
        assert!(!is_install(&MessageDialogResult::Yes));
        assert!(!is_install(&MessageDialogResult::Cancel));
    }
}

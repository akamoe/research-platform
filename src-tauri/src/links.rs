//! Which addresses stay in Folio's window and which go to the default browser.
//!
//! WebKit asks about every frame (YouTube players included) without saying which
//! frame is navigating, so the navigation check never opens anything: it lets Folio
//! and YouTube frames through and quietly blocks the rest. Links reach the browser
//! through new-window requests instead (`target="_blank"`, `window.open`), and
//! `EXTERNAL_LINKS_SCRIPT` turns plain outside links into those.

use tauri::Url;

/// The music player and YouTube sources embed these.
const YOUTUBE_HOSTS: [&str; 4] = ["youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"];

/// Plain links to other sites get `target="_blank"` on click, so they open in the browser
/// (through the new-window handler) instead of replacing Folio in the window.
pub const EXTERNAL_LINKS_SCRIPT: &str = r#"
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null
  if (a && !a.target && a.origin !== location.origin && /^(https?|mailto):/.test(a.href)) a.target = "_blank"
}, true)
"#;

/// Folio's own pages: its server on `port`, the start-up page, blank frames, and blobs it made.
pub fn is_internal(url: &Url, port: u16) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" => true,
        "blob" => Url::parse(url.path()).is_ok_and(|inner| is_internal(&inner, port)),
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1")) && url.port() == Some(port),
        _ => false,
    }
}

/// Whether a frame (the window or an embedded frame) may load `url`.
pub fn allows_navigation(url: &Url, port: u16) -> bool {
    is_internal(url, port) || (url.scheme() == "https" && url.host_str().is_some_and(|h| YOUTUBE_HOSTS.contains(&h)))
}

/// Whether a link may be handed to the default browser or mail app.
pub fn opens_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn folio_pages_are_internal() {
        for s in [
            "http://localhost:5174/#/p/x",
            "http://127.0.0.1:5174/api/x",
            "tauri://localhost/index.html",
            "about:blank",
            "blob:http://localhost:5174/9b1d-uuid",
        ] {
            assert!(is_internal(&url(s), 5174), "{s}");
        }
    }

    #[test]
    fn other_addresses_are_not_internal() {
        for s in ["http://localhost:9999/", "https://doi.org/10.1/x", "mailto:a@b.c", "blob:https://example.com/x"] {
            assert!(!is_internal(&url(s), 5174), "{s}");
        }
    }

    #[test]
    fn youtube_frames_may_load_but_other_sites_may_not() {
        assert!(allows_navigation(&url("https://www.youtube.com/embed/abc?enablejsapi=1"), 5174));
        assert!(allows_navigation(&url("https://www.youtube-nocookie.com/embed/abc"), 5174));
        assert!(allows_navigation(&url("http://localhost:5174/"), 5174));
        assert!(!allows_navigation(&url("https://googleads.g.doubleclick.net/pagead/x"), 5174));
        assert!(!allows_navigation(&url("https://doi.org/10.1/x"), 5174));
        assert!(!allows_navigation(&url("http://www.youtube.com/embed/abc"), 5174));
    }

    #[test]
    fn only_web_and_mail_links_go_to_the_browser() {
        assert!(opens_in_browser(&url("https://doi.org/10.1/x")));
        assert!(opens_in_browser(&url("http://example.com/")));
        assert!(opens_in_browser(&url("mailto:a@b.c")));
        assert!(!opens_in_browser(&url("javascript:alert(1)")));
        assert!(!opens_in_browser(&url("file:///etc/passwd")));
        assert!(!opens_in_browser(&url("tauri://localhost/index.html")));
    }
}

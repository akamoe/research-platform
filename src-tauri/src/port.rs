//! Which port Folio's server uses, and whether something there is already Folio.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortState {
    /// Nothing listens there.
    Free,
    /// A Folio server answers there (ours from before, or one started from the browser launcher).
    Folio,
    /// Some other app uses it.
    Other,
    /// Something accepted the connection but didn't answer in time (maybe a busy Folio).
    Busy,
}

/// What to do with the ports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Choice {
    /// Start Folio's server on this free port.
    Start(u16),
    /// Show the Folio already running here.
    Reuse(u16),
    /// Don't start a second server next to one that may be a busy Folio.
    Wait(u16),
}

/// How a raw HTTP reply to `GET /api/health` reads; `None` means no complete reply in time.
pub fn classify_reply(reply: Option<&str>) -> PortState {
    match reply.and_then(|r| r.split_once("\r\n\r\n")) {
        Some((_, body)) if is_folio_health(body) => PortState::Folio,
        Some(_) => PortState::Other,
        None => PortState::Busy,
    }
}

/// True when a `/api/health` body says it's Folio.
pub fn is_folio_health(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("app")?.as_str().map(|app| app == "folio"))
        .unwrap_or(false)
}

/// Asks 127.0.0.1:`port` what it is.
pub fn probe(port: u16) -> PortState {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return PortState::Free;
    };
    // A Folio busy re-reading PDFs can take a while; only a full reply that isn't Folio means "other".
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut reply = String::new();
    let asked = stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_ok();
    let complete = asked && stream.read_to_string(&mut reply).is_ok();
    classify_reply(complete.then_some(reply.as_str()))
}

/// The first of `count` ports from `first` that is Folio, free or busy; ports other apps use are skipped.
pub fn choose_port(first: u16, count: u16, probe: impl Fn(u16) -> PortState) -> Option<Choice> {
    (first..first + count).find_map(|port| match probe(port) {
        PortState::Free => Some(Choice::Start(port)),
        PortState::Folio => Some(Choice::Reuse(port)),
        PortState::Busy => Some(Choice::Wait(port)),
        PortState::Other => None,
    })
}

#[cfg(test)]
mod tests {
    use super::Choice::*;
    use super::PortState::*;
    use super::*;

    fn states(list: &'static [PortState]) -> impl Fn(u16) -> PortState {
        move |p| list.get((p - 5174) as usize).copied().unwrap_or(Other)
    }

    #[test]
    fn starts_on_the_first_port_when_free() {
        assert_eq!(choose_port(5174, 5, |_| Free), Some(Start(5174)));
    }

    #[test]
    fn reuses_a_running_folio() {
        assert_eq!(choose_port(5174, 5, states(&[Folio])), Some(Reuse(5174)));
    }

    #[test]
    fn skips_ports_other_apps_use() {
        assert_eq!(choose_port(5174, 5, states(&[Other, Free])), Some(Start(5175)));
        assert_eq!(choose_port(5174, 5, states(&[Other, Folio])), Some(Reuse(5175)));
    }

    #[test]
    fn never_starts_a_second_server_past_a_busy_one() {
        // Something answered the connection but not in time: maybe a busy Folio on the same data.
        assert_eq!(choose_port(5174, 5, states(&[Busy, Free])), Some(Wait(5174)));
        assert_eq!(choose_port(5174, 5, states(&[Other, Busy])), Some(Wait(5175)));
    }

    #[test]
    fn gives_up_when_all_ports_are_taken() {
        assert_eq!(choose_port(5174, 5, |_| Other), None);
    }

    #[test]
    fn recognizes_folio_health() {
        assert!(is_folio_health(r#"{"app":"folio","pid":1}"#));
        assert!(!is_folio_health("{}"));
        assert!(!is_folio_health("<html>"));
        assert!(!is_folio_health(r#"{"app":"other"}"#));
    }

    #[test]
    fn reads_a_reply_as_folio_other_or_busy() {
        let ok = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"app\":\"folio\",\"pid\":1}";
        assert_eq!(classify_reply(Some(ok)), Folio);
        assert_eq!(classify_reply(Some("HTTP/1.1 404 Not Found\r\n\r\nnope")), Other);
        assert_eq!(classify_reply(Some("HTTP/1.1 200 OK\r\ncontent-")), Busy);
        assert_eq!(classify_reply(None), Busy);
    }
}

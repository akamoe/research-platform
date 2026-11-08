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
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let mut reply = String::new();
    let asked = stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_ok();
    if asked && stream.read_to_string(&mut reply).is_ok() {
        if let Some((_, body)) = reply.split_once("\r\n\r\n") {
            if is_folio_health(body) {
                return PortState::Folio;
            }
        }
    }
    PortState::Other
}

/// The first of `count` ports from `first` that is Folio (reuse it: `true`) or free (start one: `false`).
pub fn choose_port(first: u16, count: u16, probe: impl Fn(u16) -> PortState) -> Option<(u16, bool)> {
    (first..first + count).find_map(|port| match probe(port) {
        PortState::Folio => Some((port, true)),
        PortState::Free => Some((port, false)),
        PortState::Other => None,
    })
}

#[cfg(test)]
mod tests {
    use super::PortState::*;
    use super::*;

    fn states(list: &'static [PortState]) -> impl Fn(u16) -> PortState {
        move |p| list.get((p - 5174) as usize).copied().unwrap_or(Other)
    }

    #[test]
    fn starts_on_the_first_port_when_free() {
        assert_eq!(choose_port(5174, 5, |_| Free), Some((5174, false)));
    }

    #[test]
    fn reuses_a_running_folio() {
        assert_eq!(choose_port(5174, 5, states(&[Folio])), Some((5174, true)));
    }

    #[test]
    fn skips_ports_other_apps_use() {
        assert_eq!(choose_port(5174, 5, states(&[Other, Free])), Some((5175, false)));
        assert_eq!(choose_port(5174, 5, states(&[Other, Folio])), Some((5175, true)));
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
}

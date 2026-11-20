//! Binary entry point: load config from the environment, refuse to start
//! without the Plane API key, bind loopback, serve.
//!
//! Environment:
//! - `PLANE_API_KEY` (required): the Plane API key (PAT). NEVER commit it,
//!   NEVER log it. It lives only in a mode-0600 env file on the Pi.
//! - `PLANE_API_URL` (default: the Plane issues endpoint for the `titer`
//!   workspace project): upstream Plane endpoint. Override ONLY for tests
//!   against a mock endpoint.
//! - `FEEDBACK_BIND` (default `127.0.0.1`): bind address. Loopback only in
//!   production — the service is reached through the Cloudflare tunnel.
//! - `FEEDBACK_PORT` (default `18098`): listen port.
//!
//! The service is stateless apart from a bounded in-memory dedupe set:
//! no database, no storage of feedback.

use std::net::SocketAddr;
use titer_feedback::{build_router, AppState, PlaneApiKey, DEFAULT_PLANE_API_URL};

fn fail(msg: &str) -> ! {
    eprintln!("titer-feedback: refusing to start: {msg}");
    std::process::exit(1);
}

#[tokio::main]
async fn main() {
    let api_key = std::env::var("PLANE_API_KEY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PlaneApiKey::new)
        .unwrap_or_else(|| fail("set PLANE_API_KEY"));
    let plane_url = std::env::var("PLANE_API_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PLANE_API_URL.to_string());
    let bind = std::env::var("FEEDBACK_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("FEEDBACK_PORT")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(18098);

    let state = match AppState::new(api_key, plane_url) {
        Ok(s) => s,
        Err(e) => fail(&format!("cannot build HTTP client: {e}")),
    };
    let addr: SocketAddr = format!("{bind}:{port}")
        .parse()
        .unwrap_or_else(|_| fail(&format!("invalid bind address {bind}:{port}")));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| fail(&format!("cannot bind {addr}: {e}")));
    eprintln!("titer-feedback: listening on {addr}");
    let app = build_router(state);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap_or_else(|e| fail(&format!("server error: {e}")));
}

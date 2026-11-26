//! Titer feedback server — first-party feedback endpoint for Titer.
//!
//! The desktop app can never hold the Plane API key (anything in the
//! binary can be extracted), so this tiny server holds it instead and
//! files each validated feedback report as a Plane issue.
//!
//! Service rules (SCOPE.md, "Server mode — design"):
//! - `POST /api/v1/feedback` validates a feedback report (the JSONL entry
//!   shape: `feedback_id`, `ts`, `kind`, `summary`, `details`, `context`)
//!   and creates a Plane issue. Returns `201 {feedback_id, issue_id,
//!   issue_url}`. Bad input -> `400`; Plane 5xx / unreachable -> `502`.
//! - Dedupe: bounded in-memory set of recent `feedback_id`s (1000 entries,
//!   24 h TTL) so a client retry after a timeout cannot double-create an
//!   issue. No database, no storage.
//! - Rate limit: per-IP token bucket (burst 10, refill 5/hour) + global
//!   cap 100/hour. Over the limit -> `429` + `Retry-After`.
//! - NEVER logs feedback text, summaries, or the Plane PAT. Logs carry
//!   only method / path / status / duration, plus rate-limit events and
//!   created issue ids.
//! - The Plane PAT is the only credential it holds.
//!
//! API contract (v1):
//! - `GET /health` -> `{"status":"ok"}` (no auth)
//! - `POST /api/v1/feedback` JSON `{"feedback_id","ts","kind","summary",
//!   "details","context"}` -> `201 {"feedback_id","issue_id","issue_url"}`.
//!   `kind` is one of `bug` | `missing-feature` | `other`; `summary` is
//!   1–200 chars, `details` 1–4000 chars, body at most 16 KB of JSON.
//!
//! Upstream: `POST {plane_url}` (30 s timeout), `X-API-Key` auth,
//! `Accept-Encoding: gzip`, `description_html` for the description, state
//! Backlog, priority none. Any non-2xx Plane reply is an upstream failure
//! (the request was already validated, so a Plane 4xx is a server-side
//! configuration problem, not a client error) -> `502`.

use axum::{
    body::Bytes,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Notify, OwnedNotified};

/// Default Plane issues endpoint (workspace `titer`, project id verified
/// against the live API — the `...585414ae000e` id in older notes is wrong
/// and 404s).
pub const DEFAULT_PLANE_API_URL: &str = "https://plane.smitpatel.net/api/v1/workspaces/titer/projects/a0d96c9d-ab8c-4147-96f6-8f3741cae1d3/issues/";
/// Plane project id (used to build the public issue URL).
pub const PLANE_PROJECT_ID: &str = "a0d96c9d-ab8c-4147-96f6-8f3741cae1d3";
/// Plane state id for Backlog.
pub const PLANE_STATE_BACKLOG: &str = "d91ecc30-bac7-4bc3-9b59-a84a50344d90";
/// Upstream Plane call timeout (task contract).
pub const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);
/// Maximum request body: 16 KB of JSON.
pub const MAX_BODY_BYTES: usize = 16 * 1024;
/// Per-IP rate limit: bucket capacity (burst).
pub const RATE_BURST: f64 = 10.0;
/// Per-IP rate limit: refill, requests per hour.
pub const RATE_REFILL_PER_HOUR: f64 = 5.0;
/// Global rate limit: bucket capacity (burst).
pub const GLOBAL_BURST: f64 = 100.0;
/// Global rate limit: refill, requests per hour.
pub const GLOBAL_REFILL_PER_HOUR: f64 = 100.0;
/// Dedupe set: maximum entries kept.
pub const DEDUPE_CAPACITY: usize = 1000;
/// Rate limiter: maximum per-IP buckets kept. A bucket idle long enough
/// to refill fully is evicted on sight (it is indistinguishable from a
/// fresh bucket); the cap bounds bursts of distinct IPs inside that
/// window by evicting the least-recently-seen bucket.
pub const MAX_PER_IP_BUCKETS: usize = 10_000;
/// A per-IP bucket idle this long has refilled to full
/// (`RATE_BURST / RATE_REFILL_PER_HOUR` hours), so evicting it changes
/// no admission decision.
const PER_IP_IDLE_EVICT: Duration =
    Duration::from_secs((RATE_BURST / RATE_REFILL_PER_HOUR * 3600.0) as u64);
/// Dedupe set: how long an entry lives.
pub const DEDUPE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// Validation caps (mirror the `titer_send_feedback` client caps).
pub const MAX_SUMMARY_CHARS: usize = 200;
pub const MAX_DETAILS_CHARS: usize = 4000;
pub const MAX_FEEDBACK_ID_CHARS: usize = 128;

/// A Plane API key that can never be printed by accident: Debug is
/// redacted, and there is no Display impl. The only place the inner value
/// is used is the `X-API-Key` header sent to Plane over TLS.
#[derive(Clone)]
pub struct PlaneApiKey(String);

impl PlaneApiKey {
    pub fn new(value: String) -> Self {
        Self(value)
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for PlaneApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlaneApiKey([redacted])")
    }
}

/// One captured log line. The logger only ever receives lines built by
/// the call sites below; no feedback text, summary, or API key is ever
/// passed to it.
pub type LogSink = Arc<dyn Fn(String) + Send + Sync>;

fn stderr_sink() -> LogSink {
    Arc::new(|line: String| eprintln!("{line}"))
}

/// Shared application state. Stateless apart from the rate limiter and
/// the bounded dedupe set — no database, no storage of feedback.
#[derive(Clone)]
pub struct AppState {
    pub api_key: PlaneApiKey,
    pub plane_url: String,
    pub http: reqwest::Client,
    pub limiter: Arc<RateLimiter>,
    pub dedupe: Arc<DedupeSet>,
    pub log: LogSink,
}

impl AppState {
    pub fn new(api_key: PlaneApiKey, plane_url: String) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(UPSTREAM_TIMEOUT)
            .build()?;
        Ok(Self {
            api_key,
            plane_url,
            http,
            limiter: Arc::new(RateLimiter::new()),
            dedupe: Arc::new(DedupeSet::new()),
            log: stderr_sink(),
        })
    }

    /// Test hook: swap the log sink for a capturing one.
    pub fn with_log_sink(mut self, sink: LogSink) -> Self {
        self.log = sink;
        self
    }

    fn log(&self, line: String) {
        (self.log)(line);
    }
}

// ── Rate limiter ──────────────────────────────────────────────────────────

/// Per-IP token bucket (burst [`RATE_BURST`], refilled at
/// [`RATE_REFILL_PER_HOUR`] per hour) plus a global bucket (burst
/// [`GLOBAL_BURST`], refilled at [`GLOBAL_REFILL_PER_HOUR`] per hour).
/// `check` returns `Ok(())` when a token was consumed from both buckets,
/// or `Err(retry_after_secs)` when either bucket is empty.
pub struct RateLimiter {
    inner: Mutex<LimiterInner>,
}

struct LimiterInner {
    per_ip: HashMap<IpAddr, Bucket>,
    global: Bucket,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl Bucket {
    fn new(capacity: f64) -> Self {
        Self {
            tokens: capacity,
            last: Instant::now(),
        }
    }

    /// Token count after refilling up to `now`, without mutating.
    fn refilled_tokens(&self, capacity: f64, refill_per_hour: f64, now: Instant) -> f64 {
        let elapsed_h = now.duration_since(self.last).as_secs_f64() / 3600.0;
        (self.tokens + elapsed_h * refill_per_hour).min(capacity)
    }

    /// Non-consuming check: would one token be available right now?
    /// Returns `Ok(())`, or the seconds until the next whole token
    /// refills. Used to peek at both buckets before spending either,
    /// so a request rejected by one bucket burns no token from the
    /// other.
    fn peek_take(&self, capacity: f64, refill_per_hour: f64, now: Instant) -> Result<(), u64> {
        let tokens = self.refilled_tokens(capacity, refill_per_hour, now);
        if tokens >= 1.0 {
            Ok(())
        } else {
            let wait = ((1.0 - tokens) / refill_per_hour * 3600.0).ceil() as u64;
            Err(wait.max(1))
        }
    }

    /// Refill and try to consume one token. Returns `Ok(())`, or the
    /// seconds until the next whole token refills.
    fn try_take(&mut self, capacity: f64, refill_per_hour: f64, now: Instant) -> Result<(), u64> {
        self.tokens = self.refilled_tokens(capacity, refill_per_hour, now);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            let wait = ((1.0 - self.tokens) / refill_per_hour * 3600.0).ceil() as u64;
            Err(wait.max(1))
        }
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LimiterInner {
                per_ip: HashMap::new(),
                global: Bucket::new(GLOBAL_BURST),
            }),
        }
    }

    /// Admit a request only when BOTH buckets have a token, and spend
    /// from neither when either refuses. Both buckets are peeked
    /// (non-consuming) first, then both take one token: a request
    /// rejected by the per-IP bucket spends no global token, so a
    /// single blocked IP cannot drain the shared budget, and a request
    /// rejected by the global bucket spends no per-IP token either.
    /// A missing per-IP bucket is full, and no bucket is created for
    /// a rejected request.
    pub fn check(&self, ip: IpAddr) -> Result<(), u64> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        // Evict idle buckets first: one idle long enough to have
        // refilled to full is indistinguishable from a fresh bucket,
        // so dropping it changes no admission decision and keeps the
        // map bounded against distinct-IP scans.
        inner
            .per_ip
            .retain(|_, b| now.duration_since(b.last) < PER_IP_IDLE_EVICT);
        // Peek at the per-IP bucket before spending anything.
        if let Some(bucket) = inner.per_ip.get(&ip) {
            if let Err(wait) = bucket.peek_take(RATE_BURST, RATE_REFILL_PER_HOUR, now) {
                return Err(wait);
            }
        }
        // Then peek at the global bucket: a globally-capped request
        // must not burn a per-IP token either.
        if let Err(wait) = inner
            .global
            .peek_take(GLOBAL_BURST, GLOBAL_REFILL_PER_HOUR, now)
        {
            return Err(wait);
        }
        // Both buckets admit the request: consume one token from each.
        // Both peeks just passed under this lock, so neither take can
        // fail.
        let _ = inner
            .global
            .try_take(GLOBAL_BURST, GLOBAL_REFILL_PER_HOUR, now);
        // Enforce the hard cap before inserting a new per-IP bucket:
        // evict the least-recently-seen bucket so the map stays
        // bounded even under a burst of distinct IPs inside the idle
        // window.
        if !inner.per_ip.contains_key(&ip) && inner.per_ip.len() >= MAX_PER_IP_BUCKETS {
            if let Some(oldest) = inner
                .per_ip
                .iter()
                .min_by_key(|(_, b)| b.last)
                .map(|(k, _)| *k)
            {
                inner.per_ip.remove(&oldest);
            }
        }
        let bucket = inner
            .per_ip
            .entry(ip)
            .or_insert_with(|| Bucket::new(RATE_BURST));
        let _ = bucket.try_take(RATE_BURST, RATE_REFILL_PER_HOUR, now);
        Ok(())
    }
}

/// The client IP for rate limiting. The service sits behind a Cloudflare
/// tunnel, so the socket peer is always the tunnel on localhost; in that
/// case — and only that case — the `CF-Connecting-IP` header carries the
/// real client IP. A remote caller cannot spoof its way around the limiter
/// with that header, because a non-loopback peer never gets the header
/// trusted.
pub fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    if peer.ip().is_loopback() {
        if let Some(v) = headers.get("cf-connecting-ip") {
            if let Ok(s) = v.to_str() {
                if let Ok(ip) = s.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
    }
    peer.ip()
}

// ── Dedupe set ────────────────────────────────────────────────────────────

/// Outcome of claiming a `feedback_id` for creation.
pub enum Claim {
    /// Already filed within the TTL: the stored issue id + URL.
    Done((String, String)),
    /// Another request is creating this issue right now. The boxed
    /// `OwnedNotified` future was created from the leader's notifier
    /// AND registered (via `enable()`) while the set's lock was held,
    /// so the leader's completion notification cannot be missed:
    /// await it, then re-claim.
    InFlight(Pin<Box<OwnedNotified>>),
    /// This caller owns creation. The guard releases the in-flight
    /// slot (and wakes waiters) when dropped, so a cancelled leader —
    /// e.g. hyper dropping the handler future on client disconnect
    /// mid `create_plane_issue` — can never leak the slot. Call
    /// [`DedupeSet::complete`] on success or [`DedupeSet::abandon`]
    /// on failure; the guard's `Drop` is idempotent with both.
    Claimed(InFlightGuard),
}

/// Bounded set of recently seen `feedback_id`s, each remembering the
/// Plane issue it created so a client retry returns the same `201`
/// without creating a second issue. It also tracks in-flight ids —
/// claimed before the upstream call and released when it resolves —
/// so concurrent retries of one id serialize on a single issue
/// instead of each creating their own.
///
/// `seen` and `in_flight` live under ONE lock: checking the filed set
/// and claiming the in-flight slot is a single atomic step, so no
/// interleaving can let two concurrent same-id requests both pass
/// (the old two-mutex split let a claim whose `seen` check ran before
/// a completion and whose `in_flight` check ran after it slip through
/// and double-create).
pub struct DedupeSet {
    inner: Mutex<DedupeState>,
}

struct DedupeState {
    seen: HashMap<String, DedupeEntry>,
    in_flight: HashMap<String, Arc<Notify>>,
}

pub struct DedupeEntry {
    pub issue_id: String,
    pub issue_url: String,
    pub inserted: Instant,
}

/// RAII guard for an in-flight claim: dropping it releases the slot.
/// The stored `Notify` identifies the slot this guard owns, so the
/// release is a no-op if the leader already completed/abandoned and a
/// new request re-claimed the id in the meantime.
pub struct InFlightGuard {
    dedupe: Arc<DedupeSet>,
    feedback_id: String,
    notify: Arc<Notify>,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.dedupe.release_if_mine(&self.feedback_id, &self.notify);
    }
}

impl DedupeSet {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(DedupeState {
                seen: HashMap::new(),
                in_flight: HashMap::new(),
            }),
        }
    }

    /// Atomically claim a `feedback_id`: the stored issue when already
    /// filed, the in-flight wait future when another request is
    /// creating it, or `Claimed` when this caller owns creation. The
    /// whole check runs under the single set lock, and the waiter's
    /// `OwnedNotified` is created and `enable()`d before that lock is
    /// released — a completion cannot fire in between, so the wakeup
    /// cannot be lost.
    pub fn claim(self: &Arc<Self>, feedback_id: &str) -> Claim {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        match state.seen.get(feedback_id) {
            Some(entry) if now.duration_since(entry.inserted) < DEDUPE_TTL => {
                return Claim::Done((entry.issue_id.clone(), entry.issue_url.clone()));
            }
            Some(_) => {
                state.seen.remove(feedback_id);
            }
            None => {}
        }
        if let Some(notify) = state.in_flight.get(feedback_id) {
            // Register the waiter BEFORE releasing the lock: the
            // future is created from the leader's notifier and
            // enable()d while the leader still cannot complete
            // (completion needs this lock), so notify_waiters() can
            // never fire with no waiter registered.
            let mut notified = Box::pin(notify.clone().notified_owned());
            let _ = notified.as_mut().enable();
            return Claim::InFlight(notified);
        }
        let notify = Arc::new(Notify::new());
        state
            .in_flight
            .insert(feedback_id.to_string(), notify.clone());
        Claim::Claimed(InFlightGuard {
            dedupe: Arc::clone(self),
            feedback_id: feedback_id.to_string(),
            notify,
        })
    }

    /// Record a completed creation and wake any waiters, so they
    /// re-claim and get the stored issue.
    pub fn complete(&self, feedback_id: &str, issue_id: String, issue_url: String) {
        let notify = {
            let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            Self::insert_locked(&mut state, feedback_id.to_string(), issue_id, issue_url);
            state.in_flight.remove(feedback_id)
        };
        if let Some(notify) = notify {
            notify.notify_waiters();
        }
    }

    /// Release a failed creation without recording it, waking waiters
    /// so a retry can claim the id for itself.
    pub fn abandon(&self, feedback_id: &str) {
        let notify = {
            let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            state.in_flight.remove(feedback_id)
        };
        if let Some(notify) = notify {
            notify.notify_waiters();
        }
    }

    /// Guard `Drop` path: release the slot ONLY if this guard's
    /// `Notify` is still the registered one. If the leader already
    /// completed or abandoned and a new request re-claimed the id,
    /// the stored notifier differs and the new owner's slot is left
    /// alone.
    fn release_if_mine(&self, feedback_id: &str, notify: &Arc<Notify>) {
        let removed = {
            let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let mine = state
                .in_flight
                .get(feedback_id)
                .map(|current| Arc::ptr_eq(current, notify))
                .unwrap_or(false);
            if mine {
                state.in_flight.remove(feedback_id)
            } else {
                None
            }
        };
        if let Some(notify) = removed {
            notify.notify_waiters();
        }
    }

    /// Look up a `feedback_id`. Returns the stored issue id + URL when
    /// the id was seen within the TTL, else `None`. Expired entries are
    /// dropped on sight.
    pub fn get(&self, feedback_id: &str) -> Option<(String, String)> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        match state.seen.get(feedback_id) {
            Some(entry) if now.duration_since(entry.inserted) < DEDUPE_TTL => {
                Some((entry.issue_id.clone(), entry.issue_url.clone()))
            }
            Some(_) => {
                state.seen.remove(feedback_id);
                None
            }
            None => None,
        }
    }

    /// Record a `feedback_id` → issue mapping. Evicts expired entries
    /// first; if still at capacity, evicts the oldest entry so the set
    /// stays bounded.
    pub fn insert(&self, feedback_id: String, issue_id: String, issue_url: String) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        Self::insert_locked(&mut state, feedback_id, issue_id, issue_url);
    }

    fn insert_locked(
        state: &mut DedupeState,
        feedback_id: String,
        issue_id: String,
        issue_url: String,
    ) {
        let now = Instant::now();
        state
            .seen
            .retain(|_, e| now.duration_since(e.inserted) < DEDUPE_TTL);
        if state.seen.len() >= DEDUPE_CAPACITY && !state.seen.contains_key(&feedback_id) {
            if let Some(oldest) = state
                .seen
                .iter()
                .min_by_key(|(_, e)| e.inserted)
                .map(|(k, _)| k.clone())
            {
                state.seen.remove(&oldest);
            }
        }
        state.seen.insert(
            feedback_id,
            DedupeEntry {
                issue_id,
                issue_url,
                inserted: now,
            },
        );
    }
}

// ── Request / response shapes ─────────────────────────────────────────────

/// One feedback report, the JSONL entry shape `titer_send_feedback`
/// writes. `context` defaults to an empty object when absent.
#[derive(Deserialize)]
pub struct FeedbackRequest {
    pub feedback_id: String,
    pub ts: u64,
    pub kind: String,
    pub summary: String,
    pub details: String,
    #[serde(default)]
    pub context: serde_json::Value,
}

#[derive(Serialize)]
pub struct FeedbackResponse {
    pub feedback_id: String,
    pub issue_id: String,
    pub issue_url: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Deserialize)]
struct PlaneIssueResponse {
    #[serde(default)]
    id: Option<String>,
}

fn bad_request(code: &str) -> (StatusCode, Json<ErrorBody>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorBody {
            error: code.to_string(),
        }),
    )
}

fn bad_gateway() -> (StatusCode, Json<ErrorBody>) {
    (
        StatusCode::BAD_GATEWAY,
        Json(ErrorBody {
            error: "upstream_error".to_string(),
        }),
    )
}

/// Escape user text for embedding in Plane `description_html`. The
/// summary also goes into the issue title, which is plain text, so it
/// needs no escaping there — but it is escaped wherever it lands in HTML.
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Validate the context value: it must be a JSON object (or null, treated
/// as empty), whose leaves are JSON scalars only, nested at most 4 deep.
/// The shipped client sends an object of string fields plus a
/// `recent_activity` array of small objects (tool names, unix times, ok
/// flags) — scalars all the way down — so this admits the real client
/// shape while rejecting blobs and arbitrary nested documents.
fn validate_context(value: &serde_json::Value, depth: usize) -> Result<(), &'static str> {
    match value {
        serde_json::Value::Null => Ok(()),
        serde_json::Value::Bool(_) | serde_json::Value::Number(_) | serde_json::Value::String(_) => Ok(()),
        serde_json::Value::Array(items) => {
            if depth >= 4 {
                return Err("invalid_context");
            }
            for item in items {
                validate_context(item, depth + 1)?;
            }
            Ok(())
        }
        serde_json::Value::Object(map) => {
            if depth >= 4 {
                return Err("invalid_context");
            }
            for v in map.values() {
                validate_context(v, depth + 1)?;
            }
            Ok(())
        }
    }
}

/// Validate a parsed feedback report. Returns the error code for a `400`,
/// or `Ok(())`. Char counts (not bytes) mirror the client caps.
pub fn validate_feedback(req: &FeedbackRequest) -> Result<(), &'static str> {
    if req.feedback_id.trim().is_empty()
        || req.feedback_id.chars().count() > MAX_FEEDBACK_ID_CHARS
    {
        return Err("invalid_feedback_id");
    }
    if !matches!(req.kind.as_str(), "bug" | "missing-feature" | "other") {
        return Err("invalid_kind");
    }
    let summary_len = req.summary.chars().count();
    if summary_len < 1 || summary_len > MAX_SUMMARY_CHARS {
        return Err("invalid_summary");
    }
    let details_len = req.details.chars().count();
    if details_len < 1 || details_len > MAX_DETAILS_CHARS {
        return Err("invalid_details");
    }
    match &req.context {
        serde_json::Value::Null => Ok(()),
        serde_json::Value::Object(_) => validate_context(&req.context, 0),
        _ => Err("invalid_context"),
    }
}

/// The public Plane issue URL for an issue id. Derived from the API URL
/// by stripping everything from `/api/` on, so the mock-Plane test hook
/// yields a mock-host URL and production yields plane.smitpatel.net.
pub fn issue_url_for(plane_url: &str, issue_id: &str) -> String {
    let base = plane_url.split("/api/").next().unwrap_or(plane_url);
    let base = base.trim_end_matches('/');
    format!("{base}/titer/projects/{PLANE_PROJECT_ID}/issues/{issue_id}")
}

/// Build the Plane `description_html` for a validated report. Every bit
/// of user text is HTML-escaped first; the received time is the report's
/// own `ts`, and the source line marks the server flow.
fn description_html(req: &FeedbackRequest) -> String {
    let context = match &req.context {
        serde_json::Value::Null => "{}".to_string(),
        v => serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()),
    };
    format!(
        "<p><strong>Kind:</strong> {}</p>\
         <p><strong>Summary:</strong> {}</p>\
         <p><strong>Details:</strong></p><p>{}</p>\
         <p><strong>Context:</strong></p><p>{}</p>\
         <p><em>Received: {} (unix time) &middot; Source: titer_send_feedback server</em></p>",
        escape_html(&req.kind),
        escape_html(&req.summary),
        escape_html(&req.details),
        escape_html(&context),
        req.ts,
    )
}

/// Create the Plane issue for a validated report. Returns the issue id.
/// Any non-2xx Plane reply, or an unreachable Plane, is a gateway
/// failure. The response body is never logged; only the status is.
async fn create_plane_issue(
    state: &AppState,
    req: &FeedbackRequest,
) -> Result<String, (StatusCode, Json<ErrorBody>)> {
    let body = serde_json::json!({
        "name": format!("[feedback] {}", req.summary),
        "description_html": description_html(req),
        "state": PLANE_STATE_BACKLOG,
        "priority": "none",
    });
    let resp = state
        .http
        .post(&state.plane_url)
        .header("X-API-Key", state.api_key.expose())
        .header("Accept-Encoding", "gzip")
        .json(&body)
        .send()
        .await
        .map_err(|_| bad_gateway())?;
    let status = resp.status();
    if status.is_success() {
        let parsed: PlaneIssueResponse = resp.json().await.map_err(|_| bad_gateway())?;
        parsed.id.ok_or_else(bad_gateway)
    } else {
        state.log(format!(
            "plane_error status={} path=/api/v1/feedback",
            status.as_u16()
        ));
        Err(bad_gateway())
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn submit_feedback(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let ip = client_ip(&headers, peer);
    if let Err(retry_after) = state.limiter.check(ip) {
        state.log(format!(
            "rate_limited method=POST path=/api/v1/feedback ip={ip} retry_after={retry_after}"
        ));
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, retry_after.to_string())],
            Json(ErrorBody {
                error: "rate_limited".to_string(),
            }),
        )
            .into_response();
    }
    if body.len() > MAX_BODY_BYTES {
        return bad_request("body_too_large").into_response();
    }
    let req: FeedbackRequest = match serde_json::from_slice(&body) {
        Ok(req) => req,
        Err(_) => return bad_request("invalid_json").into_response(),
    };
    if let Err(code) = validate_feedback(&req) {
        return bad_request(code).into_response();
    }
    // A retry of an already-filed report returns the original issue —
    // never a second one. (Checked after validation so a malformed retry
    // still gets its 400.) The id is claimed in the in_flight set
    // BEFORE awaiting Plane, so a concurrent retry of the same id waits
    // for this request's issue instead of creating a second one.
    let mut waits = 0u8;
    // The leader's guard: bound here so it lives across the upstream
    // await below. If this handler future is dropped first — hyper
    // cancelling it on client disconnect — the guard's Drop releases
    // the in-flight slot instead of leaking it.
    let mut _leader_guard = None;
    loop {
        match state.dedupe.claim(&req.feedback_id) {
            Claim::Done((issue_id, issue_url)) => {
                state.log(format!(
                    "feedback_duplicate issue_id={issue_id} path=/api/v1/feedback"
                ));
                return (
                    StatusCode::CREATED,
                    Json(FeedbackResponse {
                        feedback_id: req.feedback_id,
                        issue_id,
                        issue_url,
                    }),
                )
                    .into_response();
            }
            Claim::InFlight(notified) => {
                // Another request is creating this issue; wait for it,
                // then re-claim. The wait future was registered under
                // the set lock, so the completion cannot be missed.
                // Bounded: the owner's upstream call times out at
                // UPSTREAM_TIMEOUT, so one window covers it; after a
                // few chained hand-offs the retry is told the upstream
                // failed rather than waiting forever.
                waits += 1;
                if waits > 4 {
                    return bad_gateway().into_response();
                }
                let _ =
                    tokio::time::timeout(UPSTREAM_TIMEOUT + Duration::from_secs(5), notified).await;
            }
            Claim::Claimed(guard) => {
                _leader_guard = Some(guard);
                break;
            }
        }
    }
    match create_plane_issue(&state, &req).await {
        Ok(issue_id) => {
            let issue_url = issue_url_for(&state.plane_url, &issue_id);
            state.dedupe.complete(
                &req.feedback_id,
                issue_id.clone(),
                issue_url.clone(),
            );
            state.log(format!(
                "feedback_created issue_id={issue_id} path=/api/v1/feedback"
            ));
            (
                StatusCode::CREATED,
                Json(FeedbackResponse {
                    feedback_id: req.feedback_id,
                    issue_id,
                    issue_url,
                }),
            )
                .into_response()
        }
        Err(e) => {
            // Release the in-flight claim so a retry can claim the id
            // for itself instead of waiting on a failed creation.
            state.dedupe.abandon(&req.feedback_id);
            e.into_response()
        }
    }
}

/// Access log middleware. Logs method, path, status, and duration only —
/// never headers, bodies, summaries, or feedback text.
async fn access_log(
    State(state): State<AppState>,
    req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();
    let resp = next.run(req).await;
    let elapsed_ms = start.elapsed().as_millis();
    state.log(format!(
        "method={method} path={path} status={} duration_ms={elapsed_ms}",
        resp.status().as_u16()
    ));
    resp
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/feedback", post(submit_feedback))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            access_log,
        ))
        .with_state(state)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;
    use tower::ServiceExt;

    /// Captured log lines for the never-logs-feedback-text test.
    #[derive(Default)]
    struct CapturedLogs(Mutex<Vec<String>>);

    fn capturing_sink(logs: Arc<CapturedLogs>) -> LogSink {
        Arc::new(move |line: String| {
            logs.0.lock().unwrap().push(line);
        })
    }

    /// A mock Plane issues endpoint. Behaviour is driven by the `summary`
    /// value so each test gets the upstream reply it needs:
    /// - "plane-500" -> 500 `{"detail":"boom"}`
    /// - anything else -> 201 with a sentinel issue id.
    /// The mock asserts the request actually carries `X-API-Key`, the
    /// gzip encoding header, the trailing slash, the `[feedback] ` title
    /// prefix, the Backlog state, priority none, and — for the escaped
    /// sentinel — that `description_html` carries the HTML-escaped text.
    /// Returns the mock's base URL; the issues URL is
    /// `{base}/api/v1/workspaces/titer/projects/{PLANE_PROJECT_ID}/issues/`.
    /// The `calls` counter records how many issues the mock created.
    async fn mock_plane_server(
        calls: Arc<AtomicUsize>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        async fn create_issue(
            headers: HeaderMap,
            axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
        ) -> (StatusCode, Json<serde_json::Value>) {
            assert_eq!(
                headers.get("x-api-key").and_then(|v| v.to_str().ok()),
                Some("TEST_PLANE_API_KEY"),
                "Plane call must carry X-API-Key"
            );
            assert!(
                headers
                    .get("accept-encoding")
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.contains("gzip"))
                    .unwrap_or(false),
                "Plane call must ask for gzip"
            );
            let name = body["name"].as_str().unwrap_or("");
            assert!(
                name.starts_with("[feedback] "),
                "title must carry the [feedback] prefix: {name}"
            );
            assert_eq!(
                body["state"].as_str(),
                Some(PLANE_STATE_BACKLOG),
                "state must be Backlog"
            );
            assert_eq!(
                body["priority"].as_str(),
                Some("none"),
                "priority must be none"
            );
            let desc = body["description_html"].as_str().unwrap_or("");
            assert!(
                desc.contains("titer_send_feedback server"),
                "description must carry the source line"
            );
            match name {
                "[feedback] plane-500" => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"detail": "boom"})),
                ),
                "[feedback] slow-plane" => {
                    // Deliberately slow upstream (500 ms): concurrent
                    // retries of the same id must serialize on the
                    // in-flight claim, not double-create.
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    (
                        StatusCode::CREATED,
                        Json(serde_json::json!({
                            "id": "ISSUE-ID-SENTINEL-8d2f",
                            "name": name,
                        })),
                    )
                }
                "[feedback] escape-me <script>alert(1)</script>" => {
                    assert!(
                        desc.contains("&lt;script&gt;alert(1)&lt;/script&gt;"),
                        "description_html must HTML-escape user text: {desc}"
                    );
                    assert!(
                        !desc.contains("<script>"),
                        "raw user markup must not survive into description_html"
                    );
                    (
                        StatusCode::CREATED,
                        Json(serde_json::json!({
                            "id": "ISSUE-ID-SENTINEL-8d2f",
                            "name": name,
                        })),
                    )
                }
                _ => (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "id": "ISSUE-ID-SENTINEL-8d2f",
                        "name": name,
                    })),
                ),
            }
        }
        let app = Router::new().route(
            &format!("/api/v1/workspaces/titer/projects/{PLANE_PROJECT_ID}/issues/"),
            post({
                let calls = calls.clone();
                move |headers: HeaderMap, body: axum::extract::Json<serde_json::Value>| {
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        create_issue(headers, body).await
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}"), handle)
    }

    fn test_state(base_url: String) -> (AppState, Arc<CapturedLogs>, Arc<AtomicUsize>) {
        let logs = Arc::new(CapturedLogs::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let state = AppState::new(
            PlaneApiKey::new("TEST_PLANE_API_KEY".to_string()),
            format!("{base_url}/api/v1/workspaces/titer/projects/{PLANE_PROJECT_ID}/issues/"),
        )
        .unwrap()
        .with_log_sink(capturing_sink(logs.clone()));
        (state, logs, calls)
    }

    /// Serve the app on an ephemeral loopback port with ConnectInfo, like
    /// production, so rate limiting sees a real peer IP.
    async fn serve_app(state: AppState) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let app = build_router(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        (addr, handle)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::new()
    }

    fn feedback_payload(feedback_id: &str, summary: &str) -> serde_json::Value {
        serde_json::json!({
            "feedback_id": feedback_id,
            "ts": 1793000000u64,
            "kind": "bug",
            "summary": summary,
            "details": "Tried X, saw Y, expected Z.",
            "context": {
                "app_version": "1.7.3",
                "os": "macos",
                "recent_activity": [
                    {"tool": "titer_create_table", "ts": 1792999900u64, "ok": true}
                ]
            },
        })
    }

    async fn post_feedback(
        addr: SocketAddr,
        payload: &serde_json::Value,
    ) -> reqwest::Response {
        client()
            .post(format!("http://{addr}/api/v1/feedback"))
            .json(payload)
            .send()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn health() {
        let (base, mock) = mock_plane_server(Arc::new(AtomicUsize::new(0))).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let h: serde_json::Value = client()
            .get(format!("http://{addr}/health"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(h["status"], "ok");
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn happy_path_creates_plane_issue_with_escaped_html() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let resp = post_feedback(
            addr,
            &feedback_payload("fb-1", "escape-me <script>alert(1)</script>"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["feedback_id"], "fb-1");
        assert_eq!(body["issue_id"], "ISSUE-ID-SENTINEL-8d2f");
        assert!(
            body["issue_url"]
                .as_str()
                .unwrap()
                .ends_with(&format!("/issues/ISSUE-ID-SENTINEL-8d2f")),
            "issue_url must point at the created issue: {}",
            body["issue_url"]
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1, "exactly one Plane issue");
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn validation_failures_are_400_without_upstream() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let mut cases: Vec<(String, serde_json::Value)> = vec![
            (
                "bad kind".to_string(),
                serde_json::json!({"feedback_id": "fb-bad-kind", "ts": 1u64, "kind": "wish", "summary": "s", "details": "d", "context": {}}),
            ),
            (
                "empty summary".to_string(),
                serde_json::json!({"feedback_id": "fb-empty-summary", "ts": 1u64, "kind": "bug", "summary": "", "details": "d", "context": {}}),
            ),
            (
                "summary 201 chars".to_string(),
                serde_json::json!({"feedback_id": "fb-long-summary", "ts": 1u64, "kind": "bug", "summary": "x".repeat(201), "details": "d", "context": {}}),
            ),
            (
                "empty details".to_string(),
                serde_json::json!({"feedback_id": "fb-empty-details", "ts": 1u64, "kind": "bug", "summary": "s", "details": "", "context": {}}),
            ),
            (
                "details 4001 chars".to_string(),
                serde_json::json!({"feedback_id": "fb-long-details", "ts": 1u64, "kind": "bug", "summary": "s", "details": "x".repeat(4001), "context": {}}),
            ),
            (
                "empty feedback_id".to_string(),
                serde_json::json!({"feedback_id": "", "ts": 1u64, "kind": "bug", "summary": "s", "details": "d", "context": {}}),
            ),
            (
                "context is an array".to_string(),
                serde_json::json!({"feedback_id": "fb-ctx-array", "ts": 1u64, "kind": "bug", "summary": "s", "details": "d", "context": ["nope"]}),
            ),
            (
                "missing summary".to_string(),
                serde_json::json!({"feedback_id": "fb-no-summary", "ts": 1u64, "kind": "bug", "details": "d", "context": {}}),
            ),
        ];
        // Oversize body: details long enough to push past 16 KB.
        cases.push((
            "body over 16 KB".to_string(),
            serde_json::json!({"feedback_id": "fb-huge", "ts": 1u64, "kind": "bug", "summary": "s", "details": "x".repeat(17 * 1024), "context": {}}),
        ));
        for (name, payload) in cases {
            let resp = post_feedback(addr, &payload).await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{name}");
            let body: serde_json::Value = resp.json().await.unwrap();
            assert!(body.get("error").is_some(), "{name}: error code expected");
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "no invalid report may reach Plane"
        );
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn boundary_lengths_are_accepted() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let resp = post_feedback(
            addr,
            &serde_json::json!({
                "feedback_id": "fb-boundary",
                "ts": 1u64,
                "kind": "missing-feature",
                "summary": "x".repeat(200),
                "details": "x".repeat(4000),
                "context": {},
            }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn plane_5xx_maps_to_502() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let resp = post_feedback(addr, &feedback_payload("fb-5xx", "plane-500")).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn plane_unreachable_maps_to_502() {
        // Point at a closed loopback port: nothing listens there.
        let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dead = probe.local_addr().unwrap();
        drop(probe);
        let (state, _, _) = test_state(format!("http://{dead}"));
        let (addr, server) = serve_app(state).await;
        let resp = post_feedback(addr, &feedback_payload("fb-dead", "anything")).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        server.abort();
    }

    #[tokio::test]
    async fn rate_limit_429_with_retry_after_and_per_ip_isolation() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let c = client();
        // Per-IP burst is 10: the first 10 calls from one IP succeed, the
        // 11th is 429. (The test peer is loopback, exactly like the tunnel
        // in production, so CF-Connecting-IP is trusted.)
        let mut saw_429 = false;
        for i in 0..15 {
            let resp = c
                .post(format!("http://{addr}/api/v1/feedback"))
                .header("cf-connecting-ip", "203.0.113.7")
                .json(&feedback_payload(&format!("fb-rl-{i}"), "rate limit probe"))
                .send()
                .await
                .unwrap();
            if resp.status() == StatusCode::TOO_MANY_REQUESTS {
                saw_429 = true;
                assert!(
                    resp.headers().contains_key(axum::http::header::RETRY_AFTER),
                    "429 must carry Retry-After"
                );
                let body: serde_json::Value = resp.json().await.unwrap();
                assert_eq!(body["error"], "rate_limited");
                break;
            }
            assert_eq!(resp.status(), StatusCode::CREATED, "call {i} should succeed");
        }
        assert!(saw_429, "expected a 429 within 15 calls from one IP");
        // A different client IP still has its own full bucket.
        let resp = c
            .post(format!("http://{addr}/api/v1/feedback"))
            .header("cf-connecting-ip", "198.51.100.9")
            .json(&feedback_payload("fb-rl-other-ip", "other ip probe"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn global_cap_100_per_hour() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let c = client();
        // 10 distinct IPs x 10 calls each = the 100/hour global budget.
        for ip in 0..10 {
            for j in 0..10 {
                let resp = c
                    .post(format!("http://{addr}/api/v1/feedback"))
                    .header("cf-connecting-ip", format!("203.0.113.{ip}"))
                    .json(&feedback_payload(
                        &format!("fb-g-{ip}-{j}"),
                        "global cap probe",
                    ))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(
                    resp.status(),
                    StatusCode::CREATED,
                    "ip {ip} call {j} should succeed"
                );
            }
        }
        assert_eq!(calls.load(Ordering::SeqCst), 100);
        // The 101st call, from a fresh IP with a full per-IP bucket, is
        // still capped by the global bucket.
        let resp = c
            .post(format!("http://{addr}/api/v1/feedback"))
            .header("cf-connecting-ip", "198.51.100.99")
            .json(&feedback_payload("fb-g-101", "global cap probe"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(resp.headers().contains_key(axum::http::header::RETRY_AFTER));
        assert_eq!(calls.load(Ordering::SeqCst), 100, "capped call never reaches Plane");
        server.abort();
        mock.abort();
    }

    #[tokio::test]
    async fn dedupe_same_feedback_id_creates_one_issue() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let payload = feedback_payload("fb-dup-1", "retry me");
        let first = post_feedback(addr, &payload).await;
        assert_eq!(first.status(), StatusCode::CREATED);
        let first_body: serde_json::Value = first.json().await.unwrap();
        let second = post_feedback(addr, &payload).await;
        assert_eq!(second.status(), StatusCode::CREATED);
        let second_body: serde_json::Value = second.json().await.unwrap();
        assert_eq!(second_body["issue_id"], first_body["issue_id"]);
        assert_eq!(second_body["issue_url"], first_body["issue_url"]);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "a retry must not create a second Plane issue"
        );
        server.abort();
        mock.abort();
    }

    /// R2-8 pin: a per-IP-blocked attacker must not drain the shared
    /// global bucket. Fails on the old `check` (global token spent
    /// before the per-IP check, never refunded): 10 admitted calls +
    /// 90 per-IP-rejected calls spend all 100 global tokens, so the
    /// fresh IP is capped too.
    #[test]
    fn per_ip_rejections_do_not_spend_global_tokens() {
        let limiter = RateLimiter::new();
        let attacker: IpAddr = "203.0.113.7".parse().unwrap();
        // Spend the attacker's whole per-IP burst (10 calls consume 10
        // global tokens too).
        for _ in 0..RATE_BURST as usize {
            assert!(limiter.check(attacker).is_ok());
        }
        // 90 more calls from the blocked attacker: per-IP rejects each
        // one. None may spend a global token.
        for _ in 0..90 {
            assert!(limiter.check(attacker).is_err());
        }
        // The global bucket still holds 90 tokens: a fresh IP succeeds.
        let fresh: IpAddr = "198.51.100.9".parse().unwrap();
        assert!(
            limiter.check(fresh).is_ok(),
            "a per-IP-blocked attacker must not drain the global bucket"
        );
    }

    fn test_ip(n: u32) -> IpAddr {
        IpAddr::from(std::net::Ipv4Addr::from(n))
    }

    /// R2-8 pin: the per-IP map must stay bounded. Fails on the old
    /// `check` (one `Bucket` per IP, never evicted): the map keeps all
    /// 10,500 entries and the idle buckets survive.
    #[test]
    fn per_ip_map_is_bounded() {
        let limiter = RateLimiter::new();
        let stale = Instant::now() - Duration::from_secs(3 * 3600);
        {
            let mut inner = limiter.inner.lock().unwrap_or_else(|e| e.into_inner());
            // 500 buckets idle for 3 h: fully refilled long since, so
            // evictable without changing any admission decision.
            for n in 0..500u32 {
                inner.per_ip.insert(
                    test_ip(n),
                    Bucket {
                        tokens: 0.0,
                        last: stale,
                    },
                );
            }
            // Fill to the cap with fresh buckets.
            for n in 500..(500 + MAX_PER_IP_BUCKETS as u32) {
                inner.per_ip.insert(
                    test_ip(n),
                    Bucket {
                        tokens: RATE_BURST,
                        last: Instant::now(),
                    },
                );
            }
        }
        // One admitted check from a brand-new IP must evict the idle
        // buckets and stay within the cap.
        assert!(limiter.check(test_ip(1_000_000)).is_ok());
        let inner = limiter.inner.lock().unwrap_or_else(|e| e.into_inner());
        assert!(
            inner.per_ip.len() <= MAX_PER_IP_BUCKETS,
            "per_ip map must stay bounded, got {} entries",
            inner.per_ip.len()
        );
        assert!(
            inner.per_ip.get(&test_ip(0)).is_none(),
            "idle buckets must be evicted"
        );
    }

    /// R2-8 pin: concurrent retries of one `feedback_id` must create
    /// exactly one Plane issue. Fails on the old `submit_feedback`
    /// (dedupe inserted only after the upstream await): both requests
    /// pass the empty dedupe check and each creates an issue. The
    /// slow mock upstream (500 ms) makes the race deterministic.
    #[tokio::test]
    async fn dedupe_in_flight_duplicate_creates_one_issue() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, _, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let payload = feedback_payload("fb-inflight-1", "slow-plane");
        // Two concurrent submissions of the same feedback_id: the
        // second must wait on the in-flight claim and return the first
        // request's issue, not create a second one.
        let (first, second) = tokio::join!(
            post_feedback(addr, &payload),
            post_feedback(addr, &payload),
        );
        assert_eq!(first.status(), StatusCode::CREATED);
        assert_eq!(second.status(), StatusCode::CREATED);
        let first_body: serde_json::Value = first.json().await.unwrap();
        let second_body: serde_json::Value = second.json().await.unwrap();
        assert_eq!(second_body["issue_id"], first_body["issue_id"]);
        assert_eq!(second_body["issue_url"], first_body["issue_url"]);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "concurrent retries must create exactly one Plane issue"
        );
        server.abort();
        mock.abort();
    }

    /// R2-87 pin (1): dropping the leader's claim — what hyper does to
    /// the handler future when the client disconnects mid
    /// `create_plane_issue` — must free the slot. Fails on the old
    /// code (explicit cleanup only): the id stays in `in_flight` and
    /// every retry stalls 35 s.
    #[test]
    fn dedupe_cancelled_leader_frees_slot() {
        let dedupe = Arc::new(DedupeSet::new());
        let leader = dedupe.claim("fb-87-leak");
        assert!(
            matches!(leader, Claim::Claimed(_)),
            "first claim must own the slot"
        );
        drop(leader); // <- hyper cancelling the handler future mid-request
        assert!(
            matches!(dedupe.claim("fb-87-leak"), Claim::Claimed(_)),
            "a cancelled leader must not leak its in_flight slot"
        );
    }

    /// R2-87 pin (3): a waiter whose completion fires before it ever
    /// polls must still wake. The wait future is registered under the
    /// set lock, so completing the leader immediately after the waiter
    /// claims — the exact lost-wakeup interleaving — resolves promptly
    /// instead of hanging the full 35 s. Fails on the old code
    /// (`notify_waiters()` fired with no waiter registered yet).
    #[tokio::test]
    async fn dedupe_waiter_does_not_miss_completion() {
        let dedupe = Arc::new(DedupeSet::new());
        let leader = dedupe.claim("fb-87-wake");
        assert!(matches!(leader, Claim::Claimed(_)));
        let waiter = match dedupe.claim("fb-87-wake") {
            Claim::InFlight(waiter) => waiter,
            _ => panic!("second claim must wait on the in-flight leader"),
        };
        // Leader completes BEFORE the waiter future is ever polled.
        dedupe.complete(
            "fb-87-wake",
            "ISS-87".to_string(),
            "http://x/ISS-87".to_string(),
        );
        drop(leader);
        let woken = tokio::time::timeout(Duration::from_secs(2), waiter).await;
        assert!(
            woken.is_ok(),
            "waiter missed the completion notification (lost wakeup)"
        );
        assert!(
            matches!(dedupe.claim("fb-87-wake"), Claim::Done(_)),
            "re-claim after the wake must return the stored issue"
        );
    }

    /// R2-87 pin (2): concurrent same-id claims must yield exactly one
    /// owner per round. Fails on the old two-mutex claim (a claim whose
    /// `seen` check ran before the leader's completion and whose
    /// `in_flight` check runs after it slips through and
    /// double-creates). Hammered: 16 tasks x 300 fresh ids, barrier
    /// start. Waiters re-claim on a short sleep instead of awaiting
    /// the notifier, so this pin tests only the claim atomicity, not
    /// the wakeup (covered by the pin above).
    #[tokio::test]
    async fn dedupe_concurrent_claims_have_one_owner() {
        let dedupe = Arc::new(DedupeSet::new());
        for round in 0..300u32 {
            let id = format!("fb-87-race-{round}");
            let creations = Arc::new(AtomicUsize::new(0));
            let barrier = Arc::new(tokio::sync::Barrier::new(16));
            let mut handles = Vec::new();
            for _ in 0..16 {
                let dedupe = dedupe.clone();
                let id = id.clone();
                let creations = creations.clone();
                let barrier = barrier.clone();
                handles.push(tokio::spawn(async move {
                    barrier.wait().await;
                    loop {
                        match dedupe.claim(&id) {
                            Claim::Done(_) => break,
                            Claim::InFlight(_) => {
                                tokio::time::sleep(Duration::from_millis(1)).await;
                            }
                            Claim::Claimed(guard) => {
                                creations.fetch_add(1, Ordering::SeqCst);
                                dedupe.complete(
                                    &id,
                                    "ISS-87".to_string(),
                                    "http://x/ISS-87".to_string(),
                                );
                                drop(guard);
                                break;
                            }
                        }
                    }
                }));
            }
            for handle in handles {
                handle.await.unwrap();
            }
            assert_eq!(
                creations.load(Ordering::SeqCst),
                1,
                "round {round}: more than one owner created issues for one feedback_id"
            );
        }
    }

    #[tokio::test]
    async fn never_logs_feedback_text_or_api_key() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (base, mock) = mock_plane_server(calls.clone()).await;
        let (state, logs, _) = test_state(base);
        let (addr, server) = serve_app(state).await;
        let c = client();
        // Sentinel values: if any of these ever appears in a log line, the test fails.
        let summary = "SUMMARY-SENTINEL-5a1b <b>bold</b>";
        let details = "DETAILS-SENTINEL-9e4d with a secret phrase";
        let _ = c
            .post(format!("http://{addr}/api/v1/feedback"))
            .json(&serde_json::json!({
                "feedback_id": "fb-log-1",
                "ts": 1u64,
                "kind": "bug",
                "summary": summary,
                "details": details,
                "context": {"note": "CONTEXT-SENTINEL-3c7f"},
            }))
            .send()
            .await
            .unwrap();
        // A duplicate (logs the issue id again) and a rate-limit event too.
        let _ = c
            .post(format!("http://{addr}/api/v1/feedback"))
            .json(&serde_json::json!({
                "feedback_id": "fb-log-1",
                "ts": 1u64,
                "kind": "bug",
                "summary": summary,
                "details": details,
                "context": {},
            }))
            .send()
            .await
            .unwrap();
        for i in 0..15 {
            let _ = c
                .post(format!("http://{addr}/api/v1/feedback"))
                .header("cf-connecting-ip", "203.0.113.7")
                .json(&feedback_payload(&format!("fb-log-rl-{i}"), "rate limit probe"))
                .send()
                .await
                .unwrap();
        }
        let captured = logs.0.lock().unwrap().join("\n");
        assert!(
            !captured.is_empty(),
            "expected access-log lines to have been captured"
        );
        for s in [
            "SUMMARY-SENTINEL-5a1b",
            "DETAILS-SENTINEL-9e4d",
            "CONTEXT-SENTINEL-3c7f",
            "TEST_PLANE_API_KEY",
            "fb-log-1",
        ] {
            assert!(
                !captured.contains(s),
                "log leaked sensitive material: {s}\n--- logs ---\n{captured}"
            );
        }
        // The created issue id MAY appear (it is the one id logs carry);
        // everything else must be one of the known log shapes.
        for line in logs.0.lock().unwrap().iter() {
            assert!(
                line.starts_with("method=")
                    || line.starts_with("rate_limited ")
                    || line.starts_with("feedback_created ")
                    || line.starts_with("feedback_duplicate ")
                    || line.starts_with("plane_error "),
                "unexpected log shape: {line}"
            );
        }
        server.abort();
        mock.abort();
    }

    #[test]
    fn api_key_debug_is_redacted() {
        let k = PlaneApiKey::new("super-secret-value".to_string());
        assert!(!format!("{k:?}").contains("super-secret-value"));
    }

    #[test]
    fn html_escape_covers_all_five_chars() {
        assert_eq!(
            escape_html("<a href=\"x\">&'y'</a>"),
            "&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;"
        );
    }

    #[test]
    fn validation_unit_cases() {
        let good = FeedbackRequest {
            feedback_id: "fb-1".to_string(),
            ts: 1,
            kind: "other".to_string(),
            summary: "s".to_string(),
            details: "d".to_string(),
            context: serde_json::json!({"app_version": "1.7.3"}),
        };
        assert!(validate_feedback(&good).is_ok());
        let mut bad = FeedbackRequest {
            feedback_id: "fb-1".to_string(),
            ts: 1,
            kind: "bug".to_string(),
            summary: "s".to_string(),
            details: "d".to_string(),
            context: serde_json::json!({"deep": {"a": {"b": {"c": {"d": "too-deep"}}}}}),
        };
        assert!(validate_feedback(&bad).is_err());
        bad.context = serde_json::json!("not-an-object");
        assert!(validate_feedback(&bad).is_err());
        bad.context = serde_json::json!({});
        bad.kind = "wish".to_string();
        assert!(validate_feedback(&bad).is_err());
    }

    /// In-process smoke check of the router without a socket (used by the
    /// targeted pre-fix/post-fix loop for handler wiring).
    #[tokio::test]
    async fn router_health_oneshot() {
        let (base, mock) = mock_plane_server(Arc::new(AtomicUsize::new(0))).await;
        let (state, _, _) = test_state(base);
        let app = build_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        mock.abort();
    }
}

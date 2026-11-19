# Titer feedback server

First-party feedback endpoint for Titer (v1.7.3, seq 276). The desktop app
can never hold the Plane API key (anything in the binary can be extracted),
so this tiny server holds it instead and files each validated feedback
report as a Plane issue.

## What it does — and does not do

- `GET /health` → `{"status":"ok"}` (no auth).
- `POST /api/v1/feedback` — JSON `{"feedback_id","ts","kind","summary",
  "details","context"}` (the JSONL entry shape `titer_send_feedback`
  writes) → `201 {"feedback_id","issue_id","issue_url"}`.
  The server validates, HTML-escapes the user text, and creates a Plane
  issue titled `[feedback] {summary}` with `description_html` carrying
  kind / summary / details / context + received time + source
  `titer_send_feedback server`, state Backlog, priority none.

Rules (SCOPE.md, "Server mode — design"):

- **Validation:** `kind` in `bug` | `missing-feature` | `other`;
  `summary` 1–200 chars; `details` 1–4000 chars; body at most 16 KB of
  JSON; `context` an object whose leaves are JSON scalars only (the
  shipped client sends string fields plus a `recent_activity` array of
  small objects — tool names, unix times, ok flags — which this admits).
  Bad input → `400`, before any upstream call is made.
- **Dedupe:** bounded in-memory set of recent `feedback_id`s (1000
  entries, 24 h TTL). A retry returns the original issue id + URL with
  `201` and creates no second issue. No database, no storage.
- **Rate limit:** per-IP token bucket, burst 10, refill 5/hour, plus a
  global cap of 100/hour. Over the limit → `429` + `Retry-After`.
  Behind the Cloudflare tunnel the socket peer is localhost, so the
  `CF-Connecting-IP` header is trusted — but only from a loopback peer.
- **Never logs** feedback text, summaries, or the Plane PAT. Logs carry
  only `method path status duration_ms`, plus rate-limit events and
  created issue ids.
- **Errors:** Plane 5xx / unreachable → `502`. Any non-2xx Plane reply
  is a gateway failure: the request was already validated, so a Plane
  4xx is a server-side configuration problem, not a client error.
- Upstream timeout: 30 s.
- **Plane API:** `POST https://plane.smitpatel.net/api/v1/workspaces/titer/projects/a0d96c9d-ab8c-4147-96f6-8f3741cae1d3/issues/`
  with `X-API-Key` (NOT `Authorization: Bearer`),
  `Accept-Encoding: gzip`, trailing slash, `description_html` for the
  description. (The `...585414ae000e` project id in older notes is WRONG
  and 404s.)

## Run

```sh
PLANE_API_KEY=<pat> cargo run --release
# or: PLANE_API_KEY=<pat> ./target/release/titer-feedback
# FEEDBACK_BIND=127.0.0.1 FEEDBACK_PORT=18098
```

Refuses to start without the Plane API key. The key is the only
credential the service holds. `PLANE_API_URL` overrides the upstream
Plane endpoint — **test hook only** (mock Plane endpoint in
`cargo test`).

## Tests

```sh
cargo test
```

Covers: happy path against a mock Plane endpoint (issue created with
escaped HTML, title prefix, Backlog state, priority none, `X-API-Key`
and gzip headers asserted), validation 400s (including the 16 KB body
cap and boundary lengths 200/4000 accepted), Plane 5xx / unreachable →
502, rate-limit 429 + `Retry-After` (and per-IP isolation), the global
100/hour cap, dedupe (same `feedback_id` twice → one issue), a
never-logs-feedback-text test (captured logs asserted free of every
summary/details/context/key sentinel), and API-key `Debug` redaction.

## Deploy (Pi + Cloudflare tunnel)

See the deployment notes in `~/workspace/.helix-server-feedback/pi-deploy/`
— the live state (port, service, tunnel ingress, DNS) is recorded there,
not in this repo, because it contains hostnames, not secrets. The service
runs as a systemd user service on the Pi (`Restart=always`), the key lives
in a mode-600 env file on the Pi only, and the public URL is
`https://feedback.smitpatel.net`.

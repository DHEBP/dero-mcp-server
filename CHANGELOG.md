# Changelog

All notable changes to `dero-mcp-server` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.4.1]

### Fixed
- **HTTP transport: fresh `McpServer` + transport per request.** The streamable-HTTP
  entry point previously created one shared `StreamableHTTPServerTransport` at
  startup and reused it for every `/mcp` request. The SDK transport carries
  per-request state (response writer, SSE stream), so the *first* request after
  start would succeed, then every subsequent request returned HTTP 500 with an
  empty body (the SDK throws after partially writing headers, so our catch
  block's `res.headersSent` guard suppresses the JSON error body). The fix is
  the official stateless pattern: instantiate `McpServer` + transport inside
  the request handler and clean both up on `res.on('close')`. Per-request
  isolation also prevents request-ID collisions across concurrent clients.
  Stdio transport is unaffected.

## [0.4.0]

### Changed
- **Local-first daemon resolution.** When `DERO_DAEMON_URL` is unset, the server
  now probes a local node at `127.0.0.1:10102` (via `DERO.GetInfo`) and uses it
  if reachable, falling back to the baked-in public node only when no local
  daemon answers. Previously it defaulted straight to the public node. An
  explicit `DERO_DAEMON_URL` still wins, so hosted deployments are unaffected.
  Applies to both stdio and streamable-HTTP transports.
- `/health` now reports `daemon_source` (`env` | `local` | `public`) alongside
  `daemon_url`, and startup logs state which daemon was selected and why.

Versions prior to 0.4.0 predate this changelog.

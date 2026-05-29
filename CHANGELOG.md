# Changelog

All notable changes to `dero-mcp-server` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

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

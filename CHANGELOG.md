# Changelog

All notable changes to `dero-mcp-server` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.4.2]

### Fixed
- **CaptainNote / Quote attribution surviving MCP plaintext extraction.** The
  previous `mdxToPlainText` regex `/<[^>\n]+>/g` could not match multi-line JSX
  opening tags, so every `<CaptainNote ...>` opening tag (5–7 lines of
  attributes) leaked into MCP output as raw JSX while the closing tag was
  stripped — quote bodies bled into the next paragraph with no boundary. Worse,
  the `— Captain` author label, date, channel, source URL, and `verified ·
  Release 142` badge are all rendered by the React component, so they never
  appeared in MCP plaintext at all. The new `shimAttributedQuotes()` transforms
  `<CaptainNote>` and `<Quote>` into markdown blockquotes that preserve full
  attribution: `> {body}\n>\n> — {author}, {date}, {channel} ({source}); verified · Release 142: {codeRef}`.
  Also added an HTML entity decode pass (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
  `&apos;`, numeric and hex entities) and switched the generic JSX stripper to
  `/<[^>]+>/gs` so any remaining multi-line JSX (`<figure>`, `<Image>`) no
  longer leaks. Captures attribution for all 70 archival CaptDero/Captain
  quotes on `/captain` plus the 25 verified quotes embedded across canonical
  doc pages.

### Changed
- **Paginated `dero_docs_get_page` via optional `offset`.** Previously
  truncated at 20000 chars with no signal — so long pages like `/captain`
  (~75k chars) returned only the first ~25 of 70 quotes silently. The cap is
  now 60000 chars per request, and the response includes `content_offset`,
  `content_length`, `content_truncated`, and `next_offset` so callers can
  paginate explicitly. Additive change: existing callers that ignore the new
  fields continue to work; only the per-chunk size grew (3×) and a new
  optional `offset` input parameter is available.

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

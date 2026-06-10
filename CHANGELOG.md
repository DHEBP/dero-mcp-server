# Changelog

All notable changes to `dero-mcp-server` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.4.6]

### Fixed
- **`tela_inspect` now decodes hex-encoded stored values.** `DERO.GetSC`
  returns smart-contract string-key *values* hex-encoded, which the TELA spec's
  plain-text examples obscured. Inspecting a real mainnet TELA app therefore
  returned the app name as `43727970746f2068616d6d6572` instead of
  "Crypto hammer", the dURL and description as hex, and — because DOC SCID
  values are the 128-char hex encoding of a 64-char SCID — flagged every DOC as
  "malformed". A defensive `decodeScValue` now hex-decodes any value that
  decodes to printable UTF-8 (leaving counters, binary, and already-plain
  values untouched), DOC SCIDs are decoded before validation (no more false
  malformed flags), the app name falls back to `var_nameHdr`, and
  `telaVersion` / `likes` / `dislikes` are surfaced. Verified live against the
  `c-hammer2-site.tela` and `cipherchess.tela` apps.

### Tests
- `check:tela-parse` gains a hex-encoded fixture (F8) modeled on the live
  "Crypto hammer" app, and the `flow-tela-inspect-real-scid` flow test now runs
  by default against a real mainnet TELA INDEX (overridable via `DERO_TELA_SCID`)
  and asserts the decode — converting the offline-only parser proof into a
  live-chain regression. `check:server-json` now also guards the server.json
  description against the MCP registry's 100-char limit.

## [0.4.5]

### Added
- **TELA on-chain tooling — two new tools take TELA from docs-only to a
  read-only builder surface.** `tela_inspect` fetches a SCID and parses it as a
  TELA-INDEX-1 app manifest or a TELA-DOC-1 file contract (auto-detected),
  enumerating the full ordered `DOC1..DOCn` list, mods, commit/version history,
  and an honest immutability note; non-TELA SCIDs return `kind: not_tela`
  (a success, not an error). `tela_get_doc_content` extracts a DOC's actual
  file content from the contract's DVM comment block, with offset pagination
  and `.gz`-compression flagging. Both read the raw `DERO.GetSC` stringkeys
  directly via a new shared parser (`src/tela-parse.ts`) so a large manifest's
  DOC list is not truncated by the 50-key surface cap. Total tools: 28 → 30.

### Changed
- **`explain_smart_contract` is now TELA-aware.** TELA contracts are detected
  *before* the token/registry heuristics, fixing a misclassification where a
  TELA contract's `EXISTS("nameHdr")` made it register as a name registry. The
  `kind` union gains `tela_index` and `tela_doc`, and TELA contracts now cite
  the TELA spec pages.
- **Docs search rewritten from substring matching to a BM25F scorer.** The old
  binary `.includes()` scorer (no tokenization, stopwords, term frequency, or
  length normalization) ranked the wrong pages for real questions — e.g.
  "dero vs monero" matched the word "vs" across 144 of 147 pages. The new
  scorer adds word-boundary tokenization (incl. hyphenated standard names like
  `TELA-INDEX-1`), a curated stoplist, per-field length normalization (which
  ends the Captain-archive keyword-sponge problem), and IDF weighting so rare
  discriminating terms steer ranking. The previously-unused `description` field
  is now scored, and excerpts are query-centered. `recommend_docs_path` gains a
  narrow beginner-intent nudge that surfaces the "Understanding DERO"
  orientation page. Computed in-process at load time — no index-format change.

### Fixed
- **`explain_smart_contract` / `dero_get_sc` no longer overflow host token
  limits** on large registries. The name service's 22,619 stored keys produced
  a ~413 KB response (rejected by MCP hosts) on the very SCID the tool docs
  recommend as the known-good example. State-variable maps are now capped at a
  sampled 50 keys with `*_total` / `*_truncated` markers.
- **Tool failures now set `isError: true`** at the protocol level, so MCP hosts
  that branch on the flag recognize a failed call (the structured
  `ok:false`/`_meta.error` body is unchanged).
- **Two MCP prompt arguments could never validate.** `reference_topoheight`
  (`z.number()`) and `include_breakdown` (`z.boolean()`) were declared with
  non-string zod types, but prompt arguments arrive as strings; they now coerce
  correctly.
- **Metadata drift across the front door.** README version, tool/resource/prompt
  counts, Node floor, and the registry description were stale; all corrected and
  the surface counts are now guarded by `check:server-json`.

### Distribution
- **The live `mcp.derod.org` streamable-HTTP endpoint is now published in the
  registry** via a `remotes` entry in `server.json`.

### Tests
- New offline guards wired into CI: `check:tela-parse` (21 TELA-parser fixture
  assertions, incl. a >50-DOC INDEX proving cap-bypass and a registry-is-not-TELA
  case) and `check:docs-ranking` (the 6 confirmed search cases as a before/after
  regression harness). A live `tela_inspect` false-positive guard asserts the
  22,619-key name registry classifies as `not_tela`.

## [0.4.4]

### Fixed
- **The bundled docs index silently stripped every code example from every
  page.** `mdxToPlainText` deleted whole fenced code blocks
  (`src/docs-parse.ts`), so the flagship `derod/rpc-api/daemon-rpc-api`
  reference shipped with no `curl`, `DERO.GetInfo`, or `jsonrpc` — the source
  has 75 such occurrences, the index had 0. An agent asking "how do I call
  GetInfo" got prose with the command removed. The fence regex now preserves
  the code contents (drops only the ``` and language tag); the flagship page's
  indexed text went from ~6 KB to ~60 KB. A new `mustContain` content-fidelity
  probe in `smoke:docs` asserts `curl`/`DERO.GetInfo`/`jsonrpc` survive on that
  page so the regression can't silently return. Also folds in the docs refresh
  from dero-docs @ f21a5c9 (146 → 147 pages).

### Changed
- **`docker compose` fails loudly when `DERO_MCP_VERSION` is unset** instead of
  silently defaulting to a months-old pin (was `0.2.4`). Set it in
  `deploy/.env`.
- **`/health` now reports `docs_generated_at` and `docs_page_count`** so an
  operator can see at a glance whether the live server is serving a current
  docs bundle.

### Docs
- Added `docs/DOCS-BUNDLE-SYNC.md` — the previously-missing runbook for the
  dero-docs → mcp-server → npm → VPS pipeline: what's automated vs. manual, the
  secrets involved, and manual-recovery steps.

## [0.4.3]

### Fixed
- **`diagnose_chain_health` mislabeled the network.** Mainnet `derod` returns
  `network: ""` and signals the chain via the `testnet` boolean, so the
  narrative rendered "Chain appears healthy on  (version…)" with a double space
  and `chain.network: null`, and the `network` signal was dropped entirely. A
  new `resolveNetwork()` helper derives `mainnet`/`testnet` from the `testnet`
  boolean when the string is blank — never fabricating "mainnet" from an empty
  string alone (a testnet node with a blank `network` would otherwise be
  mislabeled).
- **`audit_chain_artifact_claim` reward formatting dropped atomic precision.**
  `(reward / 100_000).toFixed(3)` truncated DERO's 5-decimal amounts *and*
  rounded: a per-miniblock reward of `30750` atoms rendered as `0.308` (a value
  never on-chain) instead of `0.30750`. This narrative feeds the inflation-claim
  audit, where 5-digit fidelity is the deliverable. Now formatted via integer
  math (`floor` + `% 100_000` padded to 5).
- **Version self-report drift.** The MCP handshake version, the HTTP
  `PACKAGE_VERSION`, and the `deploy/.env.example` default lagged behind
  `package.json` / `server.json`, so the running server advertised a stale
  version to clients. All six references are now pinned together and gated by
  `check:server-json`.
- **`rpc.ts` lost specific daemon errors on non-2xx responses.** The HTTP status
  was checked before the JSON-RPC body was parsed, so a daemon (or proxy)
  returning a non-2xx status with a JSON-RPC error body (e.g. `-32098` DVM
  compile) surfaced as a generic `HTTP {status}` error. The body is now parsed
  first; the raw HTTP error is a fallback only when the body is not a usable
  JSON-RPC error.
- **`cborDecode` silently accepted trailing bytes.** The existing `done()` check
  was never called, so a `deroproof…` string with valid CBOR followed by junk
  decoded as if clean. It now throws `cbor: trailing bytes after root value`.

### Changed
- **Input hardening on user-supplied surfaces.** `forge_demo_proof`'s `tx_hex`
  gained a `.max(100_000)` bound (real DERO txs are well under 10 KB of hex) to
  prevent unbounded allocation; `tx-parse` now rejects an `asset_count` above the
  protocol maximum (`PAYLOAD_LIMIT = 145`) with a clear error instead of a
  cryptic EOF; and `docs-parse` validates numeric HTML-entity codepoints before
  `String.fromCodePoint`, passing out-of-range entities through as literal text
  rather than throwing a `RangeError` that would abort the whole doc index.

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

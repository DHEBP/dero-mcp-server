# DERO MCP — Agent Utility Improvements

**Last updated:** 2026-05-23
**Repo:** `DHEBP/dero-mcp-server`
**Audience:** maintainers planning the next utility step beyond the v0.1 agent-ready baseline.
**Source pattern:** Food Near Me Phase 7 — see [`/Users/home/projects/docs/AI Agent Ready/remix/14-competitive-mcp-shape-parity-and-composites.md`](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md) and the FNM composite contract in `FoodNearMe/apps/web/lib/mcp/tools/COMPOSITES.md`.

> **Status:** Phase A (annotations + descriptions + CI guard + citation foundation), Phase B docs (decision boundary + composites design contract), and **all five Phase C composites** (`diagnose_chain_health`, `explain_smart_contract`, `recommend_docs_path`, `estimate_deploy_cost`, `trace_transaction_with_context`) **shipped 2026-05-23** with flow tests green against the public daemon. Phases A + B + C are complete. See § 5 for current status per item.

> **What this doc is.** A planning artifact tracking which FNM Phase 7 learnings transfer to DERO MCP, which intentionally do not, and a prioritized order for the utility cycle. Use it to scope the next backlog.

> **What this doc is not.** A spec, a contract, or a deprecation notice. The current v0.1 server is already agent-ready (see [`mcp-agent-ready-evidence.md`](./mcp-agent-ready-evidence.md)). This document plans the *next* level of agent utility.

---

## 1. Starting-point snapshot (legacy v0.1.2 — superseded by v0.2.0)

| Dimension | Status |
|-----------|--------|
| Transport | stdio via npm package `dero-mcp-server` |
| Tools | **20** — 1:1 daemon RPC reads + 3 docs tools (`dero_docs_search`, `dero_docs_get_page`, `dero_docs_list`) |
| Resources | 3 (`server-info`, `safety-boundary`, `example-flows`) |
| Prompts | 3 (`network_health_check`, `inspect_smart_contract`, `trace_transaction`) |
| Tool descriptions | Short, mostly mirroring DERO RPC method name (e.g. `"Total block count (DERO.GetBlockCount)."`) |
| MCP annotations | **None** declared (no `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) |
| Citation / attribution | **None** — tool responses do not link back to bundled docs pages |
| Composite tools | **None** — every tool is a thin RPC pass-through (plus docs lookups) |
| Input ergonomics | snake_case only; no aliases; no Zod transforms |
| CI guards | Build, typecheck, smoke probes, flow tests pass — but no description style guard, no annotation parity assertion |
| Decision boundary doc | Implicit ("no wallet RPC, no `SendRawTransaction`, no `SubmitBlock`") — not pinned in a versioned doc |

The agent-ready baseline is solid. The next step is **utility**: making each tool call obviously useful to an agent and giving agents composite primitives that match how chain-investigation actually happens.

---

## 2. DERO's wedge (what only this server can do)

Before applying FNM patterns, name the wedge so composites have somewhere to land.

| DERO wedge asset | Why it matters to an agent |
|------------------|---------------------------|
| **Bundled 145-page docs index** | In-process docs lookup with no network — agents can self-correct without a web browse step |
| **Read-only daemon access via stdio** | No HTTP, no DNS, no shared-host blast radius — safe to auto-approve |
| **DVM-specific knowledge** (DVM-BASIC, TELA, Hologram, DeroPay) | Pairs perfectly with on-chain reads for explain-this-contract flows |
| **Privacy-preserving chain model** | "Encrypted balance" semantics need contextual explanation — an agent without the docs will hallucinate |
| **Gas-estimate + SC introspection in same surface** | Agents can pre-flight a `scinvoke` design without leaving the server |

**Wedge test for any new tool (mirrors FNM's wedge test):**
> Does this tool produce a meaningfully better answer because of DERO's docs + chain-read combination? If a generic JSON-RPC client could do it, the value is questionable — keep it as a primitive, not a composite.

---

## 3. What transfers from FNM Phase 7 (ranked by impact)

For each item: source FNM sub-phase, what to port, and the rough effort/impact.

### 3.1 Composite tools (FNM 7f) — **highest impact**

Compose existing primitives + bundled docs into intent-shaped tools. Each composite is one self-contained commit to main with a design entry in `docs/composites.md` (mirroring FNM's `COMPOSITES.md`).

| Candidate composite | Internal chain | Why it wins |
|---------------------|----------------|-------------|
| `diagnose_chain_health` | `DERO.GetInfo` + `DERO.GetHeight` + `DERO.GetLastBlockHeader` + `DERO.GetTxPool` → narrative summary + `dero_docs_search("sync")` citation | Replaces 4 round-trips and a "what does this field mean?" docs lookup |
| `explain_smart_contract` | `DERO.GetSC` + extract function/variable names + match against bundled DVM docs pages | Turns raw `Code` blob into a human-readable contract surface |
| `trace_transaction_with_context` | `DERO.GetTransaction` + (if SC call) `DERO.GetSC` + relevant docs page on tx structure | One call replaces today's `trace_transaction` prompt walkthrough |
| `estimate_deploy_cost` | `DERO.GetGasEstimate` + `dero_docs_search("deploy")` citation + plain-text breakdown | Removes the need for agents to guess gas args |
| `recommend_docs_path` | Take an intent string, match across all 4 docs products, return ranked pages | Bridges natural-language intent → bundled docs without an LLM round-trip |

**Sequencing rule (from FNM):** decorate first (`diagnose_chain_health`), then N-call (`explain_smart_contract`, `recommend_docs_path`), then anything that touches numeric pre-flight (`estimate_deploy_cost`).

### 3.2 Tool description hardening (FNM 7d) — **high impact**

Current state: most descriptions are one short sentence ending in `(DERO.X)`. Agents will skip context-setting and fail at obvious things (e.g. calling `dero_get_block` without `hash` or `height`).

Port the FNM agent-instruction style:
1. **Call timing:** "Call before any SC inspection so the agent knows the current tip."
2. **Input Requirements (CRITICAL):** explicit MUST/PREFER blocks.
3. **Output shape hint:** one line on what to expect back.
4. **Citation guidance:** when a docs page exists, tell the agent to surface it.

Example rewrite of `dero_get_block`:

```
Fetch a full block by height OR hash (DERO.GetBlock).

When to call: when investigating a specific block or verifying a transaction's
inclusion. Call dero_get_height first if you do not have a target height.

Input Requirements (CRITICAL):
- You MUST provide exactly one of `hash` or `height`. Providing both or
  neither returns INVALID_INPUT.
- `hash` MUST be 64 hex characters.
- `height` MUST be a non-negative integer.

Output: full block including header, miner_tx, txs, and topo position.
PREFER citing dero_docs_search("block structure") in your response so the
user can verify field semantics.
```

### 3.3 MCP read-only annotations (FNM 7d) — **high impact, low effort**

Every current tool is read-only. Hosts (Cursor, Claude Desktop) can auto-approve safe calls when annotations are present.

Add `READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }` and apply to all 20 tools. This is also forward-compatible with adding wallet tools later: those would carry the *opposite* annotations and remain require-approval.

### 3.4 Citation / attribution to bundled docs (FNM 7c) — **high impact**

FNM lessons: agents will not surface trust signals unless the tool response contains a structured pointer.

Implementation sketch:
- Add a `citation` field to composite tool responses: `{ url, title, source: 'dero_docs', page_id }`.
- For primitives that have an obvious matching docs page (`dero_get_sc` → DVM page, `dero_get_gas_estimate` → gas page), include an optional `related_docs: [{ page_id, title }]` array.
- Mirror FNM's helper pattern — a single `buildDeroCitation(pageId)` function returns the structured object so every tool emits the same shape.

### 3.5 Decision boundary doc (FNM 7-prelude) — **medium impact**

Today, "no wallet RPC" is in the README. Promote it to a versioned `docs/decision-boundary.md` so future contributors do not silently add transfer/scinvoke tools.

Contents (mirroring FNM's structure):
- **Allowed:** all read-only daemon RPC, bundled docs lookup, composites that chain reads + docs.
- **Not allowed (v0.1.x):** wallet RPC, `SendRawTransaction`, `SubmitBlock`, anything that opens an outbound network call beyond `DERO_DAEMON_URL`.
- **Posture:** stdio-first, local-only, read-only. No telemetry by default.
- **Re-evaluate trigger:** when a host gains a per-tool approval UI strong enough to gate wallet calls safely.

### 3.6 Runtime tool filtering (FNM 7e) — **medium impact**

Add `DERO_MCP_ENABLED_TOOLS` env var (CSV) so operators can:
- Disable docs tools when running against a custom docs root.
- Enable an *experimental* tool tier without forking (e.g. future wallet tools behind `DERO_MCP_ENABLE_WALLET=true`).
- Match FNM's `FNM_MCP_ENABLED_TOOLS` ergonomics.

Pair with a flow test that asserts: when a tool is disabled, calling it returns a structured error with an actionable hint (`"Tool not enabled in this deployment; set DERO_MCP_ENABLED_TOOLS to include it."`).

### 3.7 CI description guard (FNM 7d gate) — **medium impact, low effort**

Add `scripts/check-mcp-descriptions.ts` (port from FNM):
- Each tool description must contain "When to call" or "Call before/after".
- Each tool with required inputs must contain `Input Requirements`.
- Each tool description ≥ N characters (e.g. 120) to enforce non-trivial guidance.
- Wire into the existing CI workflow alongside `smoke:mcp` and `test:flows`.

### 3.8 Composite design doc gate (FNM 7f gate) — **process insurance**

Before committing any composite tool implementation, the corresponding section in `docs/composites.md` must already exist on main (input schema, internal chain, response shape, failure modes, flow test ID). If it does not, land the design entry as its own commit first. This is the single biggest reason FNM Phase 7f shipped clean.

### 3.9 Input shape parity / aliases (FNM 7b) — **low-medium impact**

DERO MCP has no incumbent to mirror, but ergonomic input aliases still help. Examples:
- `dero_get_block` accepts `topoheight` *or* `topo_height` *or* `height` (with documented precedence).
- `dero_get_sc` accepts both `scid` and `contract_id`.
- Normalize address inputs case-insensitively (Zod transform → lowercase) to match daemon expectations.

This is a small ergonomic win, not a strategic move.

### 3.10 Skill layout (FNM 7g) — **low-medium impact**

Add a `skills/dero-mcp-server/SKILL.md` + `references/*.md` mirroring the Cursor skill pattern, so hosts that read skills can surface the server proactively. Reuse existing dero-rpc / dvm-basic / dero-quickstart Cursor skills as references rather than duplicating.

### 3.11 Privacy-respecting commercial framing — **not applicable**

FNM needs this because it monetizes a hosted MCP. DERO MCP is an open-source npm dev tool. Skip.

---

## 4. What explicitly does NOT transfer

| FNM item | Why not for DERO |
|----------|------------------|
| HTTP/SSE transport + DNS | DERO MCP is stdio-first by design — adding HTTP enlarges blast radius for no current win |
| Shape parity against an incumbent | No competing DERO MCP exists; parity would be invented, not borrowed |
| Monetization / billing telemetry | Open-source dev tool, no per-call metering needed |
| Privacy-respecting commercial posture | DERO is already privacy-preserving by chain design; nothing to defend at the server layer |
| Locale parameters | DERO docs are English-only; no `languageCode`/`regionCode` parity work |
| Drive-time / routing semantics | No analog — skip |

---

## 5. Priority order and current status

Phased so each level lands a measurable utility win without rewriting the surface.

### P0 — Highest leverage, lowest effort

| Status | Item |
|--------|------|
| ✅ shipped 2026-05-23 | Add `READ_ONLY_ANNOTATIONS` to all 20 tools (§3.3). Pure win for hosts that auto-approve. Smoke probe asserts 20/20. |
| ✅ shipped 2026-05-23 | Rewrite tool descriptions to agent-instruction style (§3.2). Extracted to `src/tool-descriptions.ts`. |
| ✅ shipped 2026-05-23 | Add `scripts/check-mcp-descriptions.ts` + CI step (§3.7). Enforces four-section template (call-timing, input-requirements, output, min-length 200). |

### P1 — Strategic enablers

| Status | Item |
|--------|------|
| ✅ shipped 2026-05-23 | Write `docs/decision-boundary.md` (§3.5). Pins the read-only posture and the AND-conditions required to move the boundary. |
| ✅ shipped 2026-05-23 | Add `buildDeroCitation()` + `RELATED_DOCS_BY_TOOL` map + apply `related_docs` to `dero_get_info`, `dero_get_sc`, `dero_get_gas_estimate` (§3.4). Plus `scripts/check-citations.ts` CI guard validating every curated slug against the bundled index. |
| ✅ shipped 2026-05-23 | Write `docs/composites.md` skeleton with the five candidate composites scoped but not implemented (§3.8). Each composite has input schema + chain + response + failure modes + flow test ID. |

### P2 — Wedge composites (~1 commit each, design-doc-first)

| Status | Item |
|--------|------|
| ✅ shipped 2026-05-23 | Ship `diagnose_chain_health` — decorator-style, lowest risk. Proved the composite plumbing (`src/composites/_shared.ts` shared utils + `scripts/flow-composites.ts` flow runner + smoke probe + CI step) end-to-end. |
| ✅ shipped 2026-05-23 | Ship `explain_smart_contract` — wedge-defining composite. Established `extractScSurface` (now in `_shared.ts`) for reuse by P2 items 4 & 5; flow tested against the on-chain name registry. |
| ✅ shipped 2026-05-23 | Ship `recommend_docs_path` — bridges intent → bundled docs. Docs-only composite; always fans out to all 4 products, applies 1.5× boost to `product_hint` matches, surfaces `NO_DOCS_MATCH` failure mode via a new classifier branch in `withStructuredErrors`. |
| ✅ shipped 2026-05-23 | Ship `estimate_deploy_cost` — numeric pre-flight; reuses `extractScSurface` to enrich the response with the parsed function surface, returns null breakdown when daemon reports 0/0 with non-OK status (never fabricated), surfaces DVM compile failures as structured `INVALID_INPUT` via a new `RPC error -32098` classifier branch. |
| ✅ shipped 2026-05-23 | Ship `trace_transaction_with_context` — final composite. Inline `extractScSurface` on `tx.code` for SC installs (no second `GetSC` call needed because the source is embedded). SC invocation arg decoding documented as deferred (requires binary tx codec, not bundled). Added `TX_NOT_FOUND` classifier branch — the daemon returns an empty record on unknown hashes rather than an error, so the composite detects that and throws a classifier-friendly message. Three flow tests shipped: `flow-trace-known-transfer` (against historical tx `22c3813c…b9e8625` at height 3,112,760), `flow-trace-tx-not-found` (deterministic nonexistent hash → structured `TX_NOT_FOUND` with `retryable: true`), and `flow-trace-sc-install` (env-gated on `DERO_TRACE_SC_TX_HASH`, skipped by default). |

### P3 — Original "ergonomics + reach" backlog (legacy labels — superseded by Phase D + E below)

| Status | Item |
|--------|------|
| ⬜ pending | Add `DERO_MCP_ENABLED_TOOLS` runtime filter (§3.6). |
| ⬜ pending | Add input aliases for the top 3 most-called tools (§3.9). |
| ⬜ pending | Add `skills/dero-mcp-server/SKILL.md` (§3.10). |

### Phase D — Composite-first agent surface (shipped 2026-05-23)

What got shipped as "Phase D ergonomics" diverged from the original P3 list — the urgent thing was making the new composites discoverable to agents, not the original runtime filter / aliases / skill items. Those remain in P3 above.

| Status | Item |
|--------|------|
| ✅ shipped 2026-05-23 | Refresh the 3 original prompts (`network_health_check`, `inspect_smart_contract`, `trace_transaction`) to PREFER composites — primitive chains documented as fallback only. |
| ✅ shipped 2026-05-23 | Add 2 new prompts that drive the composites that had no prompt: `find_dero_docs_for_intent` → `recommend_docs_path`, `estimate_deploy_for_contract` → `estimate_deploy_cost`. |
| ✅ shipped 2026-05-23 | Rewrite `dero://mcp/example-flows` resource composite-first with a structured `_meta.error` code reference. |
| ✅ shipped 2026-05-23 | Add new `dero://mcp/composites` resource — JSON catalog with `replaces`, `when_to_call`, `inputs`, `output_highlights`, `error_codes` for connect-time agent orientation. |
| ✅ shipped 2026-05-24 | Bump version 0.1.2 → 0.2.0 → 0.2.1 (with bundle refresh in between via the auto-PR from `Sync MCP docs bundle`). |
| ✅ shipped 2026-05-24 | Trim `server.json` description to ≤ 100 chars (registry validator limit caught at `mcp-publisher validate`). |
| ✅ shipped 2026-05-24 | Refresh `derod.org/tools/mcp-server` page for the 0.2.1 surface (with proper Nextra front matter, missing in the prior revision). |
| ✅ shipped 2026-05-24 | Release: `npm publish dero-mcp-server@0.2.1`, `mcp-publisher publish` (registry `isLatest: true`), git tag `v0.2.1`, GitHub Release `v0.2.1 — Composites release`. |

### Phase E — Future backlog (do NOT start without trigger)

**Sequencing rule:** Phase E is gated on *observed agent usage*, not theoretical wishlist. Do not begin a Phase E item until at least one of the trigger conditions is met. Avoids over-building — every new tool is a permanent compatibility commitment.

#### Phase E.1 — Polish backlog (small, do-anytime)

These are safe to do whenever. None gate the release.

| Item | Why | Trigger |
|------|-----|---------|
| Run `npm pkg fix` in `dero-mcp-server` and commit | Silences the `bin[dero-mcp-server]` whitespace warning emitted by `npm publish`. Cosmetic, but easy to fix. | Anytime before next `npm publish`. |
| Add a stable `DERO_TRACE_SC_TX_HASH` fixture | The env-gated `flow-trace-sc-install` test is currently SKIPPED by default. Wiring in a known historical SC-install tx hash would exercise the third branch of `trace_transaction_with_context` on every CI run. | When a stable, immutable on-chain SC install tx hash is identified (e.g. from the TELA contracts catalog). |
| Submit to third-party MCP registries (Smithery, Glama, etc.) per `/Users/home/projects/docs/AI Agent Ready/deploy-and-registry-runbook.md` § "Third-party listings" | Expands reach beyond `registry.modelcontextprotocol.io`. Each registry has its own listing process. | Anytime; bounded by how much manual form-filling is acceptable. |
| Pin a `docs_index_version` field in the bundled `data/docs-index.json` | Lets composite tests assert against a specific bundle snapshot, catching silent drift when `dero-docs` adds/removes pages. Currently composites just trust the bundle. | After the first time a `dero-docs` change accidentally breaks an `explain_smart_contract` or `recommend_docs_path` test. |
| Address the open questions in § 7 (composite namespace, citation URL format, etc.) | Some were unresolved when Phase C shipped; the shipped behavior settled them de facto. Either retroactively document the decisions or formally re-open them. | Anytime; useful for the next person picking up this repo. |

#### Phase E.2 — Tool runtime filtering + aliasing (carry-over from P3)

Still genuinely useful, just not the first thing agents need post-0.2.1.

| Item | Why | Trigger |
|------|-----|---------|
| `DERO_MCP_ENABLED_TOOLS` env var to filter `tools/list` | Lets a host config disable specific tools (e.g. only expose composites; only expose primitives; disable mempool-heavy ones). | A user explicitly asks for it, or a host integrator hits a wall trying to slim the catalog. |
| Input aliases on the top 3 most-called tools | Reduces friction when agents misremember (`tx_id` for `tx_hash`, `address` for `scid`, etc.). | After we have telemetry or anecdotal evidence on which mistakes agents actually make. |

#### Phase E.3 — Skill packaging (carry-over from P3)

| Item | Why | Trigger |
|------|-----|---------|
| `skills/dero-mcp-server/SKILL.md` for Cursor / Claude Code / other skill-aware clients | Single file that teaches an agent the composite-first mental model + the 5 `_meta.error` codes + the read-only boundary. Right now agents have to read the description of each tool to learn this; a skill front-loads the lesson. | When a host explicitly supports skills (Cursor does today; depends on whether Claude / OpenCode adopt the same format). |

#### Phase E.4 — Candidate new composites (do NOT prototype without trigger)

Three composite ideas that survived the design contract's "wedge test" but were not in the Phase C scope. Each is gated on either observed agent failure modes or explicit user demand. **Add ONLY through the design contract in [`docs/composites.md`](./composites.md) — write the design entry, get it reviewed, then implement.**

| Candidate composite | What it would do | Trigger |
|---------------------|------------------|---------|
| `dero_resolve_anything` | Takes a single string. Detects whether it's a SCID, tx_hash, registered name, dero address, or block height (heuristic on format) and dispatches to the right primitive/composite. Returns a tagged union so the agent doesn't have to guess. | An agent visibly mis-routes a hash on the first turn often enough to be annoying. |
| `dero_search_blocks` | Wraps `GetBlock` + iteration over a height range. Filters blocks by predicate (has SC invocations, has X transfers, miner address, etc.). | Someone explicitly asks "show me all blocks where X" via an MCP client and the agent has to write the loop manually. |
| `dero_walk_tela_index` | Given a TELA-INDEX-1 SCID, walks the dependency graph (manifest → DOC contracts → version chain) and returns the full asset surface in one call. | When a TELA-native agent flow surfaces (TELA-CLI users wanting to inspect deployed apps from chat). |

#### Phase E.5 — Observability + drift detection

| Item | Why | Trigger |
|------|-----|---------|
| Per-tool latency budgets in `_diagnostics` with CI assertion | Composites already report `step_latency_ms`. Adding a fail threshold (e.g. `diagnose_chain_health` must complete in < 2s against the public daemon) catches daemon regressions early. | After one CI run fails because a composite was unexpectedly slow. |
| Bundle freshness check in CI | Asserts `data/docs-index.json` is at most N days behind `dero-docs/main`. Currently the auto-PR ships when dero-docs lands, but a stale dero-mcp-server PR could keep it behind. | After one release ships with a stale bundle. |
| Smoke probe asserts `dero://mcp/composites` resource is in sync with the actual composite tools (no orphan entries, no missing entries) | Right now the catalog is hand-maintained alongside the tool registrations. A drift guard would prevent the catalog from lying. | Anytime; trivially implementable. |

#### Phase E rejected ideas (record so they don't get re-litigated)

In addition to the rejected designs already in [`composites.md`](./composites.md) (`monitor_address`, `get_richlist`, `compare_two_contracts`, `route_tela_dependencies`), these Phase E ideas were considered and rejected:

- **`dero_subscribe_new_blocks`** — would require long-lived state and streaming, violates request/response. Belongs in a separate transport (SSE / WebSocket) or in the host, not in this MCP.
- **Wallet-aware composites** (e.g. `dero_estimate_tx_for_balance`) — would require either the wallet RPC URL (violates the strict daemon-only boundary) or careful pre-flight that mocks balance. Defer until the read-only boundary is formally expanded per `docs/decision-boundary.md` § 6 AND-gates.
- **`dero_normalize_amount`** — pure utility, no chain or docs lookup. Fails the wedge test; agents can do unit conversion in their head or with a math tool.

---

## 6. Acceptance criteria (when each phase is "done")

Borrowed from FNM's CI-gates-as-evidence pattern.

### After P0 — ✅ met 2026-05-23
- ✅ Smoke probe asserts every tool has `annotations.readOnlyHint === true` (20/20 in `scripts/mcp-smoke-probes.ts`).
- ✅ `npm run check:mcp-descriptions` passes in CI (added as step in `.github/workflows/ci.yml`).
- ⬜ README tool table refresh — deferred to its own commit (not strictly part of the CI gate).

### After P1 — ✅ met 2026-05-23
- ✅ [`docs/decision-boundary.md`](./decision-boundary.md) shipped, linked from `README.md`, `docs/mcp-agent-ready-evidence.md`, and `docs/composites.md`.
- ✅ Smoke probe asserts `dero_get_info` returns a `related_docs` array with valid bundled doc page ids (2 citations).
- ✅ [`docs/composites.md`](./composites.md) exists with all five candidates designed (input schema + internal chain + response shape + failure modes + flow test ID).
- ✅ `npm run check:citations` passes in CI (6 curated citations across 3 tools all resolve against the bundled index).

### After P2
- Each shipped composite has: design entry merged, flow test added, `tools/list` count bumped in README, structured-error path covered.
- `EXPECTED_MCP_TOOLS` updated; smoke probes still pass.

### After P3
- Flow test: disabled tool returns structured error with `code: 'TOOL_DISABLED'` and an actionable hint.
- Input alias flow tests: each alias produces identical results to the canonical name.
- Cursor / OpenCode skill discovery confirmed manually.

---

## 7. Open questions (resolve before P2 starts)

1. **Should composites be in a separate `dero_compose_*` namespace** (clear primitive vs. composite boundary) or share the `dero_*` prefix (simpler agent UX)?
2. **Citation URL format**: link to the bundled docs page id (in-process), or to a stable public URL on a future docs site? Affects whether agents can deep-link for users.
3. **What's the docs index update cadence** after composites depend on specific page ids? Need a version pin (e.g. `docs_index_version: "2026-05-20"`) so composite tests do not silently drift.
4. **Wallet tool tier**: do we ever ship `transfer` / `scinvoke` behind an explicit env flag and per-tool approval, or stay strictly read-only? Affects whether `destructiveHint` annotations need to exist at all.
5. **Where do composites live in CI**: same flow runner as primitives, or a separate `test:composites` script? FNM kept them together; consider the same.

---

## 8. References

- FNM Phase 7 playbook: `/Users/home/projects/docs/AI Agent Ready/remix/14-competitive-mcp-shape-parity-and-composites.md`
- FNM composite contract: `/Users/home/projects/FoodNearMe/apps/web/lib/mcp/tools/COMPOSITES.md`
- FNM description CI guard: `/Users/home/projects/FoodNearMe/apps/web/scripts/check-mcp-descriptions.ts`
- FNM annotations + filtering pattern: `/Users/home/projects/FoodNearMe/apps/web/lib/mcp/server-info.ts`
- Local agent-ready evidence (baseline): `./mcp-agent-ready-evidence.md`
- Existing example flows (composite candidates already prototyped in prose): `./example-agent-flows.md`
- MCP agent-ready checklist (gates 1–7 baseline, 8–14 competitive parity add-on): `/Users/home/projects/docs/AI Agent Ready/remix/13-mcp-agent-ready-playbook.md`

---

## 9. One-paragraph summary

DERO MCP shipped its first **agent-ready** release on 2026-05-24 as `v0.2.1` (npm: `dero-mcp-server@0.2.1`, registry: `io.github.DHEBP/dero-mcp-server@0.2.1` with `isLatest: true`, GitHub Release tagged + published). Four phases are complete: Phase A (annotations + descriptions + description CI guard + citation helper + citation CI guard), Phase B docs (decision boundary + composites design contract), Phase C composites — `diagnose_chain_health`, `explain_smart_contract`, `recommend_docs_path`, `estimate_deploy_cost`, `trace_transaction_with_context`, each shipped as a self-contained commit with green flow tests against the public daemon — and Phase D composite-first agent surface (3 refreshed prompts, 2 new prompts, +1 resource catalog of all composites, version bump, npm + registry publish). The wedge is now live: 5 composites that fuse live chain reads with the bundled docs index, something no generic JSON-RPC client can replicate, available to anyone running `npx -y dero-mcp-server`. Phase E is a future backlog (polish items, Phase E.2/E.3 carry-overs from the legacy P3 list, three candidate new composites, observability/drift guards) and is **gated on observed agent usage** — items only get started when a trigger condition fires, not on a calendar. Skip everything tied to incumbent shape parity, monetization, locale, or routing — those are FNM-specific.

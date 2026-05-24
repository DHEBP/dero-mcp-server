# DERO MCP — Agent Utility Improvements

**Last updated:** 2026-05-23
**Repo:** `DHEBP/dero-mcp-server`
**Audience:** maintainers planning the next utility step beyond the v0.1 agent-ready baseline.
**Source pattern:** Food Near Me Phase 7 — see [`/Users/home/projects/docs/AI Agent Ready/remix/14-competitive-mcp-shape-parity-and-composites.md`](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md) and the FNM composite contract in `FoodNearMe/apps/web/lib/mcp/tools/COMPOSITES.md`.

> **Status:** Phase A (annotations + descriptions + CI guard + citation foundation) and Phase B docs (decision boundary + composites design contract) **shipped 2026-05-23**. Phase C composites #1–#4 (`diagnose_chain_health`, `explain_smart_contract`, `recommend_docs_path`, `estimate_deploy_cost`) also **shipped 2026-05-23** with their flow tests green against the public daemon. See § 5 for current status per item.

> **What this doc is.** A planning artifact tracking which FNM Phase 7 learnings transfer to DERO MCP, which intentionally do not, and a prioritized order for the utility cycle. Use it to scope the next backlog.

> **What this doc is not.** A spec, a contract, or a deprecation notice. The current v0.1 server is already agent-ready (see [`mcp-agent-ready-evidence.md`](./mcp-agent-ready-evidence.md)). This document plans the *next* level of agent utility.

---

## 1. Current state snapshot (v0.1.2)

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
| ⬜ pending | Ship `trace_transaction_with_context` — biggest composite; do last. |

### P3 — Ergonomics + reach

| Status | Item |
|--------|------|
| ⬜ pending | Add `DERO_MCP_ENABLED_TOOLS` runtime filter (§3.6). |
| ⬜ pending | Add input aliases for the top 3 most-called tools (§3.9). |
| ⬜ pending | Add `skills/dero-mcp-server/SKILL.md` (§3.10). |

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

DERO MCP already passes the baseline agent-ready bar (stable contract, smoke probes, flow tests, structured errors). As of 2026-05-23, Phase A (annotations + descriptions + description CI guard + citation helper + citation CI guard) and Phase B docs (decision boundary + composites design contract) are **shipped**. Phase C is the wedge: ship 3–5 composite tools that fuse live chain reads with the bundled docs index — something no generic JSON-RPC client can replicate. Sequence: `diagnose_chain_health` → `explain_smart_contract` → `recommend_docs_path` → `estimate_deploy_cost` → `trace_transaction_with_context`, one self-contained commit to main each, with each implementation gated on its section in [`composites.md`](./composites.md). Skip everything tied to incumbent shape parity, monetization, locale, or routing — those are FNM-specific.

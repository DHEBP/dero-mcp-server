# DERO MCP — Composite Tools Design Contract

**Last updated:** 2026-05-23
**Repo:** `DHEBP/dero-mcp-server`
**Status:** v0.1.x has **4 of 5 composites shipped** (`diagnose_chain_health`, `explain_smart_contract`, `recommend_docs_path`, and `estimate_deploy_cost` — all landed 2026-05-23 with `flow-diagnose-chain-health`, `flow-explain-name-registry`, `flow-recommend-docs-deploy-tela`, `flow-recommend-docs-no-match`, `flow-estimate-deploy-minimal`, and `flow-estimate-deploy-invalid` green against the public daemon). This document remains the design gate every remaining composite MUST satisfy before being committed to main.
**Workflow:** This repo commits directly to main. Each composite is a single self-contained commit (design entry → implementation → flow test → smoke probe wiring → citation map). There is no PR review step; this doc IS the gate.
**Source pattern:** Mirrors Food Near Me's `COMPOSITES.md` discipline ([remix/14](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md) — "Composite design gate"; FNM proof at `FoodNearMe/apps/web/lib/mcp/tools/COMPOSITES.md`).

> **Why this doc exists.** Composites are the wedge — stitching live chain reads to the in-process docs index in ways a generic JSON-RPC client cannot. They are also the most dangerous tools to ship sloppily: they hide several primitives behind one entry point, so a sloppy schema or sequencing assumption silently degrades dozens of agent flows. The discipline that kept FNM's 7f clean was: **design entry committed before any implementation commit**.

---

## Gate

A composite tool MAY be implemented when ALL of the following are true:

1. Its section below exists in this document, already committed to `main`. (Land the design entry as its own commit first if it is not there yet.)
2. The section includes: **input schema**, **internal chain**, **response shape**, **failure modes**, **flow test ID**.
3. Each external primitive the composite calls is already in `src/server.ts` and read-only.
4. The composite uses `readOnly()` for its annotation block.
5. The composite uses `buildDeroCitation()` for any docs link in its response.
6. The composite's commit adds a flow test under `scripts/flow-test.ts` (or a new `scripts/flow-composites.ts`) with the documented flow test ID.
7. The composite's commit adds an entry to `EXPECTED_TOOLS` in `scripts/mcp-smoke-probes.ts` and to `DERO_TOOL_NAMES` via `src/tool-descriptions.ts`.
8. The composite's description passes `npm run check:mcp-descriptions` (four-section template).

A commit that ships a composite without the corresponding section here SHOULD be reverted on main; land the design entry first, then redo the implementation commit.

---

## Wedge test (apply to every candidate)

> Does this composite produce a meaningfully better answer because of DERO's combination of live daemon reads + bundled docs index? If a generic JSON-RPC client could match it, the composite is not worth shipping.

If a candidate fails the wedge test, drop it. Do not ship "convenience composites" that just bundle two primitives; agents can chain those themselves.

---

## Shared utilities

These live in `src/composites/_shared.ts`. Anything reused by more than one composite belongs here. Composite-local helpers (e.g. narrative builders specific to one composite's response shape) live next to that composite, not in `_shared.ts`.

| Utility | Status | Purpose |
|---------|--------|---------|
| `runChain(steps)` | ✅ shipped 2026-05-23 (composite #1) | Sequentially executes named steps and accumulates per-step latency + error context. Required-step failures halt the chain; non-required failures degrade the payload but allow it to continue. |
| `stepValue(chain, name)` | ✅ shipped 2026-05-23 (composite #1) | Extract a single successful step's value from a `ChainResult`. Returns `null` for missing/failed steps. |
| `stepLatencies(chain)` | ✅ shipped 2026-05-23 (composite #1) | Per-step latency map for embedding under a composite's `_diagnostics` field. |
| `attachCitations(payload, toolName)` | ✅ shipped 2026-05-23 (composite #1) | Wraps `relatedDocsFor(toolName)` so every composite emits its citations the same way. |
| `extractScSurface(getScResult)` | ✅ shipped 2026-05-23 (composite #2) | Pure function — derives `{ functions: { name, args, returns }[], stringkeys: string[], uint64keys: string[], balances, raw_code_length, has_code }` from a `DERO.GetSC` response. Sorts string/uint64 keys alphabetically for deterministic output. Tolerant of missing `code`, missing `uint64keys`, and malformed source (returns empty `functions[]` rather than throwing). Ready for reuse by composites #4 and #5. |
| `summarizeChainHealth(info, height, txPool)` | ✅ shipped 2026-05-23 (composite #1) | Lives **inside** `src/composites/diagnose-chain-health.ts`, not `_shared.ts`, because the shape is tightly coupled to composite #1's response and is not reused. Documented here so future contributors know where to find it. |

---

## Composite catalogue

### 1. `diagnose_chain_health` — decorator-style, lowest risk ✅ shipped 2026-05-23

**Status:** Implemented in `src/composites/diagnose-chain-health.ts`. Flow test `flow-diagnose-chain-health` in `scripts/flow-composites.ts` passes against the public daemon (status=`healthy`, 5 signals, ~140-char narrative, 2 citations, ~840ms total). Wired into the CI workflow.

**Wedge:** Replaces four round-trips (ping, info, height, tx_pool) and the user's "what does this field mean?" docs lookup with a single narrative answer + citation.

**Sequencing rule:** SHIP FIRST. Lowest external surface area, no new schemas, decoration of existing primitives only. Proves the composite plumbing (shared utils + flow test pattern + smoke assertions) end-to-end.

**Input schema (Zod):**
```ts
z.object({
  include_tx_pool: z.boolean().optional().describe('Include mempool snapshot in narrative. Default true.'),
})
```

**Internal chain:**
1. `DERO.Ping` (liveness gate; abort with `RPC_UNREACHABLE` on failure)
2. `DERO.GetInfo` (topoheight, stableheight, version, network, difficulty, supply)
3. `DERO.GetHeight` (cross-check tip/stable/topo)
4. `DERO.GetTxPool` (only if `include_tx_pool !== false`)
5. `summarizeChainHealth(info, height, txPool)` → narrative + signals
6. `attachCitations(payload, 'diagnose_chain_health')`

**Response shape:**
```ts
{
  status: 'healthy' | 'lagging' | 'unreachable',
  narrative: string,  // 2–4 sentences, agent-readable
  signals: Array<{ key: string, value: string | number, note?: string }>,
  chain: { topoheight, stableheight, height, network, version, difficulty, total_supply },
  mempool: { pending: number, sample: string[] } | null,
  related_docs: DeroCitation[],
}
```

**Failure modes:**
- Step 1 fails → return `{ status: 'unreachable', narrative, signals: [], chain: null, mempool: null }` and a structured `_meta.error` with `RPC_UNREACHABLE`.
- Steps 2–4 fail → continue with available data, narrative degrades to "partial", signals include `{ key: 'partial', value: failedStep }`.

**Flow test ID:** `flow-diagnose-chain-health`. Asserts non-null `chain.topoheight`, narrative length ≥ 80 chars, `related_docs.length ≥ 1`.

**Related docs to curate in `RELATED_DOCS_BY_TOOL`:**
- `derod` / `basics/daemon` (already curated)
- `derod` / `rpc-api/daemon-rpc-api` (already curated)

---

### 2. `explain_smart_contract` — wedge-defining composite ✅ shipped 2026-05-23

**Status:** Implemented in `src/composites/explain-smart-contract.ts`. Flow test `flow-explain-name-registry` in `scripts/flow-composites.ts` passes against the public daemon (name registry → kind=`registry`, 6 parsed functions, 22,618 live stringkeys, 450-char narrative, 4 citations, heuristic correctly elevates `dvm/smart-contract-fundamentals` as primary). The classifier `classifyContractAndPickDoc` is exported from the composite module so future composites / tests can reuse the kind label without re-parsing.

**Wedge:** Today an agent calls `dero_get_sc`, gets a raw code blob with stringkeys/uint64keys/balances, and must know DVM-BASIC syntax to interpret it. This composite extracts the contract's function surface and stitches it to the right bundled DVM docs page. No generic chain MCP can do this.

**Sequencing rule:** SHIP SECOND. Establishes the SC-introspection pattern that `trace_transaction_with_context` and `estimate_deploy_cost` reuse.

**Input schema (Zod):**
```ts
z.object({
  scid: hex64Schema.describe('64-char hex Smart Contract ID'),
  topoheight: z.number().int().optional().describe('Optional topo height; omit for latest'),
})
```

**Internal chain:**
1. `DERO.GetSC` with `code=true, variables=true`
2. `extractScSurface(scResult)` → `{ functions, stringkeys, uint64keys }`
3. Heuristic: pick the most relevant docs page for the detected surface (e.g. token contract → `dvm/dero-token-creation`, generic SC → `dvm/smart-contract-fundamentals`). Logic lives in a pure function so it is unit-testable.
4. `attachCitations(payload, 'explain_smart_contract')` plus any heuristic-selected page

**Response shape:**
```ts
{
  scid: string,
  topoheight: number,
  surface: {
    functions: Array<{ name: string, args?: string[] }>,
    stringkeys: string[],
    uint64keys: string[],
    balances: Record<string, number | string>,  // asset SCID → balance
  },
  narrative: string,  // 2–4 sentences explaining likely model
  related_docs: DeroCitation[],
  raw_code_length: number,  // hint that full code is available via dero_get_sc
}
```

**Failure modes:**
- `DERO.GetSC` returns no code → `_meta.error` with `SC_NOT_FOUND` (or whatever the daemon surfaces) and an actionable hint pointing at `dero_docs_search("smart contract")`.
- Code present but parse heuristic fails → return surface with `functions: []` and a narrative noting parse-uncertainty. NEVER swallow the raw code; surface `raw_code_length` so the agent knows to fall back to `dero_get_sc`.

**Flow test ID:** `flow-explain-name-registry`. Asserts `scid === NAME_REGISTRY_SCID`, `surface.functions.length ≥ 1`, `related_docs.length ≥ 1`, narrative length ≥ 80.

**Related docs to curate in `RELATED_DOCS_BY_TOOL`:**
- `derod` / `dvm/smart-contract-fundamentals` (already curated)
- `derod` / `dvm/dero-virtual-machine` (already curated)
- `derod` / `dvm/create-deploy-use-smart-contract` (already curated under `dero_get_gas_estimate`)

---

### 3. `recommend_docs_path` — intent → docs bridge ✅ shipped 2026-05-23

**Status:** Implemented in `src/composites/recommend-docs-path.ts`. Flow tests `flow-recommend-docs-deploy-tela` (boost-elevates TELA above other product hits for intent "deploy a TELA app", 8 recommendations, 2 citations) and `flow-recommend-docs-no-match` (nonsense intent → `_meta.error.code = NO_DOCS_MATCH`) both pass against the bundled docs index. `rankRecommendations` is exported from the composite module for reuse / future unit tests.

**Design clarification (recorded in the composite module header):** the design text in step 1 ("for each product, or just `product_hint` if provided") reads like a filter, but step 2's scoring rule ("score × productHintBoost (1.5× for hint matches)") only makes sense if all four products are always searched and the hint is treated as a BIAS, not a FILTER. Treating the hint as a filter would make the boost a uniform no-op. The shipped implementation always searches all four products and applies the 1.5× boost to hint-matching scores. A new classifier branch `NO_DOCS_MATCH` was added to `src/server.ts` to surface the no-match failure mode through the existing `withStructuredErrors` wrapper (consistent with the existing `DOC_NOT_FOUND` pattern).

**Wedge:** Agents currently must guess which docs product to search. This composite takes a natural-language intent, runs scoped searches across all four products, and returns a ranked path with rationale. Useful for one-shot questions before deciding which deeper tool to call.

**Sequencing rule:** SHIP THIRD. Pure docs composition — no chain reads. Proves the "docs-only composite" pattern that future docs-heavy tools can reuse.

**Input schema (Zod):**
```ts
z.object({
  intent: z.string().min(8).describe('Natural-language description of what the user wants to do (e.g. "deploy a TELA app", "trace a transaction by hash", "verify a webhook signature").'),
  product_hint: z.enum(['derod', 'tela', 'hologram', 'deropay']).optional()
    .describe('Optional bias toward one product when known.'),
  limit_per_product: z.number().int().min(1).max(5).optional()
    .describe('Default 2. Cap per-product results to keep the response small.'),
})
```

**Internal chain:**
1. For each product (or just `product_hint` if provided), call `searchDeroDocs({ query: intent, product, limit: limit_per_product ?? 2 })` in parallel.
2. Merge results, score by `score * productHintBoost` (1.5x for `product_hint` matches).
3. Group by product. For each surviving result, derive a one-line rationale (`"Top match for 'deploy a TELA app' under product=tela (score=23). Headings: …"`).
4. Build response.

**Response shape:**
```ts
{
  intent: string,
  recommended: Array<{
    product: 'derod' | 'tela' | 'hologram' | 'deropay',
    slug: string,
    title: string,
    canonical_url: string,
    score: number,
    rationale: string,
  }>,
  by_product: Record<'derod' | 'tela' | 'hologram' | 'deropay', { count: number, top_slug: string | null }>,
  related_docs: DeroCitation[],  // top 2 overall, ready to cite
}
```

**Failure modes:**
- No matches across any product → return `recommended: []`, `by_product` with zero counts, and a `_meta.error` `NO_DOCS_MATCH` hinting the agent to rephrase the intent.

**Flow test ID:** `flow-recommend-docs-deploy-tela`. Asserts at least one TELA recommendation, all entries have valid canonical URLs, no duplicate slugs.

**Related docs to curate in `RELATED_DOCS_BY_TOOL`:** none statically — this composite generates its citations dynamically from the search results.

---

### 4. `estimate_deploy_cost` — numeric pre-flight, ship carefully ✅ shipped 2026-05-23

**Status:** Implemented in `src/composites/estimate-deploy-cost.ts`. Flow tests `flow-estimate-deploy-minimal` (minimal `Initialize() Uint64` source → status=OK, gascompute=5000, gasstorage=1, 1 function detected, 2 citations) and `flow-estimate-deploy-invalid` (malformed source → `_meta.error.code = INVALID_INPUT`, daemon's `RPC error -32098` preserved in `raw`, 306-char hint) both pass against the public daemon. Reuses `extractScSurface` from composite #2 to enrich the response with the parsed function surface, exactly as the shared-utilities table planned. Added an `RPC error -32098` classifier branch to `src/server.ts` so DVM compile failures surface as structured `INVALID_INPUT` (consistent with the existing `-32601` / `-32602` pattern).

**Design clarification (recorded in the composite module header):** the daemon's gas numbers are in atomic "gas units", not DERO. Converting to DERO requires the fee-per-gas table from a separate query and was deliberately not added to this composite to keep its output deterministic and avoid drift if the daemon changes its fee schedule. The breakdown returns the raw units plus an explanatory note; the agent or wallet does the unit conversion when needed. When the daemon returns 0/0 with a non-OK status, the composite returns `breakdown: null` rather than fabricating one — the design contract is explicit on this.

**Wedge:** `dero_get_gas_estimate` returns raw `gascompute` + `gasstorage`. Agents have to know how to interpret those and how to surface them to a user. This composite returns the estimate plus a plain-text breakdown referencing the right docs page.

**Sequencing rule:** SHIP FOURTH. Numeric semantics; needs care around gas calculation drift if the daemon's response shape ever changes. Do not ship before `explain_smart_contract` so the SC-surface extraction is already proven.

**Input schema (Zod):**
```ts
z.object({
  sc: z.string().min(1).describe('DVM-BASIC contract source to deploy. MUST be the contract to deploy (not a function body alone).'),
  signer: deroAddressSchema.optional().describe('Optional dero1.../deto1... signer for the eventual deploy tx.'),
  include_breakdown: z.boolean().optional().describe('Default true. Set false to return raw numbers only.'),
})
```

**Internal chain:**
1. `DERO.GetGasEstimate` with `{ sc, signer? }`.
2. Pure function: convert `gascompute` + `gasstorage` into plain-text breakdown ("`gascompute=X` is the DVM execution cost; `gasstorage=Y` is the on-chain bytes cost").
3. Pull `dvm/create-deploy-use-smart-contract` for citation.

**Response shape:**
```ts
{
  estimate: { gascompute: number, gasstorage: number, status: string },
  breakdown: { compute_note: string, storage_note: string, total_units: number } | null,
  signer_used: string | null,
  related_docs: DeroCitation[],
}
```

**Failure modes:**
- Daemon rejects (invalid `sc` source) → surface its error in `_meta.error` with `code: INVALID_INPUT` and the daemon's hint.
- Daemon returns 0/0 with a status string → return as-is; do NOT fabricate a breakdown.

**Flow test ID:** `flow-estimate-deploy-minimal`. Uses a minimal valid DVM source (e.g. a one-function contract). Asserts non-null `estimate.status`, `breakdown.compute_note` is a non-empty string, citation present.

---

### 5. `trace_transaction_with_context` — biggest composite, ship last

**Wedge:** `dero_get_transaction` returns confirmation + ring + (optional) decoded payload. If the tx invokes an SC, the agent then has to call `dero_get_sc` and figure out which function was called. This composite does both, plus stitches docs context.

**Sequencing rule:** SHIP LAST. Combines `trace` + `explain_smart_contract` patterns. Higher failure-mode count than any other composite — multiple primitives can fail independently.

**Input schema (Zod):**
```ts
z.object({
  tx_hash: hex64Schema.describe('64-char hex transaction hash'),
  decode: z.boolean().optional().describe('Pass decode_as_json=1 to the daemon. Default true.'),
  include_sc_context: z.boolean().optional().describe('Fetch SC surface when tx invokes a contract. Default true.'),
})
```

**Internal chain:**
1. `DERO.GetTransaction` with `txs_hashes=[tx_hash], decode_as_json=decode?1:0`.
2. Extract: confirmation status, block hash, transfers, SC invocations.
3. If `include_sc_context !== false` AND tx contains SC invocations:
   - For each unique SCID, call `DERO.GetSC` with `code=true, variables=false`.
   - Run `extractScSurface` on each.
4. Pull `derod` / `rpc-api/daemon-rpc-api` (tx structure) for citation; if SC context fetched, also add the DVM page.

**Response shape:**
```ts
{
  tx_hash: string,
  confirmation: { status: 'confirmed' | 'mempool' | 'unknown', block_hash: string | null, height: number | null },
  transfers: Array<{ scid: string, amount: number | string, destination?: string }>,
  sc_invocations: Array<{
    scid: string,
    entrypoint: string | null,
    args: unknown[] | null,
    contract_surface: { functions: Array<{ name: string }>, stringkeys: string[] } | null,
  }>,
  narrative: string,  // 2–5 sentences
  related_docs: DeroCitation[],
}
```

**Failure modes:**
- `DERO.GetTransaction` returns empty (tx unknown) → `_meta.error` `TX_NOT_FOUND` with hint to recheck the hash or wait for confirmation.
- Tx found but `DERO.GetSC` fails for one SCID → keep that invocation's `contract_surface: null`, surface a `signals: ['partial']` flag; do NOT abort.

**Flow test ID:** `flow-trace-known-name-registry-call`. Requires a known tx hash; if no fixture available, skip with documented reason. Asserts narrative length ≥ 80, `related_docs.length ≥ 1`.

---

## Sequencing summary (ship order)

| Order | Composite | Status | Why this order |
|------:|-----------|--------|---------------|
| 1 | `diagnose_chain_health` | ✅ shipped 2026-05-23 | Proved composite plumbing with zero new schemas. |
| 2 | `explain_smart_contract` | ✅ shipped 2026-05-23 | Established `extractScSurface` (now in `_shared.ts`) for reuse by composites 4 & 5. |
| 3 | `recommend_docs_path` | ✅ shipped 2026-05-23 | Docs-only composite — independent of chain semantics. Added `NO_DOCS_MATCH` classifier branch. |
| 4 | `estimate_deploy_cost` | ✅ shipped 2026-05-23 | Reused `extractScSurface` for SC enrichment; added `RPC error -32098` → `INVALID_INPUT` classifier branch for DVM compile failures. |
| 5 | `trace_transaction_with_context` | ⬜ pending | Highest fan-out + failure-mode count; ship last. |

One composite per commit. Each commit adds: the section already in this doc (or a small refinement of it) + the implementation + the flow test + the smoke probe entry + the citation map entry. Keep commits small and self-contained so a `git revert` cleanly removes one composite without disturbing the others.

---

## Anti-patterns (rejected designs)

These were considered and rejected. Recording them so future commits do not relitigate:

- **`get_richlist`** — would require either an indexed external service or scanning the chain. Out of scope for v0.1 (violates the read-only-daemon-only boundary).
- **`monitor_address`** — implies long-lived state. MCP tools are request/response; persistence belongs to the host, not the server.
- **`compare_two_contracts`** — pure utility on top of two `dero_get_sc` calls. Agents can chain those themselves; fails the wedge test.
- **`route_tela_dependencies`** — would need TELA-INDEX-1 resolution beyond what `dero_get_sc` exposes. Belongs in a separate TELA-specific MCP server, not here.

---

## References

- Decision boundary (read-only posture): [`docs/decision-boundary.md`](./decision-boundary.md)
- Planning doc (full utility roadmap): [`docs/agent-utility-improvements.md`](./agent-utility-improvements.md)
- Citation helper + curated map: [`src/citations.ts`](../src/citations.ts)
- Description guard: [`scripts/check-mcp-descriptions.ts`](../scripts/check-mcp-descriptions.ts)
- Citation guard: [`scripts/check-citations.ts`](../scripts/check-citations.ts)
- Smoke probes: [`scripts/mcp-smoke-probes.ts`](../scripts/mcp-smoke-probes.ts)
- AI Agent Ready playbook: [`remix/14-competitive-mcp-shape-parity-and-composites.md`](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md)
- FNM composite contract (template): `FoodNearMe/apps/web/lib/mcp/tools/COMPOSITES.md`

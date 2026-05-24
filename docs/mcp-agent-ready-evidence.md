# DERO MCP Agent-Ready Evidence

**Last updated:** 2026-05-23
**Repo:** `DHEBP/dero-mcp-server` (working tree)
**Mode:** Local stdio MCP (read-only daemon access)

---

## One-line verdict

DERO MCP is **agent-ready for local stdio usage with Phase A utility hardening shipped**: 20 tools carry read-only MCP annotations, descriptions follow the agent-instruction template under a CI guard, three primitives emit curated docs citations, and a separate CI guard validates every citation slug against the bundled docs index.

For the planning artifact (Phase A/B/C utility cycle) see [`agent-utility-improvements.md`](./agent-utility-improvements.md). For the read-only posture and gating conditions for moving the boundary see [`decision-boundary.md`](./decision-boundary.md). For the composite-tool design contract see [`composites.md`](./composites.md).

---

## Verified surface

| Primitive | Count | Notes |
|---|---:|---|
| Tools | 25 | 20 daemon-read + bundled-docs primitives plus **all 5 composites** (`diagnose_chain_health`, `explain_smart_contract`, `recommend_docs_path`, `estimate_deploy_cost`, `trace_transaction_with_context`). All carry `readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false`. |
| Resources | 4 | Server info, safety boundary, **composite-aware example flows**, and the new `dero://mcp/composites` catalog that tells agents which composite replaces which primitive chain. |
| Prompts | 5 | Three **refreshed** prompts (`network_health_check`, `inspect_smart_contract`, `trace_transaction`) now call composites first and document primitive fallbacks. Two **new** prompts (`find_dero_docs_for_intent`, `estimate_deploy_for_contract`) drive `recommend_docs_path` and `estimate_deploy_cost` respectively. |
| Curated docs citations | 16 | Across 7 tools (`dero_get_info`, `dero_get_sc`, `dero_get_gas_estimate`, `diagnose_chain_health`, `explain_smart_contract`, `estimate_deploy_cost`, `trace_transaction_with_context`). Validated against the bundled index in CI. `recommend_docs_path` emits dynamic citations from its top search hits (no static curation needed). |
| Composite tools | 5 of 5 ✅ | All Phase C composites shipped 2026-05-23 with green flow tests including failure-mode coverage for `NO_DOCS_MATCH`, `INVALID_INPUT`, and `TX_NOT_FOUND`. Phase C is complete. |

---

## Proof commands and outcomes

### 1) MCP smoke probes

```bash
npm run smoke:mcp
```

Result (latest run, 2026-05-23 after composite #5 — Phase C complete):

- `tools/list` parity: **25**
- Read-only annotations on every tool: **25/25**
- `resources/list` parity: **4**
- `prompts/list` parity: **5**
- `prompts/get` check: **pass**
- `dero_get_info` `related_docs` citation: **2 citations present, both resolve**
- Structured error probe (`_meta.error`): **pass**

### 2) Flow tests

```bash
npm run test:flows
```

Result (latest run):

- **10 passed**
- **0 failed**
- **0 skipped**

### 2a) Composite flow tests

```bash
npm run test:composites
```

Result (latest run, 2026-05-23 after composite #5):

- `flow-diagnose-chain-health` (full + `include_tx_pool=false` variant): **pass**
- `flow-explain-name-registry` (kind=registry, 6 functions, 22618 stringkeys): **pass**
- `flow-recommend-docs-deploy-tela` + `flow-recommend-docs-no-match` (NO_DOCS_MATCH classifier branch): **pass**
- `flow-estimate-deploy-minimal` (full + `include_breakdown=false` variant) + `flow-estimate-deploy-invalid` (INVALID_INPUT for DVM compile error -32098): **pass**
- `flow-trace-known-transfer` (historical tx `22c3813c…b9e8625` at height 3,112,760 — confirmed, ring_groups=1, hex_len=6444): **pass**
- `flow-trace-tx-not-found` (deterministic `deadbeef…deadbeef` → structured `TX_NOT_FOUND`, retryable=true): **pass**
- `flow-trace-sc-install` (env-gated on `DERO_TRACE_SC_TX_HASH`): **skipped** (documented; set the env var to exercise the sc_install branch)

### 3) Daemon connectivity doctor

```bash
npm run doctor
```

Result (latest run):

- TCP reachability: **pass**
- `DERO.Ping`: **pass**
- `DERO.GetInfo`: **pass**

### 4) Build and type safety

```bash
npm run build
npm run typecheck
```

Result (latest run):

- Build: **pass**
- Typecheck: **pass**

---

## Security boundary (explicit)

This MCP server remains **read-only** by design. The full posture and the AND-conditions required to move the boundary (e.g. adding wallet tools) live in [`decision-boundary.md`](./decision-boundary.md).

Excluded methods (v0.1.x):

- Wallet mutation calls (e.g., `transfer`, `scinvoke`)
- `DERO.SendRawTransaction`
- `DERO.SubmitBlock`

Write operations must remain outside this server unless every gating condition in `decision-boundary.md` § "Moving the boundary" is met.

---

## CI gate

Current CI runs (in order):

1. `npm run build`
2. `npm run check:mcp-descriptions` — enforces the four-section agent-instruction template on all 24 tool descriptions.
3. `npm run check:citations` — validates every curated docs citation slug + title resolves against the bundled index.
4. `npm run smoke:mcp` — includes annotation parity assertion and `related_docs` smoke check.
5. `npm run smoke:docs`
6. `npm run test:flows` — raw daemon JSON-RPC flows.
7. `npm run test:composites` — MCP-transport flow tests for composite tools. Each composite added to this repo MUST add its flow test here in the same commit.
8. `tsc --noEmit`

---

## Deferred items

- Wallet-write support (intentionally deferred — see [`decision-boundary.md`](./decision-boundary.md) § "Moving the boundary" for the gating conditions)
- Streamable HTTP/SSE transport (not required for current stdio-first strategy)
- Domain DNS discovery artifacts (`.well-known`, `_mcp`, `_agentroot`, `_llms`) until remote transport exists
- Composite tools — **5 of 5 shipped**. Phase C is complete. Future composite additions must go through the design contract in [`composites.md`](./composites.md) and ship as a self-contained commit to main with description + citation + smoke + flow + CI guards green.
- Runtime tool filtering via `DERO_MCP_ENABLED_TOOLS` env allowlist
- Input ergonomics: camelCase aliases on the top-3 most-called tools

---

## Registry status

Official MCP Registry listing is active for stdio package distribution:

- `io.github.DHEBP/dero-mcp-server`
- Version: `0.1.2` (working tree includes Phase A utility hardening; the next published release will bump accordingly)
- Status: `active`

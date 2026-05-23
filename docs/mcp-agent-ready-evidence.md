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
| Tools | 20 | Daemon reads + bundled docs (`dero_docs_*`, 145 pages). All carry `readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false`. |
| Resources | 3 | Server info, safety boundary, example flows |
| Prompts | 3 | Network health, SC inspection, tx tracing |
| Curated docs citations | 6 | Across 3 primitives (`dero_get_info`, `dero_get_sc`, `dero_get_gas_estimate`). Validated against the bundled index in CI. |
| Composite tools | 0 | Five designed in [`composites.md`](./composites.md); none implemented yet. |

---

## Proof commands and outcomes

### 1) MCP smoke probes

```bash
npm run smoke:mcp
```

Result (latest run, 2026-05-23):

- `tools/list` parity: **20**
- Read-only annotations on every tool: **20/20**
- `resources/list` parity: **3**
- `prompts/list` parity: **3**
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
2. `npm run check:mcp-descriptions` — enforces the four-section agent-instruction template on all 20 tool descriptions.
3. `npm run check:citations` — validates every curated docs citation slug + title resolves against the bundled index.
4. `npm run smoke:mcp` — includes annotation parity assertion and `related_docs` smoke check.
5. `npm run smoke:docs`
6. `npm run test:flows`
7. `tsc --noEmit`

---

## Deferred items

- Wallet-write support (intentionally deferred — see [`decision-boundary.md`](./decision-boundary.md) § "Moving the boundary" for the gating conditions)
- Streamable HTTP/SSE transport (not required for current stdio-first strategy)
- Domain DNS discovery artifacts (`.well-known`, `_mcp`, `_agentroot`, `_llms`) until remote transport exists
- Composite tools (5 designed in [`composites.md`](./composites.md); ship order: `diagnose_chain_health` → `explain_smart_contract` → `recommend_docs_path` → `estimate_deploy_cost` → `trace_transaction_with_context`, one self-contained commit to main each)
- Runtime tool filtering via `DERO_MCP_ENABLED_TOOLS` env allowlist
- Input ergonomics: camelCase aliases on the top-3 most-called tools

---

## Registry status

Official MCP Registry listing is active for stdio package distribution:

- `io.github.DHEBP/dero-mcp-server`
- Version: `0.1.2` (working tree includes Phase A utility hardening; the next published release will bump accordingly)
- Status: `active`

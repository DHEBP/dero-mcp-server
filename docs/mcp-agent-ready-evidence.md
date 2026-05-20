# DERO MCP Agent-Ready Evidence

**Last updated:** 2026-05-19  
**Repo:** `DHEBP/dero-mcp-server` @ `6630dee`  
**Mode:** Local stdio MCP (read-only daemon access)

---

## One-line verdict

DERO MCP is **agent-ready for local stdio usage**: surface contract is stable, diagnostics pass, flow tests pass, and CI now includes MCP smoke probes.

---

## Verified surface

| Primitive | Count | Notes |
|---|---:|---|
| Tools | 17 | Read-only daemon methods only |
| Resources | 3 | Server info, safety boundary, example flows |
| Prompts | 3 | Network health, SC inspection, tx tracing |

---

## Proof commands and outcomes

### 1) MCP smoke probes

```bash
npm run smoke:mcp
```

Result (latest run):

- `tools/list` parity: **17**
- `resources/list` parity: **3**
- `prompts/list` parity: **3**
- `prompts/get` check: **pass**
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

This MCP server remains **read-only** by design.

Excluded methods include:

- Wallet mutation calls (e.g., `transfer`, `scinvoke`)
- `DERO.SendRawTransaction`
- `DERO.SubmitBlock`

Write operations must remain outside this server unless an explicit wallet-write gate policy is introduced.

---

## CI gate

Current CI runs:

1. `npm run build`
2. `npm run smoke:mcp`
3. `npm run test:flows`
4. `tsc --noEmit`

---

## Deferred items

- Wallet-write support (intentionally deferred)
- Streamable HTTP/SSE transport (not required for current stdio-first strategy)
- Domain DNS discovery artifacts (`.well-known`, `_mcp`, `_agentroot`, `_llms`) until remote transport exists

---

## Registry status

Official MCP Registry listing is active for stdio package distribution:

- `io.github.DHEBP/dero-mcp-server`
- Version: `0.1.1`
- Status: `active`

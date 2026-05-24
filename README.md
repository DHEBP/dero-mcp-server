# DERO MCP server

> **Model Context Protocol server for DERO chain inspection** — query daemon state, inspect smart contracts, trace transactions, and run read-only diagnostics from Cursor, OpenCode, Claude Desktop, or any MCP host.

[![MCP Registry](https://img.shields.io/badge/MCP-io.github.DHEBP%2Fdero--mcp--server-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DHEBP/dero-mcp-server)
[![CI](https://github.com/DHEBP/dero-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/DHEBP/dero-mcp-server/actions/workflows/ci.yml)
[![dero-mcp-server MCP server](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server)

**Registry listing:** `io.github.DHEBP/dero-mcp-server` · **Version:** `0.2.2` · **Transport:** `stdio` (npm package)

---

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes **read-only and analysis** calls against a DERO Stargate **daemon** JSON-RPC endpoint. Use it from **Claude Desktop**, **Cursor**, **OpenCode**, or any MCP client that launches a local process over stdio.

## Quick start

### 1. Add this to your MCP host config

```json
{
  "mcpServers": {
    "dero-daemon": {
      "command": "npx",
      "args": ["-y", "dero-mcp-server"],
      "env": {
        "DERO_DAEMON_URL": "http://127.0.0.1:10102"
      }
    }
  }
}
```

Use your own daemon URL when possible. If `DERO_DAEMON_URL` is omitted, the server uses the default public RPC.

### 2. Restart your MCP host

### 3. Try a prompt

> "Check if my DERO node is synced and summarize chain health."

---

## What it does

- Connects to `{DERO_DAEMON_URL}/json_rpc` (default `http://82.65.143.182:10102`).
- Registers one MCP tool per common daemon method (`DERO.GetInfo`, `DERO.GetHeight`, `DERO.GetSC`, etc.).
- Adds bundled docs retrieval tools for `derod`, `tela`, `hologram`, and `deropay` (ships inside the npm package — no local clone required).
- Exposes MCP resources and prompts for consistent investigation workflows.
- Returns JSON results as MCP text content.
- Returns structured tool errors with `_meta.error` (`code`, `hint`, `retryable`) to help agents self-correct.

**Not included (by design in v0.1):** wallet RPC (`transfer`, `scinvoke`), `DERO.SendRawTransaction`, `DERO.SubmitBlock`. Those can move funds or consensus data; add them only with explicit user consent and a locked-down setup.

## Requirements

- Node.js **18+**
- A reachable DERO daemon with RPC enabled (local node or your own remote URL).

## Install & build

```bash
cd dero-mcp-server
npm install
npm run build
```

Run (same default RPC as below if `DERO_DAEMON_URL` is unset):

```bash
node dist/index.js
```

Or set an explicit URL (e.g. your local daemon):

```bash
DERO_DAEMON_URL=http://127.0.0.1:10102 node dist/index.js
```

The baked-in default is a **third-party** public RPC (`82.65.143.182:10102`) — prefer your own node when you run one.

Strip a trailing `/json_rpc` if you paste a full JSON-RPC URL — this server appends `/json_rpc`.

## Claude Desktop (same pattern for OpenCode and Cursor)

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dero-daemon": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/dero-mcp-server/dist/index.js"]
    }
  }
}
```

Optional: add `"env": { "DERO_DAEMON_URL": "http://127.0.0.1:10102" }` if you use a **local** daemon instead of the default public RPC.

Restart Claude Desktop (or your OpenCode/Cursor host).

## Cursor (or OpenCode)

In **Cursor Settings → MCP** (or OpenCode MCP settings), add a server that runs the same `command` / `args` / `env` as above.

## OpenCode

In **OpenCode MCP settings**, add a server with the same `command` / `args` / `env` as above.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DERO_DAEMON_URL` | `http://82.65.143.182:10102` | Daemon **base** URL (no `/json_rpc` required). Set to `http://127.0.0.1:10102` for a local daemon. |
| `DERO_DOCS_ROOT` | bundled index | Optional dev override: path to a local `dero-docs` clone to index live MDX instead of the shipped bundle. |

## Maintainer: bundled docs

Docs tools read from `data/docs-index.json`, committed in this repo and shipped with the npm package. Rebuild the index when [dero-docs](https://github.com/DHEBP/dero-docs) changes:

```bash
npm run release:docs-check
git add data/docs-index.json && git commit -m "Refresh bundled docs index."
```

Or run **Refresh docs bundle** under [Actions](https://github.com/DHEBP/dero-mcp-server/actions/workflows/refresh-docs-bundle.yml) to open a PR. Pushes to `dero-docs` `main` can trigger that workflow via `repository_dispatch` when `MCP_DOCS_SYNC_TOKEN` is configured on the docs repo.

After merging a bundle update: bump the patch version in `package.json` and `server.json`, then `npm publish --otp=...` and `mcp-publisher publish`.

## Testing

```bash
# Check daemon connectivity
npm run doctor

# MCP surface contract checks (tools/resources/prompts + error probe)
npm run smoke:mcp

# Docs retrieval checks (bundled index — no clone required)
npm run smoke:docs

# Run flow tests (10 RPC checks)
npm run test:flows

# Typecheck
npm run typecheck
```

Flow tests run against the default public RPC. Set `DERO_DAEMON_URL` to test against your own daemon.

CI runs on every push and PR — see `.github/workflows/ci.yml`.

## Official MCP Registry

Publish flow (maintainers):

```bash
mcp-publisher validate
mcp-publisher login github
mcp-publisher publish
```

Verify listing:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DHEBP/dero-mcp-server"
```

## MCP Surface

- **Tools (20):** daemon read/analysis methods + docs retrieval (`dero_docs_search`, `dero_docs_get_page`, `dero_docs_list`)
- **Resources (3):** `dero://mcp/server-info`, `dero://mcp/safety-boundary`, `dero://mcp/example-flows`
- **Prompts (3):** `network_health_check`, `inspect_smart_contract`, `trace_transaction`

## Error Contract

When a tool call fails, the server returns a structured error payload in tool content:

```json
{
  "ok": false,
  "tool": "dero_get_sc",
  "_meta": {
    "error": {
      "code": "RPC_UNREACHABLE",
      "hint": "Confirm daemon is running and reachable, then rerun `npm run doctor`.",
      "retryable": true,
      "raw": "fetch failed"
    }
  }
}
```

Common `code` values:

- `INVALID_INPUT`
- `RPC_INVALID_PARAMS`
- `RPC_METHOD_NOT_FOUND`
- `RPC_HTTP_ERROR`
- `RPC_UNREACHABLE`
- `RPC_INVALID_RESPONSE`
- `TOOL_EXECUTION_ERROR`

## Roadmap

- Optional wallet-RPC tools behind `DERO_ENABLE_WALLET_RPC=1` + separate URL.
- Streamable HTTP transport for hosted MCP.
- Stricter typing / OpenAPI-derived tool schemas.

## License

MIT

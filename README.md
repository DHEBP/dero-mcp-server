# DERO MCP server

> **A read-only Model Context Protocol server for the DERO privacy blockchain** — a private-by-default Layer 1 with encrypted balances, private smart contracts (DVM-BASIC), and no public transaction graph. 21 daemon primitives + 7 composite tools, with a bundled documentation index spanning derod, tela, hologram, and deropay.

[![MCP Registry](https://img.shields.io/badge/MCP-io.github.DHEBP%2Fdero--mcp--server-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DHEBP/dero-mcp-server)
[![CI](https://github.com/DHEBP/dero-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/DHEBP/dero-mcp-server/actions/workflows/ci.yml)
[![dero-mcp-server MCP server](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server)

**Registry listing:** `io.github.DHEBP/dero-mcp-server` · **Version:** `0.4.4` · **Transports:** `stdio` (default, npm package) · `streamable-http` (`--http`, for self-hosting)

---

## What is an MCP server

An **MCP server** (Model Context Protocol) is a small program that gives your AI assistant — Claude Desktop, Cursor, OpenCode, ChatGPT with Custom Connectors — the ability to call specific tools on your behalf. Instead of the AI *talking* about DERO from memory, it can actually look things up: fetch a block, read a contract, search the docs, trace a transaction, estimate a deploy.

You install it once and point your AI host at it. From then on, every DERO question you ask in chat hits live chain data and the bundled docs corpus — not the AI's training cutoff.

## What is DERO

If you're new to DERO: it's a privacy-first L1 blockchain — often described as a **private alternative to Ethereum** for builders who want smart contracts without a transparent ledger, or as a **Monero alternative** for users who want account-based privacy with native programmability instead of UTXO-only payments. Homomorphically encrypted balances. Ring signatures hide senders. Zero-knowledge range proofs (Bulletproofs) hide amounts. There is no public transaction graph. The current mainnet is **DERO Stargate**.

Full docs: [derod.org](https://derod.org)

## About this server

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes **read-only and analysis** calls against a DERO Stargate **daemon** JSON-RPC endpoint. Ships as a stdio process for local MCP hosts (Claude Desktop, Cursor, OpenCode) or in **streamable-HTTP** mode behind a domain (e.g. `mcp.derod.org`) for ChatGPT Custom Connectors, Cursor hosted mode, and any agent that needs a remote URL. See [`deploy/`](./deploy/) for a reference self-hosted deployment.

## Quick start

Get a working DERO MCP connection in under 5 minutes.

### What you need

- **Node.js 20+** ([install](https://nodejs.org)) — verify with `node --version`.
- **An MCP host** — Claude Desktop, Cursor, OpenCode, or ChatGPT with Custom Connectors. This walkthrough uses Claude Desktop; the JSON config below works identically in Cursor and OpenCode.
- **Optional:** a local DERO daemon. If one is running on `127.0.0.1:10102`, the server detects and uses it automatically; otherwise it falls back to a public RPC, so it works with zero setup. Run your own for production — [how to](https://derod.org/basics/running-a-node.md).

### 1. Open your MCP host's config

| Host | Where |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | Settings → MCP → Add Server |
| OpenCode | Settings → MCP → Add Server |

Create the file if it doesn't exist.

### 2. Add the DERO MCP server

```json
{
  "mcpServers": {
    "dero-daemon": {
      "command": "npx",
      "args": ["-y", "dero-mcp-server"]
    }
  }
}
```

This uses `npx` to fetch and run the latest published version — no manual install or build required.

The server **auto-detects a local node** at `127.0.0.1:10102`. To pin a specific daemon (custom port or a remote URL), add an `env` block:

```json
"env": { "DERO_DAEMON_URL": "http://127.0.0.1:10102" }
```

### 3. Restart your MCP host

Fully quit and reopen — not just refresh. MCP servers load at startup.

### 4. Verify it works

In a new chat:

> *"What's the current DERO chain height?"*

A number back means you're connected. If you see an error, confirm the config file path is correct and your host was fully restarted (not just refreshed).

Once it's working, jump to [Try a prompt](#try-a-prompt) for a full tour.

---

## What you can do with it

Once installed, your MCP host can do all of these on your behalf — in natural language, no JSON-RPC needed:

- **Inspect the chain** — blocks, transactions, mempool, encrypted balances, registered names
- **Analyze smart contracts** — read code and state, classify the pattern, estimate deploy gas, pull relevant DVM-BASIC docs in one call
- **Trace transactions** — look up any hash, confirm inclusion, classify the kind (transfer / SC install / SC call)
- **Search the docs** — across all four DERO sites (derod, tela, hologram, deropay)
- **Run composite analyses** — chain health, claim audits, docs path recommendations, deploy pre-flights — each returns curated DERO docs citations alongside the data

## Try a prompt

After installing and restarting your MCP host, paste any of these. Start simple and work up.

### Basic

Single-tool questions that verify the install and exercise live queries.

> *"What's the current DERO chain height?"*
>
> *"Resolve the DERO name 'engram' to an address."*
>
> *"Find the documentation page on Bulletproofs."*
>
> *"What does the smart contract at SCID 0000…0001 do?"*

### Intermediate

Composite tools that fan out into multiple primitives and return a synthesized answer with citations.

> *"Explain the smart contract at SCID 0000000000000000000000000000000000000000000000000000000000000001 — what it does, its functions, and which DVM-BASIC docs are relevant."*
>
> *"Trace transaction <hash> with full context — confirmation, classification, and what it touched."*
>
> *"What's the right reading path for someone new to DERO smart contracts who wants to deploy a DVM-BASIC contract?"*
>
> *"Estimate the gas cost to deploy this DVM source: <paste contract>"*

For multi-step agent recipes, per-tool guidance, error contract, and the composite-first rule, see [`SKILL.md`](./SKILL.md).

**Not included (by design):** wallet RPC (`transfer`, `scinvoke`), `DERO.SendRawTransaction`, `DERO.SubmitBlock`. Those can move funds or consensus data; add them only with explicit user consent and a locked-down setup.

## See also

- [`SKILL.md`](./SKILL.md) — per-tool agent runbook: composite-first rule, structured error contract, citation rules, agent-loop recipes, port reference.
- [`POSITIONING.md`](./POSITIONING.md) — who DERO MCP is for, who it isn't, comparison vs ACP / Stripe / Crossmint / Skyfire, privacy posture.

## Requirements

- Node.js **20+**
- A reachable DERO daemon with RPC enabled (local node or your own remote URL).

## Install & build

```bash
cd dero-mcp-server
npm install
npm run build
```

Run (auto-detects a local node at `127.0.0.1:10102`, else public fallback, when `DERO_DAEMON_URL` is unset):

```bash
node dist/index.js
```

Or set an explicit URL (e.g. your local daemon):

```bash
DERO_DAEMON_URL=http://127.0.0.1:10102 node dist/index.js
```

Daemon resolution is **local-first**: with `DERO_DAEMON_URL` unset, the server uses a local node at `127.0.0.1:10102` if it answers, else the baked-in **third-party** public RPC (`82.65.143.182:10102`). Prefer your own node for privacy.

Strip a trailing `/json_rpc` if you paste a full JSON-RPC URL — this server appends `/json_rpc`.

## HTTP mode (self-hosted)

For clients that can't launch a local subprocess — ChatGPT Custom Connectors, Cursor hosted mode, n8n / Zapier integrations — run the server in streamable-HTTP mode and put it behind your own domain:

```bash
DERO_MCP_AUTH_TOKEN=$(openssl rand -base64 48) \
  dero-mcp-server --http
# [dero-mcp-server] HTTP listening on 127.0.0.1:8787 (POST /mcp · GET /health)
```

| Variable | Default | Description |
|---|---|---|
| `DERO_MCP_HTTP` | unset | Set to `1` (or pass `--http`) to start in HTTP mode. |
| `DERO_MCP_HTTP_PORT` | `8787` | Listen port. |
| `DERO_MCP_HTTP_HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` to bind publicly (do not without auth + TLS upstream). |
| `DERO_MCP_AUTH_TOKEN` | unset | If set, every `/mcp` request must carry `Authorization: Bearer <token>`. Constant-time compared. |

For a turnkey deploy with Caddy + auto-TLS + Docker Compose, see [`deploy/README.md`](./deploy/README.md). It's a self-hosting reference for `mcp.derod.org`-style instances — anyone can fork and run their own.

The stdio transport (below) and the HTTP transport share the same underlying server factory, so the tool surface, response shapes, and error codes are identical across both.

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

Optional: add `"env": { "DERO_DAEMON_URL": "http://127.0.0.1:10102" }` to pin a specific daemon. Not needed if your local node uses the default port — the server auto-detects it.

Restart Claude Desktop (or your OpenCode/Cursor host).

## Cursor (or OpenCode)

In **Cursor Settings → MCP** (or OpenCode MCP settings), add a server that runs the same `command` / `args` / `env` as above.

## OpenCode

In **OpenCode MCP settings**, add a server with the same `command` / `args` / `env` as above.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DERO_DAEMON_URL` | *(local-first auto-detect)* | Daemon **base** URL (no `/json_rpc` required). Unset → local node at `127.0.0.1:10102` if reachable, else public fallback (`82.65.143.182:10102`). Set to pin a specific endpoint. |
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

- **Tools (28):** 21 daemon read/analysis primitives + 7 composites, including docs retrieval (`dero_docs_search`, `dero_docs_get_page`, `dero_docs_list`)
- **Resources (4):** `dero://mcp/server-info`, `dero://mcp/safety-boundary`, `dero://mcp/example-flows`, `dero://mcp/composites`
- **Prompts (5):** `network_health_check`, `inspect_smart_contract`, `trace_transaction`, `find_dero_docs_for_intent`, `estimate_deploy_for_contract`

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
- Stricter typing / OpenAPI-derived tool schemas.
- TELA-aware contract tooling (INDEX/DOC inspection, on-chain app discovery).

## License

MIT

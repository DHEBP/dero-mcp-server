# DERO MCP server

[![dero-mcp-server MCP server](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/DHEBP/dero-mcp-server)

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes **read-only and analysis** calls against a DERO Stargate **daemon** JSON-RPC endpoint. Use it from **Claude Desktop**, **Cursor**, or any MCP client that launches a local process over stdio.

## What it does

- Connects to `{DERO_DAEMON_URL}/json_rpc` (default `http://82.65.143.182:10102`).
- Registers one MCP tool per common daemon method (`DERO.GetInfo`, `DERO.GetHeight`, `DERO.GetSC`, etc.).
- Returns JSON results as MCP text content.

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

## Claude Desktop

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

Restart Claude Desktop.

## Cursor

In **Cursor Settings → MCP**, add a server that runs the same `command` / `args` / `env` as above.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DERO_DAEMON_URL` | `http://82.65.143.182:10102` | Daemon **base** URL (no `/json_rpc` required). Set to `http://127.0.0.1:10102` for a local daemon. |

## Roadmap

- Optional wallet-RPC tools behind `DERO_ENABLE_WALLET_RPC=1` + separate URL.
- Streamable HTTP transport for hosted MCP.
- Stricter typing / OpenAPI-derived tool schemas.

## License

MIT

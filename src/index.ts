#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createDeroMcpServer } from './server.js'

/** Default public mainnet JSON-RPC (override with DERO_DAEMON_URL). */
const DEFAULT_DAEMON_BASE = 'http://82.65.143.182:10102'

function daemonUrlFromEnv(): string {
  const fromEnv = process.env.DERO_DAEMON_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/json_rpc\/?$/, '')
  return DEFAULT_DAEMON_BASE
}

async function main() {
  const base = daemonUrlFromEnv()
  const server = createDeroMcpServer(base)

  const transport = new StdioServerTransport()

  process.stderr.write(
    `[dero-mcp-server] DERO_DAEMON_URL base: ${base} (JSON-RPC at ${base.replace(/\/$/, '')}/json_rpc)\n`,
  )

  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[dero-mcp-server] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

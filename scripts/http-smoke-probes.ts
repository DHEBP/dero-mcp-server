#!/usr/bin/env npx tsx
/**
 * HTTP smoke probes — boots dero-mcp-server with --http, exercises the
 * core endpoints, kills the subprocess. Complements scripts/mcp-smoke-probes.ts
 * (which covers the stdio path). Run via `npm run smoke:http`.
 *
 * Checks:
 *   1. /health returns 200 with version + transport=streamable-http
 *   2. 2025 and 2026-07-28 clients see the same tools/resources/prompts
 *   3. POST /mcp without bearer returns 401 when DERO_MCP_AUTH_TOKEN is set
 *   4. Unknown paths return 404
 *
 * No daemon network required for steps 1, 3, 4. Step 2 hits tools/list
 * which doesn't itself call the daemon — only invoking a chain-query
 * tool would, and we don't do that here.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { DERO_PROMPT_NAMES, DERO_RESOURCE_URIS } from '../src/server.js'
import { DERO_TOOL_NAMES } from '../src/tool-descriptions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js')

const PORT = 8788 // off the default 8787 to avoid colliding with an
                  // already-running instance
const HOST = '127.0.0.1'
const AUTH_TOKEN = 'smoke-test-token-do-not-use-in-production'
const BASE_URL = `http://${HOST}:${PORT}`

function assertSortedEqual(actual: string[], expected: readonly string[], label: string): void {
  const a = [...actual].sort()
  const e = [...expected].sort()
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) {
    throw new Error(`${label}: expected ${e.join(', ')}, got ${a.join(', ')}`)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForReady(maxMs = 5000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await sleep(100)
  }
  throw new Error(`HTTP server did not become ready within ${maxMs}ms`)
}

function spawnServer(): ChildProcess {
  const child = spawn('node', [SERVER_ENTRY, '--http'], {
    env: {
      ...process.env,
      DERO_MCP_HTTP_PORT: String(PORT),
      DERO_MCP_HTTP_HOST: HOST,
      DERO_MCP_AUTH_TOKEN: AUTH_TOKEN,
      DERO_DAEMON_URL: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('error', (err) => {
    process.stderr.write(`[smoke:http] failed to spawn server: ${err.message}\n`)
  })
  return child
}

async function checkHealth(): Promise<void> {
  const res = await fetch(`${BASE_URL}/health`)
  if (res.status !== 200) throw new Error(`/health returned ${res.status}, expected 200`)
  const body = (await res.json()) as Record<string, unknown>
  if (body['status'] !== 'ok') throw new Error(`/health status: ${JSON.stringify(body['status'])}`)
  if (body['transport'] !== 'streamable-http') throw new Error(`/health transport: ${JSON.stringify(body['transport'])}`)
  if (typeof body['version'] !== 'string' || !body['version']) throw new Error('/health version missing')
  process.stdout.write(`  ✓ /health → 200 ${JSON.stringify(body)}\n`)
}

async function checkMcpClient(era: 'legacy' | 'modern'): Promise<void> {
  let sawSessionHeader = false
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    authProvider: { token: async () => AUTH_TOKEN },
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      sawSessionHeader ||= response.headers.has('mcp-session-id')
      return response
    },
  })
  const client = new Client(
    { name: `dero-http-${era}-smoke`, version: '1.0.0' },
    era === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : {},
  )

  try {
    await client.connect(transport)
    if (client.getProtocolEra() !== era) {
      throw new Error(`${era} client negotiated ${String(client.getProtocolEra())}`)
    }

    const [tools, resources, prompts] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ])
    assertSortedEqual(tools.tools.map((tool) => tool.name), DERO_TOOL_NAMES, `${era} tools/list`)
    assertSortedEqual(resources.resources.map((resource) => resource.uri), DERO_RESOURCE_URIS, `${era} resources/list`)
    assertSortedEqual(prompts.prompts.map((prompt) => prompt.name), DERO_PROMPT_NAMES, `${era} prompts/list`)

    if (era === 'modern') {
      const parallel = await Promise.all([client.listTools(), client.listTools()])
      for (const result of parallel) {
        assertSortedEqual(result.tools.map((tool) => tool.name), DERO_TOOL_NAMES, 'parallel modern tools/list')
      }
    }
    if (sawSessionHeader) throw new Error(`${era} stateless HTTP response included Mcp-Session-Id`)

    process.stdout.write(
      `  ✓ ${era === 'modern' ? '2026' : '2025'} HTTP client → ${tools.tools.length} tools · ${resources.resources.length} resources · ${prompts.prompts.length} prompts\n`,
    )
  } finally {
    await client.close()
    await transport.close()
  }
}

async function checkAuthEnforced(): Promise<void> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      // No Authorization header
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (res.status !== 401) {
    throw new Error(`/mcp without bearer returned ${res.status}, expected 401`)
  }
  const wwwAuth = res.headers.get('www-authenticate')
  if (!wwwAuth || !wwwAuth.toLowerCase().includes('bearer')) {
    throw new Error(`/mcp 401 missing WWW-Authenticate: Bearer header`)
  }
  process.stdout.write(`  ✓ POST /mcp without bearer → 401 (WWW-Authenticate: ${wwwAuth})\n`)
}

async function checkUnknownPath(): Promise<void> {
  const res = await fetch(`${BASE_URL}/this-path-does-not-exist`)
  if (res.status !== 404) {
    throw new Error(`/this-path-does-not-exist returned ${res.status}, expected 404`)
  }
  process.stdout.write(`  ✓ GET /unknown-path → 404\n`)
}

async function main(): Promise<void> {
  process.stdout.write('[smoke:http] booting dero-mcp-server --http on 127.0.0.1:8788\n')
  const child = spawnServer()
  try {
    await waitForReady()
    await checkHealth()
    await checkMcpClient('legacy')
    await checkMcpClient('modern')
    await checkAuthEnforced()
    await checkUnknownPath()
    process.stdout.write('\n[smoke:http] OK — HTTP transport contract holds.\n')
  } finally {
    child.kill('SIGTERM')
    // Give the child a moment to exit cleanly.
    await sleep(200)
    if (!child.killed) child.kill('SIGKILL')
  }
}

main().catch((err) => {
  process.stderr.write(`\n[smoke:http] FAIL — ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

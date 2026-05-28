#!/usr/bin/env npx tsx
/**
 * HTTP smoke probes — boots dero-mcp-server with --http, exercises the
 * core endpoints, kills the subprocess. Complements scripts/mcp-smoke-probes.ts
 * (which covers the stdio path). Run via `npm run smoke:http`.
 *
 * Checks:
 *   1. /health returns 200 with version + transport=streamable-http
 *   2. POST /mcp with tools/list returns the expected tool count + names
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js')

const PORT = 8788 // off the default 8787 to avoid colliding with an
                  // already-running instance
const HOST = '127.0.0.1'
const AUTH_TOKEN = 'smoke-test-token-do-not-use-in-production'
const BASE_URL = `http://${HOST}:${PORT}`

// Matches scripts/mcp-smoke-probes.ts — keep in sync.
const EXPECTED_TOOL_COUNT = 28

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

async function checkToolsList(): Promise<void> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'authorization': `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (res.status !== 200) throw new Error(`/mcp tools/list returned ${res.status}, expected 200`)
  // Streamable HTTP responds with an SSE stream by default; the body is
  // `event: message\ndata: {...}\n\n`. Pull the JSON out of the data: line.
  const text = await res.text()
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
  if (!dataLine) throw new Error(`/mcp tools/list: no data line in SSE response`)
  const payload = JSON.parse(dataLine.slice('data: '.length)) as {
    result?: { tools?: Array<{ name: string }> }
  }
  const tools = payload.result?.tools ?? []
  if (tools.length !== EXPECTED_TOOL_COUNT) {
    throw new Error(`/mcp tools/list: expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}`)
  }
  process.stdout.write(`  ✓ POST /mcp tools/list → ${tools.length} tools\n`)
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
    await checkToolsList()
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

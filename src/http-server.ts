/**
 * Streamable HTTP transport entry for dero-mcp-server.
 *
 * Same factory (`createDeroMcpServer`) as the stdio entry — just a
 * different transport on top. Enable via `dero-mcp-server --http`
 * or `DERO_MCP_HTTP=1` (see index.ts dispatcher).
 *
 * Stateless by design: each request is independent. No session
 * tracking, no in-memory state across requests, no logs of query
 * payloads. Pairs cleanly with read-only semantics and the
 * privacy-first brand.
 *
 * Environment:
 *   DERO_DAEMON_URL       — JSON-RPC base (default: same as stdio entry)
 *   DERO_MCP_HTTP_PORT    — listen port (default: 8787)
 *   DERO_MCP_HTTP_HOST    — listen address (default: 127.0.0.1)
 *   DERO_MCP_AUTH_TOKEN   — if set, require `Authorization: Bearer <token>`
 *                           on /mcp. Constant-time compared. Recommended
 *                           when binding to a public address; required
 *                           if behind a reverse proxy without its own auth.
 *
 * Routes:
 *   POST /mcp     — MCP streamable HTTP endpoint
 *   GET  /mcp     — same (SSE compat for older clients)
 *   GET  /health  — health check {status, version, daemon_url}
 *   anything else → 404
 *
 * Reverse-proxy expectations:
 *   - TLS handled upstream (Caddy / Cloudflare / etc.) — this server is
 *     plain HTTP.
 *   - Original client IP can be passed via X-Forwarded-For for logging;
 *     we don't log IPs by default but the middleware reads it if present.
 */

import http from 'node:http'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createDeroMcpServer } from './server.js'

const PACKAGE_VERSION = '0.3.0'

function readEnv() {
  const port = Number.parseInt(process.env.DERO_MCP_HTTP_PORT ?? '8787', 10)
  const host = process.env.DERO_MCP_HTTP_HOST ?? '127.0.0.1'
  const authToken = process.env.DERO_MCP_AUTH_TOKEN?.trim() || undefined
  const daemonUrlRaw = process.env.DERO_DAEMON_URL?.trim()
  const daemonUrl = daemonUrlRaw
    ? daemonUrlRaw.replace(/\/json_rpc\/?$/, '')
    : 'http://82.65.143.182:10102'
  return { port, host, authToken, daemonUrl }
}

function isAuthorized(req: http.IncomingMessage, expectedToken: string): boolean {
  const header = req.headers['authorization']
  if (!header || Array.isArray(header)) return false
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (!m) return false
  const given = m[1]!.trim()
  const a = Buffer.from(given)
  const b = Buffer.from(expectedToken)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function send(res: http.ServerResponse, status: number, body: string, contentType = 'application/json'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export async function startHttpServer(): Promise<void> {
  const { port, host, authToken, daemonUrl } = readEnv()
  const mcpServer = createDeroMcpServer(daemonUrl)

  // Stateless mode: no session IDs, no in-memory state across requests.
  // Fits read-only semantics and minimizes the privacy surface.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  await mcpServer.connect(transport)

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (url.pathname === '/health' && req.method === 'GET') {
      send(
        res,
        200,
        JSON.stringify({
          status: 'ok',
          name: 'dero-daemon-mcp',
          version: PACKAGE_VERSION,
          transport: 'streamable-http',
          daemon_url: daemonUrl,
        }),
      )
      return
    }

    if (url.pathname !== '/mcp') {
      send(res, 404, JSON.stringify({ error: 'not_found', message: 'See /mcp for the MCP endpoint, /health for status.' }))
      return
    }

    // Auth (optional but recommended). When DERO_MCP_AUTH_TOKEN is set,
    // every /mcp request must carry Authorization: Bearer <token>.
    if (authToken && !isAuthorized(req, authToken)) {
      res.setHeader('www-authenticate', 'Bearer realm="dero-mcp"')
      send(res, 401, JSON.stringify({ error: 'unauthorized' }))
      return
    }

    try {
      await transport.handleRequest(req, res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[dero-mcp-server] http handler error: ${message}\n`)
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: 'internal_error' }))
      }
    }
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      process.stderr.write(
        `[dero-mcp-server] HTTP listening on ${host}:${port} (POST /mcp · GET /health)\n`,
      )
      process.stderr.write(
        `[dero-mcp-server] daemon: ${daemonUrl} · auth: ${authToken ? 'bearer required' : 'none (do not expose publicly)'}\n`,
      )
      resolve()
    })
  })

  const shutdown = (signal: string) => {
    process.stderr.write(`[dero-mcp-server] ${signal} received, shutting down\n`)
    httpServer.close(() => process.exit(0))
    // Hard exit after 5s if connections won't drain.
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

#!/usr/bin/env npx tsx
/**
 * Drift guard for the dero-mcp-server version pin.
 *
 * The version appears in five places. They MUST agree. This guard
 * reads each and fails non-zero on mismatch — catches the silent drift
 * that happens when one forgets to update e.g. the .env.example after
 * bumping package.json.
 *
 *   1. package.json → version
 *   2. server.json → version
 *   3. server.json → packages[].version (npm registry pin)
 *   4. src/server.ts → version: '...' (two literal refs in the SDK
 *      McpServer + the dero://mcp/server-info resource)
 *   5. src/http-server.ts → PACKAGE_VERSION constant
 *   6. deploy/.env.example → DERO_MCP_VERSION=... default
 *
 * Run via `npm run check:server-json`.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

interface Check {
  file: string
  label: string
  extract: (text: string) => string | undefined
}

const CHECKS: Check[] = [
  {
    file: 'package.json',
    label: 'package.json version',
    extract: (text) => {
      const json = JSON.parse(text) as { version?: string }
      return json.version
    },
  },
  {
    file: 'server.json',
    label: 'server.json version',
    extract: (text) => {
      const json = JSON.parse(text) as { version?: string }
      return json.version
    },
  },
  {
    file: 'server.json',
    label: 'server.json packages[].version',
    extract: (text) => {
      const json = JSON.parse(text) as { packages?: Array<{ version?: string }> }
      return json.packages?.[0]?.version
    },
  },
  {
    file: 'src/server.ts',
    label: 'src/server.ts McpServer version literal',
    extract: (text) => {
      const matches = [...text.matchAll(/version:\s*['"]([\d.]+)['"]/g)]
      // First match — both literal refs should be equal so the first works.
      return matches[0]?.[1]
    },
  },
  {
    file: 'src/http-server.ts',
    label: 'src/http-server.ts PACKAGE_VERSION',
    extract: (text) => {
      const m = text.match(/PACKAGE_VERSION\s*=\s*['"]([\d.]+)['"]/)
      return m?.[1]
    },
  },
  {
    file: 'deploy/.env.example',
    label: 'deploy/.env.example DERO_MCP_VERSION default',
    extract: (text) => {
      const m = text.match(/^DERO_MCP_VERSION=([\d.]+)/m)
      return m?.[1]
    },
  },
]

async function main(): Promise<void> {
  const results: Array<{ check: Check; value: string | undefined; ok: boolean }> = []
  let canonical: string | undefined
  let anyFail = false

  for (const check of CHECKS) {
    const abs = path.join(ROOT, check.file)
    let value: string | undefined
    try {
      const text = await readFile(abs, 'utf-8')
      value = check.extract(text)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[check:server-json] cannot read ${check.file}: ${msg}\n`)
      anyFail = true
      results.push({ check, value: undefined, ok: false })
      continue
    }
    if (!value) {
      process.stderr.write(`[check:server-json] cannot extract version from ${check.file}\n`)
      anyFail = true
      results.push({ check, value: undefined, ok: false })
      continue
    }
    if (canonical === undefined) {
      canonical = value
    }
    results.push({ check, value, ok: value === canonical })
    if (value !== canonical) anyFail = true
  }

  process.stdout.write('[check:server-json] verifying version pin across 6 references...\n\n')
  for (const r of results) {
    const status = r.ok ? '✓' : '✗'
    process.stdout.write(`  ${status} ${(r.check.label).padEnd(48)} ${r.value ?? '(missing)'}\n`)
  }

  if (anyFail) {
    process.stderr.write(`\n[check:server-json] FAIL — version drift. Canonical (first read) is ${canonical}. Update mismatched refs and rerun.\n`)
    process.exit(1)
  }

  process.stdout.write(`\n[check:server-json] OK — all 6 refs agree on ${canonical}.\n`)
}

main().catch((err) => {
  process.stderr.write(`[check:server-json] error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

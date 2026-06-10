#!/usr/bin/env npx tsx
/**
 * Drift guard for the dero-mcp-server version pin AND the published
 * tool/resource/prompt surface counts.
 *
 * The version appears in six places. They MUST agree. This guard
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
 * It also asserts the human-facing surface counts (tools / resources /
 * prompts) in server.json's registry description and README's "MCP Surface"
 * section match the exported source-of-truth arrays — so adding a tool
 * forces the docs to update or CI fails.
 *
 * Run via `npm run check:server-json`.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DERO_TOOL_NAMES } from '../src/tool-descriptions.js'
import { DERO_PROMPT_NAMES, DERO_RESOURCE_URIS } from '../src/server.js'

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

/**
 * Assert the human-facing surface counts in server.json and README match the
 * exported arrays. Returns true on drift (so callers can fail the run).
 */
async function checkSurfaceCounts(): Promise<boolean> {
  const toolCount = DERO_TOOL_NAMES.length
  const resourceCount = DERO_RESOURCE_URIS.length
  const promptCount = DERO_PROMPT_NAMES.length

  const serverJson = await readFile(path.join(ROOT, 'server.json'), 'utf-8')
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf-8')

  type SurfaceCheck = { label: string; ok: boolean; detail: string }
  const checks: SurfaceCheck[] = []

  // server.json description must state the tool count, e.g. "28 tools".
  const descMatch = serverJson.match(/"description":\s*"([^"]*)"/)
  const desc = descMatch?.[1] ?? ''
  // The MCP registry rejects a description over 100 chars with a 422 at publish
  // time (learned the hard way on the 0.4.5 release). Catch it locally instead.
  const REGISTRY_DESC_MAX = 100
  checks.push({
    label: `server.json description ≤ ${REGISTRY_DESC_MAX} chars (MCP registry limit)`,
    ok: desc.length <= REGISTRY_DESC_MAX,
    detail: `description is ${desc.length} chars; the registry rejects > ${REGISTRY_DESC_MAX}`,
  })
  checks.push({
    label: `server.json description states ${toolCount} tools`,
    ok: new RegExp(`\\b${toolCount}\\s+tools\\b`).test(desc),
    detail: `expected "${toolCount} tools" in description`,
  })

  // README "MCP Surface" bullets must state all three counts.
  checks.push({
    label: `README "Tools (${toolCount})"`,
    ok: new RegExp(`\\*\\*Tools \\(${toolCount}\\)`).test(readme),
    detail: `expected "**Tools (${toolCount})" in README MCP Surface`,
  })
  checks.push({
    label: `README "Resources (${resourceCount})"`,
    ok: new RegExp(`\\*\\*Resources \\(${resourceCount}\\)`).test(readme),
    detail: `expected "**Resources (${resourceCount})" in README MCP Surface`,
  })
  checks.push({
    label: `README "Prompts (${promptCount})"`,
    ok: new RegExp(`\\*\\*Prompts \\(${promptCount}\\)`).test(readme),
    detail: `expected "**Prompts (${promptCount})" in README MCP Surface`,
  })

  process.stdout.write('\n[check:server-json] verifying surface counts (tools/resources/prompts)...\n\n')
  let drift = false
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.label.padEnd(48)}${c.ok ? '' : ` — ${c.detail}`}\n`)
    if (!c.ok) drift = true
  }
  return drift
}

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
  }

  const surfaceDrift = await checkSurfaceCounts()
  if (surfaceDrift) {
    process.stderr.write(`\n[check:server-json] FAIL — surface-count drift. Update server.json description / README "MCP Surface" to match the exported tool/resource/prompt arrays.\n`)
  }

  if (anyFail || surfaceDrift) process.exit(1)

  process.stdout.write(`\n[check:server-json] OK — version pin agrees on ${canonical}; surface counts match.\n`)
}

main().catch((err) => {
  process.stderr.write(`[check:server-json] error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

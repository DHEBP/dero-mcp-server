#!/usr/bin/env npx tsx
/**
 * Static guard for MCP tool descriptions.
 *
 * Enforces the agent-instruction template on every tool description in
 * `src/tool-descriptions.ts`:
 *
 *   1. "When to call:" — call timing / sequencing guidance.
 *   2. "Input Requirements" — even for zero-input tools (use "Input Requirements: none.").
 *   3. "Output:" — one-line response shape hint.
 *   4. Minimum length so descriptions cannot regress to one-liners.
 *
 * Runs in-process (no MCP stdio roundtrip) so it is fast enough for CI to
 * execute on every push. If you need to add a tool, update TOOL_DESCRIPTIONS
 * with all four sections before this guard will pass.
 *
 * Exit codes:
 *   0 — every tool description satisfies the template.
 *   1 — one or more descriptions failed; offenders listed on stderr.
 */

import { DERO_TOOL_NAMES, TOOL_DESCRIPTIONS } from '../src/tool-descriptions.js'

const MIN_DESCRIPTION_LENGTH = 200

type Check = {
  id: string
  label: string
  predicate: (description: string) => boolean
}

const CHECKS: readonly Check[] = [
  {
    id: 'call-timing',
    label: 'must include "When to call:"',
    predicate: (d) => /\bWhen to call:/i.test(d),
  },
  {
    id: 'input-requirements',
    label: 'must include "Input Requirements" (use "Input Requirements: none." for zero-input tools)',
    predicate: (d) => /\bInput Requirements\b/i.test(d),
  },
  {
    id: 'output-shape',
    label: 'must include "Output:" line',
    predicate: (d) => /\bOutput:/i.test(d),
  },
  {
    id: 'min-length',
    label: `must be at least ${MIN_DESCRIPTION_LENGTH} chars`,
    predicate: (d) => d.length >= MIN_DESCRIPTION_LENGTH,
  },
]

type Failure = {
  tool: string
  checkId: string
  label: string
  length: number
}

function check(): Failure[] {
  const failures: Failure[] = []
  for (const tool of DERO_TOOL_NAMES) {
    const description = TOOL_DESCRIPTIONS[tool]
    if (typeof description !== 'string') {
      failures.push({
        tool,
        checkId: 'missing',
        label: 'description missing from TOOL_DESCRIPTIONS map',
        length: 0,
      })
      continue
    }
    for (const c of CHECKS) {
      if (!c.predicate(description)) {
        failures.push({ tool, checkId: c.id, label: c.label, length: description.length })
      }
    }
  }
  return failures
}

function main() {
  console.log('[check:mcp-descriptions] checking', DERO_TOOL_NAMES.length, 'tool descriptions')
  const failures = check()

  if (failures.length === 0) {
    console.log(
      `OK  every tool description passes ${CHECKS.length} checks (call-timing, input-requirements, output-shape, min-length ${MIN_DESCRIPTION_LENGTH})`,
    )
    process.exit(0)
  }

  console.error('')
  console.error(`[check:mcp-descriptions] FAIL: ${failures.length} issue(s)`)
  for (const f of failures) {
    console.error(`  - ${f.tool} [${f.checkId}, len=${f.length}]: ${f.label}`)
  }
  console.error('')
  console.error('Fix offending entries in src/tool-descriptions.ts and rerun:')
  console.error('  npm run check:mcp-descriptions')
  process.exit(1)
}

main()

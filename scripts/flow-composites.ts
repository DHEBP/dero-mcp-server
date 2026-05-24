#!/usr/bin/env npx tsx
/**
 * Composite-tool flow tests for DERO MCP server.
 *
 * Unlike `scripts/flow-test.ts` (raw daemon JSON-RPC checks) and
 * `scripts/mcp-smoke-probes.ts` (lightweight MCP contract checks), this
 * runner exercises each composite tool end-to-end via the MCP transport
 * and asserts the documented response shape from `docs/composites.md`.
 *
 * Each composite below has a stable flow test ID documented in its
 * design entry (e.g. `flow-diagnose-chain-health`). New composites
 * MUST add a flow test here as part of the same commit that ships
 * the composite implementation.
 *
 * Usage:
 *   npm run test:composites
 *   npm run test:composites -- --daemon-url=http://127.0.0.1:10102
 *   DERO_DAEMON_URL=http://... npm run test:composites
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const DEFAULT_DAEMON_URL = 'http://82.65.143.182:10102'
const MIN_NARRATIVE_LENGTH = 80
const NAME_REGISTRY_SCID = '0000000000000000000000000000000000000000000000000000000000000001'

function parseArgs(argv: string[]): string {
  let daemonUrl = process.env.DERO_DAEMON_URL ?? DEFAULT_DAEMON_URL
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--daemon-url' || arg === '--url') && argv[i + 1]) {
      daemonUrl = argv[++i]
    } else if (arg.startsWith('--daemon-url=')) {
      daemonUrl = arg.slice('--daemon-url='.length)
    } else if (arg.startsWith('--url=')) {
      daemonUrl = arg.slice('--url='.length)
    }
  }
  return daemonUrl.replace(/\/$/, '')
}

function parseFirstTextJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const textEntry = result.content.find((c) => c.type === 'text' && typeof c.text === 'string')
  if (!textEntry?.text) {
    throw new Error('Tool result missing text content')
  }
  try {
    return JSON.parse(textEntry.text)
  } catch {
    throw new Error('Tool text content is not valid JSON')
  }
}

type Citation = {
  source?: string
  product?: string
  slug?: string
  title?: string
  canonical_url?: string
  page_id?: string
}

type ExplainSmartContractPayload = {
  scid?: string
  topoheight?: number | null
  kind?: 'token' | 'registry' | 'minimal' | 'generic'
  surface?: {
    functions?: Array<{ name: string; args?: string[]; returns?: string }>
    stringkeys?: string[]
    uint64keys?: string[]
    balances?: Record<string, number | string>
  }
  narrative?: string
  raw_code_length?: number
  has_code?: boolean
  related_docs?: Citation[]
}

type DiagnoseChainHealthPayload = {
  status?: 'healthy' | 'lagging' | 'partial' | 'unreachable'
  narrative?: string
  signals?: Array<{ key: string; value: string | number; note?: string }>
  chain?: {
    topoheight?: number
    stableheight?: number | null
    height?: number | null
    network?: string | null
    version?: string | null
  } | null
  mempool?: { pending?: number; sample?: string[] } | null
  related_docs?: Citation[]
  _diagnostics?: {
    step_latency_ms?: Record<string, number>
    total_ms?: number
    halted_at?: string | null
    include_tx_pool?: boolean
  }
}

function assertCitation(cite: Citation, context: string): void {
  if (cite.source !== 'dero_docs') {
    throw new Error(`${context}: citation source !== 'dero_docs'`)
  }
  if (typeof cite.slug !== 'string' || cite.slug.length === 0) {
    throw new Error(`${context}: citation missing slug`)
  }
  if (typeof cite.canonical_url !== 'string' || !cite.canonical_url.startsWith('https://')) {
    throw new Error(`${context}: citation missing/invalid canonical_url`)
  }
  if (typeof cite.title !== 'string' || cite.title.length === 0) {
    throw new Error(`${context}: citation missing title`)
  }
}

/**
 * flow-diagnose-chain-health — `docs/composites.md` § 1.
 *
 * Asserts:
 *  - `chain.topoheight` is a number (DERO.GetInfo succeeded).
 *  - `narrative` length ≥ 80 chars.
 *  - `status` is one of the documented enum values.
 *  - `related_docs.length ≥ 1` and every entry is well-formed.
 *  - `_diagnostics.step_latency_ms` contains per-step latencies.
 *
 * Also runs once with `include_tx_pool: false` to confirm the
 * mempool is skipped (null) and the narrative reflects that.
 */
async function flowDiagnoseChainHealth(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'diagnose_chain_health',
    arguments: {},
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as DiagnoseChainHealthPayload

  if (!payload.chain || typeof payload.chain.topoheight !== 'number') {
    throw new Error('diagnose_chain_health: chain.topoheight missing or non-numeric')
  }
  if (typeof payload.narrative !== 'string' || payload.narrative.length < MIN_NARRATIVE_LENGTH) {
    throw new Error(
      `diagnose_chain_health: narrative too short (${payload.narrative?.length ?? 0} < ${MIN_NARRATIVE_LENGTH})`,
    )
  }
  if (
    payload.status !== 'healthy' &&
    payload.status !== 'lagging' &&
    payload.status !== 'partial'
  ) {
    throw new Error(`diagnose_chain_health: unexpected status "${payload.status}"`)
  }
  if (!Array.isArray(payload.related_docs) || payload.related_docs.length === 0) {
    throw new Error('diagnose_chain_health: related_docs missing or empty')
  }
  for (const cite of payload.related_docs) {
    assertCitation(cite, 'diagnose_chain_health.related_docs')
  }
  if (!payload._diagnostics?.step_latency_ms || typeof payload._diagnostics.total_ms !== 'number') {
    throw new Error('diagnose_chain_health: _diagnostics block missing latencies')
  }
  if (!Array.isArray(payload.signals) || payload.signals.length === 0) {
    throw new Error('diagnose_chain_health: signals[] missing or empty')
  }

  console.log(
    `OK  flow-diagnose-chain-health (status=${payload.status}, signals=${payload.signals.length}, narrative=${payload.narrative.length}ch, citations=${payload.related_docs.length}, total=${payload._diagnostics.total_ms}ms)`,
  )

  const skipMempoolResult = await client.callTool({
    name: 'diagnose_chain_health',
    arguments: { include_tx_pool: false },
  })
  const skipMempoolPayload = parseFirstTextJson(
    skipMempoolResult as { content: Array<{ type: string; text?: string }> },
  ) as DiagnoseChainHealthPayload
  if (skipMempoolPayload.mempool !== null) {
    throw new Error('diagnose_chain_health: include_tx_pool=false should null the mempool field')
  }
  if (skipMempoolPayload._diagnostics?.include_tx_pool !== false) {
    throw new Error(
      'diagnose_chain_health: _diagnostics.include_tx_pool should be false when skipped',
    )
  }
  console.log('OK  flow-diagnose-chain-health (include_tx_pool=false skips mempool)')
}

/**
 * flow-explain-name-registry — `docs/composites.md` § 2.
 *
 * Calls `explain_smart_contract` against the on-chain name registry
 * SCID (`0000…0001`), which is well-known and stable on every DERO
 * network. Asserts the surface extractor parsed at least one Function
 * declaration, the narrative is non-trivial, citations are well-formed,
 * and the heuristic-elevated docs page comes first (registry pattern →
 * `dvm/smart-contract-fundamentals`).
 */
async function flowExplainNameRegistry(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'explain_smart_contract',
    arguments: { scid: NAME_REGISTRY_SCID },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as ExplainSmartContractPayload

  if (payload.scid !== NAME_REGISTRY_SCID) {
    throw new Error(
      `explain_smart_contract: scid round-trip failed (got ${payload.scid ?? '<missing>'})`,
    )
  }
  if (!payload.has_code || typeof payload.raw_code_length !== 'number' || payload.raw_code_length < 100) {
    throw new Error('explain_smart_contract: expected name registry to return non-empty code')
  }
  if (!payload.surface || !Array.isArray(payload.surface.functions)) {
    throw new Error('explain_smart_contract: surface.functions missing')
  }
  if (payload.surface.functions.length < 1) {
    throw new Error('explain_smart_contract: expected ≥ 1 parsed Function on name registry')
  }
  for (const fn of payload.surface.functions) {
    if (!fn.name || typeof fn.name !== 'string') {
      throw new Error('explain_smart_contract: function entry missing name')
    }
    if (!Array.isArray(fn.args)) {
      throw new Error(`explain_smart_contract: function "${fn.name}" missing args array`)
    }
  }
  if (typeof payload.narrative !== 'string' || payload.narrative.length < MIN_NARRATIVE_LENGTH) {
    throw new Error(
      `explain_smart_contract: narrative too short (${payload.narrative?.length ?? 0} < ${MIN_NARRATIVE_LENGTH})`,
    )
  }
  if (payload.kind !== 'token' && payload.kind !== 'registry' && payload.kind !== 'minimal' && payload.kind !== 'generic') {
    throw new Error(`explain_smart_contract: unexpected kind "${payload.kind}"`)
  }
  if (!Array.isArray(payload.related_docs) || payload.related_docs.length === 0) {
    throw new Error('explain_smart_contract: related_docs missing or empty')
  }
  for (const cite of payload.related_docs) {
    assertCitation(cite, 'explain_smart_contract.related_docs')
  }
  // Name registry has Register/Lookup/EXISTS, classifier should pick "registry"
  // and elevate dvm/smart-contract-fundamentals as the primary docs page.
  if (payload.kind !== 'registry') {
    throw new Error(
      `explain_smart_contract: name registry should classify as "registry", got "${payload.kind}"`,
    )
  }
  if (payload.related_docs[0].slug !== 'dvm/smart-contract-fundamentals') {
    throw new Error(
      `explain_smart_contract: registry heuristic should elevate dvm/smart-contract-fundamentals, got "${payload.related_docs[0].slug}"`,
    )
  }

  console.log(
    `OK  flow-explain-name-registry (kind=${payload.kind}, functions=${payload.surface.functions.length}, stringkeys=${payload.surface.stringkeys?.length ?? 0}, narrative=${payload.narrative.length}ch, citations=${payload.related_docs.length}, primary=${payload.related_docs[0].slug})`,
  )
}

async function main(): Promise<void> {
  const daemonUrl = parseArgs(process.argv.slice(2))
  console.log(`[test:composites] daemon=${daemonUrl}`)
  console.log('================================')

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      DERO_DAEMON_URL: daemonUrl,
    } as Record<string, string>,
  })

  const client = new Client({
    name: 'dero-mcp-flow-composites',
    version: '1.0.0',
  })

  try {
    await client.connect(transport)

    await flowDiagnoseChainHealth(client)
    await flowExplainNameRegistry(client)

    console.log('')
    console.log('All composite flow tests passed.')
    process.exit(0)
  } catch (error) {
    console.error('')
    console.error('[test:composites] FAIL:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

main()

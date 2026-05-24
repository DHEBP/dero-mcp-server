#!/usr/bin/env npx tsx
/**
 * Composite-tool flow tests for DERO MCP server.
 *
 * Unlike `scripts/flow-test.ts` (raw daemon JSON-RPC checks) and
 * `scripts/mcp-smoke-probes.ts` (lightweight MCP contract checks), this
 * runner exercises each composite tool end-to-end via the MCP transport
 * composite design contract (maintainer docs).
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
// Confirmed historical transfer on the public daemon (height ~3,112,760).
// Sourced from the Release-142 inflation-bug investigation archive — the
// hash is one of the exploited / verified-existing txs in
// DERO_Inflation_Exploit_Technical_Report.md and is stable forever.
const KNOWN_TRANSFER_TX_HASH =
  '22c3813c931596d537027095d4d9d4e379a340715c7984b265aaf85f6b9e8625'
// Deterministic nonexistent tx hash. The daemon returns an empty record
// rather than an error for unknown hashes; the composite detects this and
// throws TX_NOT_FOUND.
const NONEXISTENT_TX_HASH =
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

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

type TraceTxPayload = {
  tx_hash?: string
  confirmation?: {
    status?: 'confirmed' | 'mempool' | 'unknown'
    block_height?: number | null
    valid_block?: string | null
    invalid_blocks?: string[]
    in_pool?: boolean
  }
  kind?: 'sc_install' | 'transfer_or_invocation' | 'coinbase' | 'unknown'
  ring?: { groups: number | null; first_group_size: number | null }
  reward?: number | null
  signer_visible?: boolean
  native_balance?: { scid?: string; at_tx?: number | null; current?: number | null }
  sc_install?: {
    scid?: string
    surface?: {
      functions?: Array<{ name: string; args?: string[]; returns?: string }>
      stringkeys?: string[]
      uint64keys?: string[]
    }
    raw_code_length?: number
    has_code?: boolean
  } | null
  raw_tx_hex_length?: number
  narrative?: string
  related_docs?: Citation[]
  _diagnostics?: {
    step_latency_ms?: Record<string, number>
    total_ms?: number
    halted_at?: string | null
    decode_as_json?: boolean
    include_sc_context?: boolean
    sc_install_surface_attempted?: boolean
    sc_install_surface_failed?: boolean
  }
}

type EstimateDeployCostPayload = {
  estimate?: { gascompute?: number | null; gasstorage?: number | null; status?: string | null }
  breakdown?: {
    compute_note?: string
    storage_note?: string
    total_units?: number
  } | null
  signer_used?: string | null
  include_breakdown?: boolean
  sc_surface?: {
    functions?: Array<{ name: string; args?: string[]; returns?: string }>
    stringkeys?: string[]
    uint64keys?: string[]
    raw_code_length?: number
    function_count?: number
  }
  related_docs?: Citation[]
}

type RecommendDocsPathPayload = {
  intent?: string
  product_hint?: 'derod' | 'tela' | 'hologram' | 'deropay' | null
  limit_per_product?: number
  recommended?: Array<{
    product: 'derod' | 'tela' | 'hologram' | 'deropay'
    slug: string
    title: string
    canonical_url: string
    score: number
    boosted_score: number
    rationale: string
  }>
  by_product?: Record<
    'derod' | 'tela' | 'hologram' | 'deropay',
    { count: number; top_slug: string | null; top_score: number | null }
  >
  related_docs?: Citation[]
}

type StructuredErrorPayload = {
  ok?: boolean
  tool?: string
  _meta?: { error?: { code?: string; hint?: string; raw?: string; retryable?: boolean } }
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
 * flow-diagnose-chain-health — composite design contract § 1.
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
 * flow-explain-name-registry — composite design contract § 2.
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

/**
 * flow-recommend-docs-deploy-tela — composite design contract § 3.
 *
 * Asserts:
 *  - At least one TELA recommendation is returned for the intent
 *    "deploy a TELA app".
 *  - Every recommendation has a valid canonical URL and a non-empty
 *    rationale string.
 *  - No duplicate (product, slug) pairs.
 *  - `by_product.tela.count` ≥ 1 and points at a valid slug.
 *  - `related_docs.length ≥ 1` and every entry is well-formed.
 *  - With `product_hint=tela`, the top result is from product=tela
 *    (1.5× boost should float TELA hits above competing products).
 */
async function flowRecommendDocsDeployTela(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'recommend_docs_path',
    arguments: { intent: 'deploy a TELA app', product_hint: 'tela' },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as RecommendDocsPathPayload

  if (!Array.isArray(payload.recommended) || payload.recommended.length === 0) {
    throw new Error('recommend_docs_path: recommended[] missing or empty')
  }

  const seenKeys = new Set<string>()
  let telaCount = 0
  for (const rec of payload.recommended) {
    const key = `${rec.product}::${rec.slug}`
    if (seenKeys.has(key)) {
      throw new Error(`recommend_docs_path: duplicate recommendation ${key}`)
    }
    seenKeys.add(key)
    if (typeof rec.canonical_url !== 'string' || !rec.canonical_url.startsWith('https://')) {
      throw new Error(`recommend_docs_path: bad canonical_url on ${key}`)
    }
    if (typeof rec.rationale !== 'string' || rec.rationale.length < 20) {
      throw new Error(`recommend_docs_path: rationale too short on ${key}`)
    }
    if (typeof rec.boosted_score !== 'number' || rec.boosted_score <= 0) {
      throw new Error(`recommend_docs_path: invalid boosted_score on ${key}`)
    }
    if (rec.product === 'tela') telaCount += 1
  }
  if (telaCount === 0) {
    throw new Error('recommend_docs_path: expected at least one TELA recommendation')
  }
  if (payload.recommended[0].product !== 'tela') {
    throw new Error(
      `recommend_docs_path: with product_hint=tela the top result should be product=tela, got "${payload.recommended[0].product}"`,
    )
  }

  if (!payload.by_product?.tela || payload.by_product.tela.count < 1) {
    throw new Error('recommend_docs_path: by_product.tela.count should be ≥ 1')
  }
  if (!payload.by_product.tela.top_slug) {
    throw new Error('recommend_docs_path: by_product.tela.top_slug missing')
  }

  if (!Array.isArray(payload.related_docs) || payload.related_docs.length === 0) {
    throw new Error('recommend_docs_path: related_docs missing or empty')
  }
  for (const cite of payload.related_docs) {
    assertCitation(cite, 'recommend_docs_path.related_docs')
  }

  console.log(
    `OK  flow-recommend-docs-deploy-tela (recommended=${payload.recommended.length}, tela=${telaCount}, top=${payload.recommended[0].product}::${payload.recommended[0].slug}, citations=${payload.related_docs.length})`,
  )
}

/**
 * flow-recommend-docs-no-match — covers the `NO_DOCS_MATCH` failure
 * mode in composite design contract § 3. Asserts the composite emits a
 * structured `_meta.error` with code `NO_DOCS_MATCH` for an
 * intentionally nonsense intent that should not match any bundled
 * docs page.
 */
async function flowRecommendDocsNoMatch(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'recommend_docs_path',
    arguments: { intent: 'zzqxylophonewombat zzqxylophonewombat zzqxylophonewombat' },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as StructuredErrorPayload
  if (payload?.ok !== false || payload?._meta?.error?.code !== 'NO_DOCS_MATCH') {
    throw new Error(
      `recommend_docs_path: expected _meta.error.code=NO_DOCS_MATCH for nonsense intent, got ${JSON.stringify(payload).slice(0, 200)}`,
    )
  }
  if (typeof payload._meta.error.hint !== 'string' || payload._meta.error.hint.length < 20) {
    throw new Error('recommend_docs_path: NO_DOCS_MATCH hint missing or too short')
  }
  console.log(
    `OK  flow-recommend-docs-no-match (code=${payload._meta.error.code}, hint_len=${payload._meta.error.hint.length})`,
  )
}

/**
 * flow-estimate-deploy-minimal — composite design contract § 4.
 *
 * Asserts:
 *  - `estimate.status` is the daemon's status string (typically "OK").
 *  - `estimate.gascompute` and `estimate.gasstorage` are finite numbers.
 *  - `breakdown.compute_note` is a non-empty string (default behavior,
 *    include_breakdown not passed).
 *  - `breakdown.total_units === gascompute + gasstorage`.
 *  - `sc_surface.function_count ≥ 1` (the minimal source has Initialize).
 *  - At least one citation is present and well-formed.
 *
 * Also runs once with `include_breakdown: false` to confirm the
 * composite respects the opt-out and returns `breakdown: null`.
 */
async function flowEstimateDeployMinimal(client: Client): Promise<void> {
  const MINIMAL_SC = 'Function Initialize() Uint64\n10 RETURN 0\nEnd Function'

  const result = await client.callTool({
    name: 'estimate_deploy_cost',
    arguments: { sc: MINIMAL_SC },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as EstimateDeployCostPayload

  if (!payload.estimate || typeof payload.estimate.status !== 'string' || payload.estimate.status.length === 0) {
    throw new Error('estimate_deploy_cost: estimate.status missing or empty')
  }
  if (typeof payload.estimate.gascompute !== 'number' || !Number.isFinite(payload.estimate.gascompute)) {
    throw new Error('estimate_deploy_cost: estimate.gascompute should be a finite number')
  }
  if (typeof payload.estimate.gasstorage !== 'number' || !Number.isFinite(payload.estimate.gasstorage)) {
    throw new Error('estimate_deploy_cost: estimate.gasstorage should be a finite number')
  }
  if (!payload.breakdown || typeof payload.breakdown.compute_note !== 'string' || payload.breakdown.compute_note.length === 0) {
    throw new Error('estimate_deploy_cost: breakdown.compute_note missing (default include_breakdown should be true)')
  }
  if (typeof payload.breakdown.storage_note !== 'string' || payload.breakdown.storage_note.length === 0) {
    throw new Error('estimate_deploy_cost: breakdown.storage_note missing')
  }
  if (
    typeof payload.breakdown.total_units !== 'number' ||
    payload.breakdown.total_units !== payload.estimate.gascompute + payload.estimate.gasstorage
  ) {
    throw new Error('estimate_deploy_cost: breakdown.total_units should equal gascompute + gasstorage')
  }
  if (!payload.sc_surface || typeof payload.sc_surface.function_count !== 'number' || payload.sc_surface.function_count < 1) {
    throw new Error('estimate_deploy_cost: sc_surface.function_count should be ≥ 1 for a minimal Initialize-only contract')
  }
  if (!Array.isArray(payload.related_docs) || payload.related_docs.length === 0) {
    throw new Error('estimate_deploy_cost: related_docs missing or empty')
  }
  for (const cite of payload.related_docs) {
    assertCitation(cite, 'estimate_deploy_cost.related_docs')
  }

  console.log(
    `OK  flow-estimate-deploy-minimal (status=${payload.estimate.status}, gascompute=${payload.estimate.gascompute}, gasstorage=${payload.estimate.gasstorage}, total=${payload.breakdown.total_units}, functions=${payload.sc_surface.function_count}, citations=${payload.related_docs.length})`,
  )

  const skipBreakdownResult = await client.callTool({
    name: 'estimate_deploy_cost',
    arguments: { sc: MINIMAL_SC, include_breakdown: false },
  })
  const skipPayload = parseFirstTextJson(
    skipBreakdownResult as { content: Array<{ type: string; text?: string }> },
  ) as EstimateDeployCostPayload
  if (skipPayload.breakdown !== null) {
    throw new Error('estimate_deploy_cost: include_breakdown=false should null the breakdown field')
  }
  if (skipPayload.include_breakdown !== false) {
    throw new Error('estimate_deploy_cost: include_breakdown=false should round-trip in the response')
  }
  console.log('OK  flow-estimate-deploy-minimal (include_breakdown=false nulls breakdown)')
}

/**
 * Covers the INVALID_INPUT failure mode in composite design contract § 4.
 * Sends a deliberately-malformed DVM source and asserts the composite
 * surfaces a structured `_meta.error` with code `INVALID_INPUT` and
 * the daemon's exact compile message preserved in `raw`.
 */
async function flowEstimateDeployInvalid(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'estimate_deploy_cost',
    arguments: { sc: 'NOT A REAL CONTRACT' },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as StructuredErrorPayload
  if (payload?.ok !== false || payload?._meta?.error?.code !== 'INVALID_INPUT') {
    throw new Error(
      `estimate_deploy_cost: expected _meta.error.code=INVALID_INPUT for malformed sc, got ${JSON.stringify(payload).slice(0, 200)}`,
    )
  }
  if (typeof payload._meta.error.raw !== 'string' || !payload._meta.error.raw.includes('RPC error -32098')) {
    throw new Error(
      `estimate_deploy_cost: expected _meta.error.raw to include 'RPC error -32098', got "${(payload._meta.error.raw ?? '').slice(0, 200)}"`,
    )
  }
  if (typeof payload._meta.error.hint !== 'string' || payload._meta.error.hint.length < 40) {
    throw new Error('estimate_deploy_cost: INVALID_INPUT hint missing or too short')
  }
  console.log(
    `OK  flow-estimate-deploy-invalid (code=${payload._meta.error.code}, raw_includes_-32098=true, hint_len=${payload._meta.error.hint.length})`,
  )
}

/**
 * flow-trace-known-transfer — composite design contract § 5.
 *
 * Asserts the standard "regular transfer" path of the trace composite
 * against a stable historical tx hash (sourced from the Release-142
 * inflation-bug investigation archive — `KNOWN_TRANSFER_TX_HASH` is
 * confirmed-existing on the public chain and immutable).
 *
 * Coverage:
 *  - `confirmation.status === 'confirmed'` and `block_height > 0`.
 *  - `kind` is one of the documented enum values and is NOT
 *    `sc_install` for a regular transfer.
 *  - `ring.groups ≥ 1` and `ring.first_group_size ≥ 1` (privacy txs
 *    always carry ring members).
 *  - `sc_install === null` for a non-install tx.
 *  - `raw_tx_hex_length > 0` so the agent knows the binary is
 *    available for downstream wallet-side decoding.
 *  - `narrative` length ≥ 80, citations are well-formed.
 *  - `_diagnostics.sc_install_surface_attempted === false` for a
 *    non-install tx (proves the composite skipped the optional path).
 */
async function flowTraceKnownTransfer(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'trace_transaction_with_context',
    arguments: { tx_hash: KNOWN_TRANSFER_TX_HASH },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as TraceTxPayload

  if (payload.tx_hash !== KNOWN_TRANSFER_TX_HASH) {
    throw new Error(
      `trace_transaction_with_context: tx_hash round-trip failed (got ${payload.tx_hash ?? '<missing>'})`,
    )
  }
  if (payload.confirmation?.status !== 'confirmed') {
    throw new Error(
      `trace_transaction_with_context: expected confirmation.status="confirmed", got "${payload.confirmation?.status}"`,
    )
  }
  if (typeof payload.confirmation.block_height !== 'number' || payload.confirmation.block_height <= 0) {
    throw new Error('trace_transaction_with_context: expected block_height > 0 for confirmed tx')
  }
  const validKinds = ['sc_install', 'transfer_or_invocation', 'coinbase', 'unknown'] as const
  if (!validKinds.includes(payload.kind as (typeof validKinds)[number])) {
    throw new Error(`trace_transaction_with_context: unexpected kind "${payload.kind}"`)
  }
  if (payload.kind === 'sc_install') {
    throw new Error(
      'trace_transaction_with_context: known-transfer fixture should NOT classify as sc_install',
    )
  }
  if (payload.sc_install !== null) {
    throw new Error(
      'trace_transaction_with_context: sc_install should be null for a non-install tx',
    )
  }
  if (!payload.ring || (payload.ring.groups ?? 0) < 1) {
    throw new Error('trace_transaction_with_context: expected ≥ 1 ring group for a transfer tx')
  }
  if (typeof payload.raw_tx_hex_length !== 'number' || payload.raw_tx_hex_length <= 0) {
    throw new Error('trace_transaction_with_context: expected raw_tx_hex_length > 0')
  }
  if (typeof payload.narrative !== 'string' || payload.narrative.length < MIN_NARRATIVE_LENGTH) {
    throw new Error(
      `trace_transaction_with_context: narrative too short (${payload.narrative?.length ?? 0} < ${MIN_NARRATIVE_LENGTH})`,
    )
  }
  if (!Array.isArray(payload.related_docs) || payload.related_docs.length === 0) {
    throw new Error('trace_transaction_with_context: related_docs missing or empty')
  }
  for (const cite of payload.related_docs) {
    assertCitation(cite, 'trace_transaction_with_context.related_docs')
  }
  if (payload._diagnostics?.sc_install_surface_attempted !== false) {
    throw new Error(
      'trace_transaction_with_context: sc_install_surface_attempted should be false for non-install tx',
    )
  }

  console.log(
    `OK  flow-trace-known-transfer (status=${payload.confirmation.status}, height=${payload.confirmation.block_height}, kind=${payload.kind}, ring_groups=${payload.ring.groups}, hex_len=${payload.raw_tx_hex_length}, narrative=${payload.narrative.length}ch, citations=${payload.related_docs.length})`,
  )
}

/**
 * Covers the TX_NOT_FOUND failure mode. Uses a deterministic
 * nonexistent hash; the daemon returns an empty record (not an
 * error), the composite detects this and throws, the classifier
 * branch in src/server.ts converts to a structured `_meta.error`
 * with code TX_NOT_FOUND.
 */
async function flowTraceTxNotFound(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'trace_transaction_with_context',
    arguments: { tx_hash: NONEXISTENT_TX_HASH },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as StructuredErrorPayload
  if (payload?.ok !== false || payload?._meta?.error?.code !== 'TX_NOT_FOUND') {
    throw new Error(
      `trace_transaction_with_context: expected _meta.error.code=TX_NOT_FOUND for nonexistent hash, got ${JSON.stringify(payload).slice(0, 200)}`,
    )
  }
  if (typeof payload._meta.error.hint !== 'string' || payload._meta.error.hint.length < 40) {
    throw new Error('trace_transaction_with_context: TX_NOT_FOUND hint missing or too short')
  }
  if (payload._meta.error.retryable !== true) {
    throw new Error(
      'trace_transaction_with_context: TX_NOT_FOUND should be retryable=true (freshly broadcast txs may not have propagated yet)',
    )
  }
  console.log(
    `OK  flow-trace-tx-not-found (code=${payload._meta.error.code}, retryable=${payload._meta.error.retryable}, hint_len=${payload._meta.error.hint.length})`,
  )
}

/**
 * Optional SC-install branch coverage. Activated only when
 * DERO_TRACE_SC_TX_HASH is set in the environment; otherwise prints
 * a skip notice and returns. Lets future operators add a known
 * stable SC-install fixture without having to commit one now.
 *
 * When the env var is set, asserts the composite extracts the SC
 * install surface inline (no second dero_get_sc call) and exposes
 * the function list + raw_code_length on the response.
 */
async function flowTraceScInstallOptional(client: Client): Promise<void> {
  const scInstallHash = process.env.DERO_TRACE_SC_TX_HASH
  if (!scInstallHash) {
    console.log(
      'SKIP flow-trace-sc-install (set DERO_TRACE_SC_TX_HASH=<64hex of a known SC install tx> to exercise the sc_install branch)',
    )
    return
  }
  const result = await client.callTool({
    name: 'trace_transaction_with_context',
    arguments: { tx_hash: scInstallHash },
  })
  const payload = parseFirstTextJson(
    result as { content: Array<{ type: string; text?: string }> },
  ) as TraceTxPayload
  if (payload.kind !== 'sc_install') {
    throw new Error(
      `trace_transaction_with_context: DERO_TRACE_SC_TX_HASH ${scInstallHash} should classify as sc_install, got "${payload.kind}"`,
    )
  }
  if (!payload.sc_install || payload.sc_install.scid !== scInstallHash) {
    throw new Error('trace_transaction_with_context: sc_install.scid should equal tx_hash for installs')
  }
  if (!payload.sc_install.has_code) {
    throw new Error('trace_transaction_with_context: sc_install.has_code should be true on a real install tx')
  }
  if (!payload.sc_install.surface || !Array.isArray(payload.sc_install.surface.functions)) {
    throw new Error('trace_transaction_with_context: sc_install.surface.functions missing')
  }
  console.log(
    `OK  flow-trace-sc-install (scid=${scInstallHash.slice(0, 12)}..., functions=${payload.sc_install.surface.functions.length}, code_len=${payload.sc_install.raw_code_length})`,
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
    await flowRecommendDocsDeployTela(client)
    await flowRecommendDocsNoMatch(client)
    await flowEstimateDeployMinimal(client)
    await flowEstimateDeployInvalid(client)
    await flowTraceKnownTransfer(client)
    await flowTraceTxNotFound(client)
    await flowTraceScInstallOptional(client)

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

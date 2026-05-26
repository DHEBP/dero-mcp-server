#!/usr/bin/env npx tsx
/**
 * Lightweight MCP smoke probes for local stdio server contract checks.
 *
 * Verifies:
 * - tools/list count + name parity
 * - every tool carries the read-only annotation block
 * - resources/list count + URI parity
 * - prompts/list count + name parity
 * - prompts/get returns usable messages
 * - structured tool error payload shape on execution failure
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const DEFAULT_DAEMON_URL = 'http://82.65.143.182:10102'
const NAME_REGISTRY_SCID = '0000000000000000000000000000000000000000000000000000000000000001'

const EXPECTED_TOOLS = [
  // ---- Primitives ----
  'dero_daemon_ping',
  'dero_daemon_echo',
  'dero_get_info',
  'dero_get_height',
  'dero_get_block_count',
  'dero_get_last_block_header',
  'dero_get_block',
  'dero_get_block_header_by_topo_height',
  'dero_get_block_header_by_hash',
  'dero_get_tx_pool',
  'dero_get_random_address',
  'dero_get_transaction',
  'dero_get_encrypted_balance',
  'dero_get_sc',
  'dero_get_gas_estimate',
  'dero_name_to_address',
  'dero_get_block_template',
  'dero_decode_proof_string',
  'dero_docs_search',
  'dero_docs_get_page',
  'dero_docs_list',
  // ---- Composites (Phase C) ----
  'diagnose_chain_health',
  'explain_smart_contract',
  'recommend_docs_path',
  'estimate_deploy_cost',
  'trace_transaction_with_context',
  'audit_chain_artifact_claim',
  'dero_forge_demo_proof',
] as const

const EXPECTED_RESOURCES = [
  'dero://mcp/server-info',
  'dero://mcp/safety-boundary',
  'dero://mcp/example-flows',
  'dero://mcp/composites',
] as const

const EXPECTED_PROMPTS = [
  'network_health_check',
  'inspect_smart_contract',
  'trace_transaction',
  'find_dero_docs_for_intent',
  'estimate_deploy_for_contract',
] as const

function parseArgs(argv: string[]) {
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

function assertSortedEqual(actual: string[], expected: readonly string[], label: string) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  if (a.length !== e.length) {
    throw new Error(`${label}: expected ${e.length}, got ${a.length}`)
  }
  for (let i = 0; i < e.length; i++) {
    if (a[i] !== e[i]) {
      throw new Error(`${label} mismatch at ${i}: expected ${e[i]}, got ${a[i]}`)
    }
  }
}

type ToolWithAnnotations = {
  name: string
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

/**
 * Every tool in this server must carry the same read-only annotation block.
 * This lets MCP hosts auto-approve safe calls and prevents future PRs from
 * silently adding wallet/write tools without flipping the annotations.
 */
function assertReadOnlyAnnotations(tools: readonly ToolWithAnnotations[]) {
  const offenders: string[] = []
  for (const tool of tools) {
    const a = tool.annotations
    if (!a) {
      offenders.push(`${tool.name}: missing annotations block`)
      continue
    }
    if (a.readOnlyHint !== true) offenders.push(`${tool.name}: readOnlyHint !== true`)
    if (a.destructiveHint !== false) offenders.push(`${tool.name}: destructiveHint !== false`)
    if (a.idempotentHint !== false) offenders.push(`${tool.name}: idempotentHint !== false`)
    if (a.openWorldHint !== false) offenders.push(`${tool.name}: openWorldHint !== false`)
  }
  if (offenders.length > 0) {
    throw new Error(`annotations: ${offenders.length} tool(s) failed:\n  ${offenders.join('\n  ')}`)
  }
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

async function main() {
  const daemonUrl = parseArgs(process.argv.slice(2))
  console.log(`[smoke:mcp] daemon=${daemonUrl}`)
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
    name: 'dero-mcp-smoke-probes',
    version: '1.0.0',
  })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    const toolNames = tools.tools.map((t) => t.name)
    assertSortedEqual(toolNames, EXPECTED_TOOLS, 'tools/list')
    console.log(`OK  tools/list      ${toolNames.length} tools`)

    assertReadOnlyAnnotations(tools.tools as ToolWithAnnotations[])
    console.log(`OK  tools/list      annotations (read-only) on ${toolNames.length}/${toolNames.length}`)

    const resources = await client.listResources()
    const resourceUris = resources.resources.map((r) => r.uri)
    assertSortedEqual(resourceUris, EXPECTED_RESOURCES, 'resources/list')
    console.log(`OK  resources/list  ${resourceUris.length} resources`)

    const prompts = await client.listPrompts()
    const promptNames = prompts.prompts.map((p) => p.name)
    assertSortedEqual(promptNames, EXPECTED_PROMPTS, 'prompts/list')
    console.log(`OK  prompts/list    ${promptNames.length} prompts`)

    const prompt = await client.getPrompt({
      name: 'inspect_smart_contract',
      arguments: { scid: NAME_REGISTRY_SCID },
    })
    if (!prompt.messages?.length) {
      throw new Error('prompts/get returned zero messages')
    }
    console.log('OK  prompts/get     inspect_smart_contract')

    const infoResult = await client.callTool({
      name: 'dero_get_info',
      arguments: {},
    })
    const infoPayload = parseFirstTextJson(
      infoResult as { content: Array<{ type: string; text?: string }> },
    ) as {
      topoheight?: number
      related_docs?: Array<{ source?: string; slug?: string; canonical_url?: string }>
    }
    if (typeof infoPayload.topoheight !== 'number') {
      throw new Error('dero_get_info did not return a numeric topoheight')
    }
    if (!Array.isArray(infoPayload.related_docs) || infoPayload.related_docs.length === 0) {
      throw new Error('dero_get_info missing related_docs (citation foundation)')
    }
    for (const cite of infoPayload.related_docs) {
      if (
        cite.source !== 'dero_docs' ||
        typeof cite.slug !== 'string' ||
        typeof cite.canonical_url !== 'string'
      ) {
        throw new Error('dero_get_info related_docs entry missing required fields')
      }
    }
    console.log(
      `OK  tools/call      dero_get_info related_docs (${infoPayload.related_docs.length} citation(s))`,
    )

    const structuredErrorProbe = await client.callTool({
      name: 'dero_get_block',
      arguments: {},
    })
    const errorPayload = parseFirstTextJson(structuredErrorProbe as { content: Array<{ type: string; text?: string }> }) as {
      ok?: boolean
      _meta?: { error?: { code?: string; hint?: string; retryable?: boolean } }
    }
    if (
      errorPayload.ok !== false ||
      !errorPayload._meta?.error?.code ||
      typeof errorPayload._meta.error.hint !== 'string' ||
      typeof errorPayload._meta.error.retryable !== 'boolean'
    ) {
      throw new Error('structured error probe did not return expected _meta.error shape')
    }
    console.log('OK  tools/call      structured _meta.error probe')

    console.log('')
    console.log('All MCP smoke probes passed.')
    process.exit(0)
  } catch (error) {
    console.error('')
    console.error('[smoke:mcp] FAIL:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await client.close()
    await transport.close()
  }
}

main()

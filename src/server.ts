import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { deroJsonRpc, jsonRpcEndpoint } from './rpc.js'
import {
  DERO_DOC_PRODUCTS,
  getDeroDocPage,
  listDeroDocs,
  searchDeroDocs,
} from './docs.js'
import { DERO_TOOL_NAMES, TOOL_DESCRIPTIONS } from './tool-descriptions.js'
import { relatedDocsFor } from './citations.js'
import {
  diagnoseChainHealth,
  diagnoseChainHealthInputSchema,
} from './composites/diagnose-chain-health.js'
import {
  explainSmartContract,
  explainSmartContractInputSchema,
} from './composites/explain-smart-contract.js'
import {
  recommendDocsPath,
  recommendDocsPathInputSchema,
} from './composites/recommend-docs-path.js'
import {
  estimateDeployCost,
  estimateDeployCostInputSchema,
} from './composites/estimate-deploy-cost.js'
import {
  traceTransactionWithContext,
  traceTransactionWithContextInputSchema,
} from './composites/trace-transaction-with-context.js'

const scRpcArgSchema = z.object({
  name: z.string(),
  datatype: z.enum(['S', 'U', 'H']),
  value: z.union([z.string(), z.number()]),
})

const hex64Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'Expected 64-character hex string')

const deroAddressSchema = z
  .string()
  .regex(/^(dero1|deto1)[0-9a-z]+$/i, 'Expected DERO address starting with dero1 or deto1')

const NAME_REGISTRY_SCID = '0000000000000000000000000000000000000000000000000000000000000001'

const DERO_RESOURCE_URIS = [
  'dero://mcp/server-info',
  'dero://mcp/safety-boundary',
  'dero://mcp/example-flows',
] as const

const DERO_PROMPT_NAMES = [
  'network_health_check',
  'inspect_smart_contract',
  'trace_transaction',
] as const

const deroDocProductSchema = z.enum(DERO_DOC_PRODUCTS)

function toolText(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  }
}

type StructuredToolError = {
  code: string
  hint: string
  retryable: boolean
}

function classifyToolError(error: unknown): StructuredToolError {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('Provide either hash or height')) {
    return {
      code: 'INVALID_INPUT',
      hint: 'Pass exactly one of "hash" or "height".',
      retryable: false,
    }
  }

  if (
    message.includes('DERO docs unavailable') ||
    message.includes('bundled docs index is missing')
  ) {
    return {
      code: 'DOCS_UNAVAILABLE',
      hint: 'Bundled docs index is missing from this install. Reinstall dero-mcp-server or set DERO_DOCS_ROOT for local dev override.',
      retryable: false,
    }
  }

  if (message.includes('DERO docs search requires a non-empty query')) {
    return {
      code: 'INVALID_INPUT',
      hint: 'Pass a non-empty "query" string for dero_docs_search.',
      retryable: false,
    }
  }

  if (message.includes('DERO docs get page requires a non-empty slug')) {
    return {
      code: 'INVALID_INPUT',
      hint: 'Pass a non-empty "slug" for dero_docs_get_page.',
      retryable: false,
    }
  }

  if (message.includes('Doc page not found')) {
    return {
      code: 'DOC_NOT_FOUND',
      hint: 'Use dero_docs_search or dero_docs_list to discover valid slugs, then retry.',
      retryable: false,
    }
  }

  if (message.includes('No DERO docs matched intent')) {
    return {
      code: 'NO_DOCS_MATCH',
      hint: 'Rephrase the intent (drop verbs, use product nouns like "TELA app" or "DVM contract"), then retry. You can also pass product_hint to bias the search.',
      retryable: false,
    }
  }

  if (message.includes('DERO transaction not found')) {
    return {
      code: 'TX_NOT_FOUND',
      hint: 'The daemon has no record of that tx hash on this chain. Verify the hash is correct (64 hex chars), check whether you queried the right network (mainnet vs testnet), and if the tx is freshly broadcast wait a few seconds for mempool propagation and retry.',
      retryable: true,
    }
  }

  if (message.includes('RPC error -32601')) {
    return {
      code: 'RPC_METHOD_NOT_FOUND',
      hint: 'Your daemon may be outdated or not a Stargate endpoint. Verify DERO_DAEMON_URL.',
      retryable: false,
    }
  }

  if (message.includes('RPC error -32602')) {
    return {
      code: 'RPC_INVALID_PARAMS',
      hint: 'Verify argument names and types for this tool.',
      retryable: false,
    }
  }

  if (message.includes('RPC error -32098')) {
    return {
      code: 'INVALID_INPUT',
      hint: 'The DVM compiler rejected the contract source. Inspect _meta.error.raw for the exact compile error (often points at a line, symbol, or missing keyword). Common causes: missing `End Function`, missing return type (`Uint64`/`String`), unbalanced parens, or sending a function body instead of a full contract.',
      retryable: false,
    }
  }

  const httpMatch = message.match(/HTTP (\d{3})/)
  if (httpMatch) {
    const status = Number(httpMatch[1])
    return {
      code: 'RPC_HTTP_ERROR',
      hint:
        status >= 500
          ? 'Daemon is reachable but errored; retry after checking node health.'
          : 'Check DERO_DAEMON_URL and ensure /json_rpc is accessible.',
      retryable: status >= 500,
    }
  }

  if (
    message.toLowerCase().includes('fetch failed') ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('econnrefused') ||
    message.toLowerCase().includes('aborted')
  ) {
    return {
      code: 'RPC_UNREACHABLE',
      hint: 'Confirm daemon is running and reachable, then rerun `npm run doctor`.',
      retryable: true,
    }
  }

  if (message.includes('Invalid JSON from node')) {
    return {
      code: 'RPC_INVALID_RESPONSE',
      hint: 'Daemon returned malformed JSON. Check reverse proxies or node health.',
      retryable: true,
    }
  }

  return {
    code: 'TOOL_EXECUTION_ERROR',
    hint: 'Retry once, then inspect daemon logs and tool input values.',
    retryable: false,
  }
}

function toolError(tool: string, error: unknown) {
  const structured = classifyToolError(error)
  const raw = error instanceof Error ? error.message : String(error)
  return toolText({
    ok: false,
    tool,
    _meta: {
      error: {
        ...structured,
        raw,
      },
    },
  })
}

function withStructuredErrors<TArgs extends Record<string, unknown> | undefined>(
  tool: string,
  handler: (args: TArgs) => Promise<unknown>,
) {
  return async (args: TArgs) => {
    try {
      return toolText(await handler(args))
    } catch (error) {
      return toolError(tool, error)
    }
  }
}

/**
 * MCP tool annotation hint block applied to every tool in this server.
 *
 * - `readOnlyHint: true` lets MCP hosts (Cursor, Claude Desktop, OpenCode)
 *   auto-approve calls without per-invocation confirmation.
 * - `destructiveHint: false` makes the read-only promise explicit so hosts
 *   render a safe-call badge.
 * - `idempotentHint: false` because chain state advances between calls —
 *   identical inputs may return different blocks/heights/tx pools.
 * - `openWorldHint: false` because we hit a configured daemon endpoint only,
 *   not arbitrary external services.
 *
 * Any future wallet/write tools MUST use a different annotation block
 * (`readOnlyHint: false`, `destructiveHint: true`) and remain require-approval.
 */
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

/**
 * Helper that tags a tool config with the read-only annotation block.
 * Use for every primitive in this v0.1 server. Composites built on these
 * primitives are also read-only and should use this same helper.
 */
function readOnly<T extends Record<string, unknown>>(
  config: T,
): T & { annotations: typeof READ_ONLY_ANNOTATIONS } {
  return { ...config, annotations: READ_ONLY_ANNOTATIONS }
}

export function createDeroMcpServer(daemonBaseUrl: string): McpServer {
  const endpoint = jsonRpcEndpoint(daemonBaseUrl)
  const rpc = async <T>(method: string, params?: unknown) =>
    deroJsonRpc<T>(endpoint, method, params)
  const server = new McpServer({
    name: 'dero-daemon-mcp',
    version: '0.1.2',
  })

  server.registerTool(
    'dero_daemon_ping',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_daemon_ping,
    }),
    withStructuredErrors('dero_daemon_ping', async () => rpc<string>('DERO.Ping')),
  )

  server.registerTool(
    'dero_daemon_echo',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_daemon_echo,
      inputSchema: {
        words: z.array(z.string()).describe('Strings to echo back'),
      },
    }),
    withStructuredErrors('dero_daemon_echo', async ({ words }) => rpc<string>('DERO.Echo', words)),
  )

  server.registerTool(
    'dero_get_info',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_info,
    }),
    withStructuredErrors('dero_get_info', async () => {
      const result = (await rpc<Record<string, unknown>>('DERO.GetInfo')) ?? {}
      const related_docs = relatedDocsFor('dero_get_info')
      return { ...result, ...(related_docs ? { related_docs } : {}) }
    }),
  )

  server.registerTool(
    'dero_get_height',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_height,
    }),
    withStructuredErrors('dero_get_height', async () => rpc('DERO.GetHeight')),
  )

  server.registerTool(
    'dero_get_block_count',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_block_count,
    }),
    withStructuredErrors('dero_get_block_count', async () => rpc('DERO.GetBlockCount')),
  )

  server.registerTool(
    'dero_get_last_block_header',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_last_block_header,
    }),
    withStructuredErrors('dero_get_last_block_header', async () => rpc('DERO.GetLastBlockHeader')),
  )

  server.registerTool(
    'dero_get_block',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_block,
      inputSchema: {
        hash: hex64Schema
          .optional()
          .describe('64-char hex block hash'),
        height: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Block height'),
      },
    }),
    withStructuredErrors('dero_get_block', async (args) => {
      if (!args.hash && args.height === undefined) {
        throw new Error('Provide either hash or height')
      }
      const params: Record<string, unknown> = {}
      if (args.hash) params.hash = args.hash
      if (args.height !== undefined) params.height = args.height
      return rpc('DERO.GetBlock', params)
    }),
  )

  server.registerTool(
    'dero_get_block_header_by_topo_height',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_block_header_by_topo_height,
      inputSchema: {
        topoheight: z
          .number()
          .int()
          .nonnegative()
          .describe('Topological height'),
      },
    }),
    withStructuredErrors('dero_get_block_header_by_topo_height', async ({ topoheight }) =>
      rpc('DERO.GetBlockHeaderByTopoHeight', { topoheight })),
  )

  server.registerTool(
    'dero_get_block_header_by_hash',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_block_header_by_hash,
      inputSchema: {
        hash: hex64Schema.describe('Block top hash (hex)'),
      },
    }),
    withStructuredErrors('dero_get_block_header_by_hash', async ({ hash }) =>
      rpc('DERO.GetBlockHeaderByHash', { hash })),
  )

  server.registerTool(
    'dero_get_tx_pool',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_tx_pool,
    }),
    withStructuredErrors('dero_get_tx_pool', async () => rpc('DERO.GetTxPool')),
  )

  server.registerTool(
    'dero_get_random_address',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_random_address,
      inputSchema: {
        scid: hex64Schema
          .optional()
          .describe('Optional asset smart-contract id (hex)'),
      },
    }),
    withStructuredErrors('dero_get_random_address', async (args) =>
      rpc(
        'DERO.GetRandomAddress',
        args.scid != null ? { scid: args.scid } : undefined,
      )),
  )

  server.registerTool(
    'dero_get_transaction',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_transaction,
      inputSchema: {
        txs_hashes: z
          .array(hex64Schema)
          .min(1)
          .describe('List of transaction hashes (hex)'),
        decode_as_json: z
          .number()
          .int()
          .optional()
          .describe('Optional: decode each tx as JSON when non-zero'),
      },
    }),
    withStructuredErrors('dero_get_transaction', async ({ txs_hashes, decode_as_json }) => {
      const params: Record<string, unknown> = { txs_hashes }
      if (decode_as_json !== undefined) params.decode_as_json = decode_as_json
      return rpc('DERO.GetTransaction', params)
    }),
  )

  server.registerTool(
    'dero_get_encrypted_balance',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_encrypted_balance,
      inputSchema: {
        address: deroAddressSchema.describe('DERO address (dero1… or deto1…)'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest chain tip'),
        scid: hex64Schema.optional().describe('Asset SCID hex; omit for native DERO'),
      },
    }),
    withStructuredErrors('dero_get_encrypted_balance', async ({ address, topoheight, scid }) => {
      const params: Record<string, unknown> = { address, topoheight }
      if (scid) params.scid = scid
      return rpc('DERO.GetEncryptedBalance', params)
    }),
  )

  server.registerTool(
    'dero_get_sc',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_sc,
      inputSchema: {
        scid: hex64Schema.describe('64-char hex Smart Contract ID'),
        code: z
          .boolean()
          .optional()
          .describe('Include contract source (default true)'),
        variables: z
          .boolean()
          .optional()
          .describe('Include stored variables (default true)'),
        topoheight: z
          .number()
          .int()
          .optional()
          .describe('Topo height; omit or use -1 for latest'),
      },
    }),
    withStructuredErrors('dero_get_sc', async ({ scid, code, variables, topoheight }) => {
      const params: Record<string, unknown> = {
        scid,
        code: code ?? true,
        variables: variables ?? true,
      }
      if (topoheight !== undefined) params.topoheight = topoheight
      const result = (await rpc<Record<string, unknown>>('DERO.GetSC', params)) ?? {}
      const related_docs = relatedDocsFor('dero_get_sc')
      return { ...result, ...(related_docs ? { related_docs } : {}) }
    }),
  )

  server.registerTool(
    'dero_get_gas_estimate',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_gas_estimate,
      inputSchema: {
        transfers: z
          .array(z.record(z.unknown()))
          .optional()
          .describe('Optional transfer list'),
        sc: z.string().optional().describe('SC source to deploy'),
        sc_rpc: z
          .array(scRpcArgSchema)
          .optional()
          .describe('SC invocation arguments (entrypoint, SC_ID, etc.)'),
        signer: z
          .string()
          .optional()
          .describe('Signer address used for estimation'),
      },
    }),
    withStructuredErrors('dero_get_gas_estimate', async (args) => {
      const params: Record<string, unknown> = {}
      if (args.transfers) params.transfers = args.transfers
      if (args.sc) params.sc = args.sc
      if (args.sc_rpc) params.sc_rpc = args.sc_rpc
      if (args.signer) params.signer = args.signer
      const result = (await rpc<Record<string, unknown>>('DERO.GetGasEstimate', params)) ?? {}
      const related_docs = relatedDocsFor('dero_get_gas_estimate')
      return { ...result, ...(related_docs ? { related_docs } : {}) }
    }),
  )

  server.registerTool(
    'dero_name_to_address',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_name_to_address,
      inputSchema: {
        name: z.string().min(1).describe('Registered name'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest'),
      },
    }),
    withStructuredErrors('dero_name_to_address', async ({ name, topoheight }) =>
      rpc('DERO.NameToAddress', { name, topoheight })),
  )

  server.registerTool(
    'dero_get_block_template',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_get_block_template,
      inputSchema: {
        wallet_address: deroAddressSchema.describe('Miner payout DERO address'),
        block: z
          .boolean()
          .optional()
          .describe('Include block blob'),
        miner: z.string().optional().describe('Optional miner id / label'),
      },
    }),
    withStructuredErrors('dero_get_block_template', async ({ wallet_address, block, miner }) => {
      const params: Record<string, unknown> = { wallet_address }
      if (block !== undefined) params.block = block
      if (miner) params.miner = miner
      return rpc('DERO.GetBlockTemplate', params)
    }),
  )

  server.registerTool(
    'dero_docs_search',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_docs_search,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Search text (e.g., "wallet rpc", "tela deployment", "deropay webhooks")'),
        product: deroDocProductSchema
          .optional()
          .describe('Optional docs product filter: derod | tela | hologram | deropay'),
        section: z
          .string()
          .optional()
          .describe('Optional section slug prefix (e.g., "rpc-api", "guides", "dero-pay")'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('Max matches (default 8, max 25)'),
      },
    }),
    withStructuredErrors('dero_docs_search', async ({ query, product, section, limit }) =>
      searchDeroDocs({ query, product, section, limit })),
  )

  server.registerTool(
    'dero_docs_get_page',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_docs_get_page,
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .describe(
            'Doc slug relative to pages/ (e.g., "rpc-api/daemon-rpc-api", "tutorials/first-app", "dero-pay/quick-start")',
          ),
        product: deroDocProductSchema
          .optional()
          .describe('Optional product scope to disambiguate duplicate slugs'),
      },
    }),
    withStructuredErrors('dero_docs_get_page', async ({ slug, product }) =>
      getDeroDocPage({ slug, product })),
  )

  server.registerTool(
    'dero_docs_list',
    readOnly({
      description: TOOL_DESCRIPTIONS.dero_docs_list,
      inputSchema: {
        product: deroDocProductSchema
          .optional()
          .describe('Optional docs product filter: derod | tela | hologram | deropay'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Max pages returned (default 120, max 500)'),
      },
    }),
    withStructuredErrors('dero_docs_list', async ({ product, limit }) => {
      const docsIndex = await listDeroDocs(product)
      const capped = Math.max(1, Math.min(limit ?? 120, 500))
      return {
        ...docsIndex,
        returned: Math.min(capped, docsIndex.pages.length),
        pages: docsIndex.pages.slice(0, capped),
      }
    }),
  )

  // ---------- Composite tools (Phase C) ----------
  // Composites chain read-only primitives and bundled docs into
  // intent-shaped responses. Each composite has a design entry in
  // `docs/composites.md` that pins its input schema, internal chain,
  // response shape, failure modes, and flow test ID.

  server.registerTool(
    'diagnose_chain_health',
    readOnly({
      description: TOOL_DESCRIPTIONS.diagnose_chain_health,
      inputSchema: diagnoseChainHealthInputSchema,
    }),
    withStructuredErrors('diagnose_chain_health', async (args) =>
      diagnoseChainHealth(rpc, args ?? {}),
    ),
  )

  server.registerTool(
    'explain_smart_contract',
    readOnly({
      description: TOOL_DESCRIPTIONS.explain_smart_contract,
      inputSchema: explainSmartContractInputSchema,
    }),
    withStructuredErrors('explain_smart_contract', async (args) =>
      explainSmartContract(rpc, args),
    ),
  )

  server.registerTool(
    'recommend_docs_path',
    readOnly({
      description: TOOL_DESCRIPTIONS.recommend_docs_path,
      inputSchema: recommendDocsPathInputSchema,
    }),
    withStructuredErrors('recommend_docs_path', async (args) => recommendDocsPath(args)),
  )

  server.registerTool(
    'estimate_deploy_cost',
    readOnly({
      description: TOOL_DESCRIPTIONS.estimate_deploy_cost,
      inputSchema: estimateDeployCostInputSchema,
    }),
    withStructuredErrors('estimate_deploy_cost', async (args) => estimateDeployCost(rpc, args)),
  )

  server.registerTool(
    'trace_transaction_with_context',
    readOnly({
      description: TOOL_DESCRIPTIONS.trace_transaction_with_context,
      inputSchema: traceTransactionWithContextInputSchema,
    }),
    withStructuredErrors('trace_transaction_with_context', async (args) =>
      traceTransactionWithContext(rpc, args),
    ),
  )

  server.registerResource(
    'dero_mcp_server_info',
    'dero://mcp/server-info',
    {
      description: 'Server metadata, tool list, resource list, and prompt names.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'dero-daemon-mcp',
              version: '0.1.2',
              mode: 'read-only',
              endpoint: endpoint,
              docs_products: DERO_DOC_PRODUCTS,
              docs_delivery: 'bundled-index',
              docs_dev_override_env: 'DERO_DOCS_ROOT',
              tools: DERO_TOOL_NAMES,
              resources: DERO_RESOURCE_URIS,
              prompts: DERO_PROMPT_NAMES,
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'dero_mcp_safety_boundary',
    'dero://mcp/safety-boundary',
    {
      description: 'Explicit read-only safety boundaries and escalation guidance for write actions.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              read_only: true,
              excluded_methods: [
                'transfer',
                'scinvoke',
                'DERO.SendRawTransaction',
                'DERO.SubmitBlock',
              ],
              reasoning: 'These methods can move funds or mutate chain state.',
              write_path: [
                'Use wallet RPC tooling (curl/XSWD/Engram) for writes.',
                'Use dero-mcp-server for live chain reads and analysis.',
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'dero_mcp_example_flows',
    'dero://mcp/example-flows',
    {
      description: 'Compact agent flow recipes for common DERO investigations.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: [
            '# DERO MCP Example Flows',
            '',
            '- Network health: `dero_daemon_ping` -> `dero_get_info` -> `dero_get_height`',
            `- Inspect SC state: \`dero_get_sc\` with SCID (name registry: \`${NAME_REGISTRY_SCID}\`)`,
            '- Trace transaction: `dero_get_transaction` with `decode_as_json: 1`',
            '- Read-only boundary: no wallet writes or raw tx submission',
          ].join('\n'),
        },
      ],
    }),
  )

  server.registerPrompt(
    'network_health_check',
    {
      description: 'Guide the model through a DERO daemon sync and health check sequence.',
      argsSchema: {
        reference_topoheight: z
          .number()
          .int()
          .positive()
          .optional(),
      },
    },
    async ({ reference_topoheight }) => ({
      description: 'Prompt for sync health investigation.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Check DERO daemon health using MCP tools.',
              '1) Call dero_daemon_ping.',
              '2) Call dero_get_info and dero_get_height.',
              '3) Report topoheight, stableheight, version, and network.',
              reference_topoheight
                ? `4) Compare topoheight against reference_topoheight=${reference_topoheight}.`
                : '4) If no reference topoheight is provided, state that external comparison is still needed for final sync confidence.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'inspect_smart_contract',
    {
      description: 'Inspect contract code/variables and explain likely state model.',
      argsSchema: {
        scid: hex64Schema,
      },
    },
    async ({ scid }) => ({
      description: 'Prompt for smart contract inspection.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Inspect DERO smart contract ${scid}.`,
              '1) Call dero_get_sc with variables=true and code=true.',
              '2) Summarize key stringkeys and balances.',
              '3) Explain likely data model and any assumptions.',
              '4) Include topoheight context from response.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'trace_transaction',
    {
      description: 'Trace one transaction and summarize confirmation + SC activity.',
      argsSchema: {
        tx_hash: hex64Schema,
      },
    },
    async ({ tx_hash }) => ({
      description: 'Prompt for transaction tracing.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Trace DERO transaction ${tx_hash}.`,
              '1) Call dero_get_transaction with txs_hashes=[tx_hash] and decode_as_json=1.',
              '2) Summarize confirmation status, block height, transfers, and SC invokes.',
              '3) If not confirmed, mention mempool status uncertainty and next check timing.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  return server
}

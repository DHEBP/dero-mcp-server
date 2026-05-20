import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { deroJsonRpc, jsonRpcEndpoint } from './rpc.js'

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

const DERO_TOOL_NAMES = [
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
] as const

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

export function createDeroMcpServer(daemonBaseUrl: string): McpServer {
  const endpoint = jsonRpcEndpoint(daemonBaseUrl)
  const rpc = async <T>(method: string, params?: unknown) =>
    deroJsonRpc<T>(endpoint, method, params)

  const server = new McpServer({
    name: 'dero-daemon-mcp',
    version: '0.1.0',
  })

  server.registerTool(
    'dero_daemon_ping',
    {
      description:
        'DERO daemon connectivity check. Calls DERO.Ping. No parameters.',
    },
    withStructuredErrors('dero_daemon_ping', async () => rpc<string>('DERO.Ping')),
  )

  server.registerTool(
    'dero_daemon_echo',
    {
      description: 'Echo strings through the daemon (DERO.Echo).',
      inputSchema: {
        words: z.array(z.string()).describe('Strings to echo back'),
      },
    },
    withStructuredErrors('dero_daemon_echo', async ({ words }) => rpc<string>('DERO.Echo', words)),
  )

  server.registerTool(
    'dero_get_info',
    {
      description:
        'Get daemon / chain info: height, difficulty, version, mempool size, etc. (DERO.GetInfo).',
    },
    withStructuredErrors('dero_get_info', async () => rpc('DERO.GetInfo')),
  )

  server.registerTool(
    'dero_get_height',
    {
      description: 'Get top block height and stable/topo heights (DERO.GetHeight).',
    },
    withStructuredErrors('dero_get_height', async () => rpc('DERO.GetHeight')),
  )

  server.registerTool(
    'dero_get_block_count',
    {
      description: 'Total block count (DERO.GetBlockCount).',
    },
    withStructuredErrors('dero_get_block_count', async () => rpc('DERO.GetBlockCount')),
  )

  server.registerTool(
    'dero_get_last_block_header',
    {
      description: 'Header of the tip block (DERO.GetLastBlockHeader).',
    },
    withStructuredErrors('dero_get_last_block_header', async () => rpc('DERO.GetLastBlockHeader')),
  )

  server.registerTool(
    'dero_get_block',
    {
      description: 'Fetch a full block by height or hash (DERO.GetBlock). Provide one of hash or height.',
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
    },
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
    {
      description: 'Block header by topological height (DERO.GetBlockHeaderByTopoHeight).',
      inputSchema: {
        topoheight: z
          .number()
          .int()
          .nonnegative()
          .describe('Topological height'),
      },
    },
    withStructuredErrors('dero_get_block_header_by_topo_height', async ({ topoheight }) =>
      rpc('DERO.GetBlockHeaderByTopoHeight', { topoheight })),
  )

  server.registerTool(
    'dero_get_block_header_by_hash',
    {
      description: 'Block header by hash (DERO.GetBlockHeaderByHash).',
      inputSchema: {
        hash: hex64Schema.describe('Block top hash (hex)'),
      },
    },
    withStructuredErrors('dero_get_block_header_by_hash', async ({ hash }) =>
      rpc('DERO.GetBlockHeaderByHash', { hash })),
  )

  server.registerTool(
    'dero_get_tx_pool',
    {
      description: 'Pending mempool transaction hashes (DERO.GetTxPool).',
    },
    withStructuredErrors('dero_get_tx_pool', async () => rpc('DERO.GetTxPool')),
  )

  server.registerTool(
    'dero_get_random_address',
    {
      description:
        'Random registered addresses from chain (for ring construction); optional asset scid (DERO.GetRandomAddress).',
      inputSchema: {
        scid: hex64Schema
          .optional()
          .describe('Optional asset smart-contract id (hex)'),
      },
    },
    withStructuredErrors('dero_get_random_address', async (args) =>
      rpc(
        'DERO.GetRandomAddress',
        args.scid != null ? { scid: args.scid } : undefined,
      )),
  )

  server.registerTool(
    'dero_get_transaction',
    {
      description: 'Fetch transactions by tx hashes (DERO.GetTransaction).',
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
    },
    withStructuredErrors('dero_get_transaction', async ({ txs_hashes, decode_as_json }) => {
      const params: Record<string, unknown> = { txs_hashes }
      if (decode_as_json !== undefined) params.decode_as_json = decode_as_json
      return rpc('DERO.GetTransaction', params)
    }),
  )

  server.registerTool(
    'dero_get_encrypted_balance',
    {
      description:
        'Encrypted balance blob for an address at a topo height (DERO.GetEncryptedBalance). Not cleartext balance.',
      inputSchema: {
        address: deroAddressSchema.describe('DERO address (dero1… or deto1…)'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest chain tip'),
        scid: hex64Schema.optional().describe('Asset SCID hex; omit for native DERO'),
      },
    },
    withStructuredErrors('dero_get_encrypted_balance', async ({ address, topoheight, scid }) => {
      const params: Record<string, unknown> = { address, topoheight }
      if (scid) params.scid = scid
      return rpc('DERO.GetEncryptedBalance', params)
    }),
  )

  server.registerTool(
    'dero_get_sc',
    {
      description:
        'Read smart contract code and/or variables by SCID (DERO.GetSC).',
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
    },
    withStructuredErrors('dero_get_sc', async ({ scid, code, variables, topoheight }) => {
      const params: Record<string, unknown> = {
        scid,
        code: code ?? true,
        variables: variables ?? true,
      }
      if (topoheight !== undefined) params.topoheight = topoheight
      return rpc('DERO.GetSC', params)
    }),
  )

  server.registerTool(
    'dero_get_gas_estimate',
    {
      description:
        'Estimate gas (compute + storage) for transfers, deploy, or SC call (DERO.GetGasEstimate).',
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
    },
    withStructuredErrors('dero_get_gas_estimate', async (args) => {
      const params: Record<string, unknown> = {}
      if (args.transfers) params.transfers = args.transfers
      if (args.sc) params.sc = args.sc
      if (args.sc_rpc) params.sc_rpc = args.sc_rpc
      if (args.signer) params.signer = args.signer
      return rpc('DERO.GetGasEstimate', params)
    }),
  )

  server.registerTool(
    'dero_name_to_address',
    {
      description: 'Resolve a DERO on-chain name to address (DERO.NameToAddress).',
      inputSchema: {
        name: z.string().min(1).describe('Registered name'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest'),
      },
    },
    withStructuredErrors('dero_name_to_address', async ({ name, topoheight }) =>
      rpc('DERO.NameToAddress', { name, topoheight })),
  )

  server.registerTool(
    'dero_get_block_template',
    {
      description:
        'Mining: get block template for a miner address (DERO.GetBlockTemplate).',
      inputSchema: {
        wallet_address: deroAddressSchema.describe('Miner payout DERO address'),
        block: z
          .boolean()
          .optional()
          .describe('Include block blob'),
        miner: z.string().optional().describe('Optional miner id / label'),
      },
    },
    withStructuredErrors('dero_get_block_template', async ({ wallet_address, block, miner }) => {
      const params: Record<string, unknown> = { wallet_address }
      if (block !== undefined) params.block = block
      if (miner) params.miner = miner
      return rpc('DERO.GetBlockTemplate', params)
    }),
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
              version: '0.1.0',
              mode: 'read-only',
              endpoint: endpoint,
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

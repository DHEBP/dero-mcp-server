import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { deroJsonRpc, jsonRpcEndpoint } from './rpc.js'

const scRpcArgSchema = z.object({
  name: z.string(),
  datatype: z.enum(['S', 'U', 'H']),
  value: z.union([z.string(), z.number()]),
})

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
    async () => toolText(await rpc<string>('DERO.Ping')),
  )

  server.registerTool(
    'dero_daemon_echo',
    {
      description: 'Echo strings through the daemon (DERO.Echo).',
      inputSchema: {
        words: z.array(z.string()).describe('Strings to echo back'),
      },
    },
    async ({ words }) => toolText(await rpc<string>('DERO.Echo', words)),
  )

  server.registerTool(
    'dero_get_info',
    {
      description:
        'Get daemon / chain info: height, difficulty, version, mempool size, etc. (DERO.GetInfo).',
    },
    async () => toolText(await rpc('DERO.GetInfo')),
  )

  server.registerTool(
    'dero_get_height',
    {
      description: 'Get top block height and stable/topo heights (DERO.GetHeight).',
    },
    async () => toolText(await rpc('DERO.GetHeight')),
  )

  server.registerTool(
    'dero_get_block_count',
    {
      description: 'Total block count (DERO.GetBlockCount).',
    },
    async () => toolText(await rpc('DERO.GetBlockCount')),
  )

  server.registerTool(
    'dero_get_last_block_header',
    {
      description: 'Header of the tip block (DERO.GetLastBlockHeader).',
    },
    async () => toolText(await rpc('DERO.GetLastBlockHeader')),
  )

  server.registerTool(
    'dero_get_block',
    {
      description: 'Fetch a full block by height or hash (DERO.GetBlock). Provide one of hash or height.',
      inputSchema: {
        hash: z
          .string()
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
    async (args) => {
      if (!args.hash && args.height === undefined) {
        throw new Error('Provide either hash or height')
      }
      const params: Record<string, unknown> = {}
      if (args.hash) params.hash = args.hash
      if (args.height !== undefined) params.height = args.height
      return toolText(await rpc('DERO.GetBlock', params))
    },
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
    async ({ topoheight }) =>
      toolText(await rpc('DERO.GetBlockHeaderByTopoHeight', { topoheight })),
  )

  server.registerTool(
    'dero_get_block_header_by_hash',
    {
      description: 'Block header by hash (DERO.GetBlockHeaderByHash).',
      inputSchema: {
        hash: z.string().describe('Block top hash (hex)'),
      },
    },
    async ({ hash }) =>
      toolText(await rpc('DERO.GetBlockHeaderByHash', { hash })),
  )

  server.registerTool(
    'dero_get_tx_pool',
    {
      description: 'Pending mempool transaction hashes (DERO.GetTxPool).',
    },
    async () => toolText(await rpc('DERO.GetTxPool')),
  )

  server.registerTool(
    'dero_get_random_address',
    {
      description:
        'Random registered addresses from chain (for ring construction); optional asset scid (DERO.GetRandomAddress).',
      inputSchema: {
        scid: z
          .string()
          .optional()
          .describe('Optional asset smart-contract id (hex)'),
      },
    },
    async (args) =>
      toolText(
        await rpc(
          'DERO.GetRandomAddress',
          args.scid != null ? { scid: args.scid } : undefined,
        ),
      ),
  )

  server.registerTool(
    'dero_get_transaction',
    {
      description: 'Fetch transactions by tx hashes (DERO.GetTransaction).',
      inputSchema: {
        txs_hashes: z
          .array(z.string())
          .min(1)
          .describe('List of transaction hashes (hex)'),
        decode_as_json: z
          .number()
          .int()
          .optional()
          .describe('Optional: decode each tx as JSON when non-zero'),
      },
    },
    async ({ txs_hashes, decode_as_json }) => {
      const params: Record<string, unknown> = { txs_hashes }
      if (decode_as_json !== undefined) params.decode_as_json = decode_as_json
      return toolText(await rpc('DERO.GetTransaction', params))
    },
  )

  server.registerTool(
    'dero_get_encrypted_balance',
    {
      description:
        'Encrypted balance blob for an address at a topo height (DERO.GetEncryptedBalance). Not cleartext balance.',
      inputSchema: {
        address: z.string().describe('DERO address (deto1…)'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest chain tip'),
        scid: z.string().optional().describe('Asset SCID hex; omit for native DERO'),
      },
    },
    async ({ address, topoheight, scid }) => {
      const params: Record<string, unknown> = { address, topoheight }
      if (scid) params.scid = scid
      return toolText(await rpc('DERO.GetEncryptedBalance', params))
    },
  )

  server.registerTool(
    'dero_get_sc',
    {
      description:
        'Read smart contract code and/or variables by SCID (DERO.GetSC).',
      inputSchema: {
        scid: z.string().describe('64-char hex Smart Contract ID'),
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
    async ({ scid, code, variables, topoheight }) => {
      const params: Record<string, unknown> = {
        scid,
        code: code ?? true,
        variables: variables ?? true,
      }
      if (topoheight !== undefined) params.topoheight = topoheight
      return toolText(await rpc('DERO.GetSC', params))
    },
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
    async (args) => {
      const params: Record<string, unknown> = {}
      if (args.transfers) params.transfers = args.transfers
      if (args.sc) params.sc = args.sc
      if (args.sc_rpc) params.sc_rpc = args.sc_rpc
      if (args.signer) params.signer = args.signer
      return toolText(await rpc('DERO.GetGasEstimate', params))
    },
  )

  server.registerTool(
    'dero_name_to_address',
    {
      description: 'Resolve a DERO on-chain name to address (DERO.NameToAddress).',
      inputSchema: {
        name: z.string().describe('Registered name'),
        topoheight: z
          .number()
          .int()
          .describe('Use -1 for latest'),
      },
    },
    async ({ name, topoheight }) =>
      toolText(await rpc('DERO.NameToAddress', { name, topoheight })),
  )

  server.registerTool(
    'dero_get_block_template',
    {
      description:
        'Mining: get block template for a miner address (DERO.GetBlockTemplate).',
      inputSchema: {
        wallet_address: z.string().describe('Miner payout DERO address'),
        block: z
          .boolean()
          .optional()
          .describe('Include block blob'),
        miner: z.string().optional().describe('Optional miner id / label'),
      },
    },
    async ({ wallet_address, block, miner }) => {
      const params: Record<string, unknown> = { wallet_address }
      if (block !== undefined) params.block = block
      if (miner) params.miner = miner
      return toolText(await rpc('DERO.GetBlockTemplate', params))
    },
  )

  return server
}

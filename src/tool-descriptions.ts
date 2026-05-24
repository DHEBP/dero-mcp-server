/**
 * Agent-instruction-style descriptions for every MCP tool registered by this server.
 *
 * Each description follows the same four-section template so MCP hosts (Cursor,
 * Claude Desktop, OpenCode) can present consistent guidance to the model:
 *
 *   - "When to call:" — call timing and sequencing relative to other tools.
 *   - "Input Requirements:" — explicit MUST/PREFER blocks. Use "none." when
 *     the tool takes no inputs (keeps the contract uniform so the CI guard
 *     can enforce the section's presence everywhere).
 *   - "Output:" — one-line description of the response shape so the model
 *     does not need to invoke the tool to discover its return type.
 *   - "PREFER ..." — optional. Citation/sequencing hints (e.g. point the
 *     model at bundled docs for context).
 *
 * The map is exported as a frozen object so descriptions cannot drift at
 * runtime. `scripts/check-mcp-descriptions.ts` imports this map and enforces
 * the four-section template in CI; do not bypass it by inlining descriptions
 * in src/server.ts.
 */

export const TOOL_DESCRIPTIONS = {
  dero_daemon_ping: `DERO daemon connectivity check via DERO.Ping.

When to call: as the first step in any chain investigation to confirm the daemon is reachable. Call before dero_get_info if you are unsure whether DERO_DAEMON_URL is correctly configured.

Input Requirements: none.

Output: a "Pong" string when the daemon is healthy. On failure this tool returns a structured _meta.error with code RPC_UNREACHABLE and a retry hint.`,

  dero_daemon_echo: `Echo strings through the daemon via DERO.Echo. Useful for round-trip sanity checks.

When to call: when you need to confirm that string payloads reach the daemon intact (e.g. before debugging a malformed call to a more complex tool). PREFER dero_daemon_ping for a lighter-weight liveness probe.

Input Requirements (CRITICAL):
- \`words\` MUST be a non-empty array of strings.

Output: the echoed string concatenated by the daemon.`,

  dero_get_info: `Get DERO daemon and chain metadata: height, topoheight, stableheight, difficulty, version, network, mempool size, and total supply (DERO.GetInfo).

When to call: first thing in any chain-state investigation or sync-health check. Call this BEFORE dero_get_sc, dero_get_transaction, or dero_get_block when you do not already know the current tip. PREFER citing dero_docs_search("DERO.GetInfo") so the user can verify field semantics.

Input Requirements: none.

Output: full chain info JSON including \`topoheight\`, \`stableheight\`, \`height\`, \`network\`, \`version\`, \`difficulty\`, \`tx_pool_size\`, and \`total_supply\`.`,

  dero_get_height: `Get the current block heights: tip height, stable height (finalized), and topoheight (canonical ordering) via DERO.GetHeight.

When to call: when you need a quick height snapshot without the full chain-info payload. PREFER dero_get_info when you also need network, version, or difficulty.

Input Requirements: none.

Output: \`{ height, stableheight, topoheight }\`.`,

  dero_get_block_count: `Get the total block count via DERO.GetBlockCount. This is a tip count, not a topoheight.

When to call: when you need just the block count (e.g. for delta math against a reference height). PREFER dero_get_height when you need tip and stable heights together.

Input Requirements: none.

Output: \`{ count }\`.`,

  dero_get_last_block_header: `Get the header of the current tip block via DERO.GetLastBlockHeader (no full block body).

When to call: when you need tip block metadata (hash, miner, timestamp, difficulty) without the transactions or miner_tx payload. PREFER dero_get_block when you need transactions or the miner_tx.

Input Requirements: none.

Output: \`{ block_header: { hash, height, topoheight, timestamp, difficulty, ... } }\`.`,

  dero_get_block: `Fetch a full block (header + miner_tx + transactions + topo position) by height OR hash via DERO.GetBlock.

When to call: when investigating a specific block or verifying a transaction's inclusion. Call dero_get_height first if you do not have a target height. PREFER citing dero_docs_search("block structure") so the user can verify field semantics.

Input Requirements (CRITICAL):
- You MUST provide exactly ONE of \`hash\` or \`height\`. Providing both or neither returns a structured INVALID_INPUT error.
- \`hash\` MUST be exactly 64 hex characters.
- \`height\` MUST be a non-negative integer.

Output: full block with \`block_header\`, \`miner_tx\`, \`txs\`, and topo position fields.`,

  dero_get_block_header_by_topo_height: `Get a block header by topological height (canonical ordering) via DERO.GetBlockHeaderByTopoHeight.

When to call: when you need a header keyed by topo position rather than chain height. Topoheight is the canonical ordering used by DERO indexers; height is the consensus block height.

Input Requirements (CRITICAL):
- \`topoheight\` MUST be a non-negative integer no greater than the current topoheight (call dero_get_info first if unsure).

Output: \`{ block_header: { hash, height, topoheight, timestamp, ... } }\`.`,

  dero_get_block_header_by_hash: `Get a block header by its 64-char hex hash via DERO.GetBlockHeaderByHash.

When to call: when you have a block hash (e.g. from a tx confirmation) and need its header without the full block body. PREFER dero_get_block when you also need the txs or miner_tx.

Input Requirements (CRITICAL):
- \`hash\` MUST be exactly 64 hex characters (matches /^[0-9a-fA-F]{64}$/).

Output: \`{ block_header: {...} }\`.`,

  dero_get_tx_pool: `List pending mempool transaction hashes via DERO.GetTxPool.

When to call: when checking unconfirmed activity, watching for a specific tx to land, or estimating mempool pressure. NOTE: \`tx_hashes\` may be \`null\` or an empty array when the mempool is empty — treat both as "no pending".

Input Requirements: none.

Output: \`{ tx_hashes: string[] | null }\`.`,

  dero_get_random_address: `Get random registered addresses from the chain (used for ring construction in private transfers) via DERO.GetRandomAddress.

When to call: when building a transfer ring in external wallet tooling, or sampling chain participants. Optional asset SCID limits sampling to holders of that asset.

Input Requirements:
- \`scid\` is OPTIONAL. When provided it MUST be exactly 64 hex characters.

Output: \`{ address: string[] }\`.`,

  dero_get_transaction: `Fetch one or more transactions by hash via DERO.GetTransaction. Each tx is returned with confirmation status, block hash, and (optionally) decoded JSON fields.

When to call: when tracing a tx by hash. Pair with dero_get_sc when the tx invokes a contract. PREFER citing dero_docs_search("transaction structure") so the user can interpret confirmations, ring members, and SC fields.

Input Requirements (CRITICAL):
- \`txs_hashes\` MUST be a non-empty array of 64-char hex strings.
- \`decode_as_json\` is OPTIONAL. PREFER \`1\` (any non-zero value) when you want JSON-decoded fields instead of raw blobs.

Output: \`{ txs: [...], txs_as_hex: [...] }\` with per-tx confirmation, block hash, and (when decoded) parsed payload.`,

  dero_get_encrypted_balance: `Get the ENCRYPTED balance blob for a DERO address at a topo height via DERO.GetEncryptedBalance.

CRITICAL: this returns an opaque encrypted blob, NOT a cleartext balance. Only the wallet holding the spend key can decrypt it. Do NOT present the encrypted bytes as a balance to the user.

When to call: when verifying that an address has on-chain encrypted state (e.g. before attempting a transfer with a wallet you control), or as a sub-step in another tool. PREFER citing dero_docs_search("encrypted balance") so the user understands the opacity.

Input Requirements (CRITICAL):
- \`address\` MUST start with \`dero1\` (mainnet) or \`deto1\` (testnet).
- \`topoheight\` MUST be an integer; use \`-1\` for the latest chain tip.
- \`scid\` is OPTIONAL. Omit for native DERO; provide 64-hex SCID for asset balances.

Output: \`{ status, registration, balance (encrypted blob), ... }\`.`,

  dero_get_sc: `Read smart contract state (code and/or stored variables) by SCID via DERO.GetSC. This is the primary entry point for any contract inspection on DERO.

When to call: as the first step in any DVM contract investigation. Pair with dero_docs_search("DVM-BASIC") to interpret the returned code blob. PREFER citing dero_docs_search("smart contract") or dero_docs_get_page on a relevant DVM page so the user can interpret the contract's state model.

Input Requirements (CRITICAL):
- \`scid\` MUST be exactly 64 hex characters (the contract id).
- \`code\` is OPTIONAL (defaults to true). Set false to skip the source blob when you only need stored variables.
- \`variables\` is OPTIONAL (defaults to true). Set false to skip variables when you only need the source.
- \`topoheight\` is OPTIONAL. Omit or use \`-1\` for the latest committed state.

Output: \`{ code, balances, variables: { stringkeys, uint64keys }, ... }\`.`,

  dero_get_gas_estimate: `Estimate gas (compute + storage) for transfers, SC deploys, or SC invokes via DERO.GetGasEstimate. This is a PRE-FLIGHT check; nothing is submitted.

When to call: BEFORE any wallet-side transfer/scinvoke (using external wallet tooling) to size fees, OR when explaining deploy costs to a user. PREFER citing dero_docs_search("gas estimate" or "fees") so the user understands how compute vs storage gas are charged.

Input Requirements (CRITICAL):
- At least ONE of \`transfers\`, \`sc\`, or \`sc_rpc\` MUST be provided.
- \`sc\` is the DVM-BASIC contract source string when estimating a deploy.
- \`sc_rpc\` is an array of \`{ name, datatype, value }\` invocation arguments (entrypoint + SC_ID + caller-provided params).
- \`signer\` is OPTIONAL but PREFERRED; pass the \`dero1.../deto1...\` address that would sign the eventual tx.

Output: \`{ gascompute, gasstorage, status }\`.`,

  dero_name_to_address: `Resolve a DERO on-chain registered name to its address via DERO.NameToAddress.

When to call: when a user supplies a human-readable name (e.g. "myname") instead of a \`dero1.../deto1...\` address.

Input Requirements (CRITICAL):
- \`name\` MUST be a non-empty string. Resolution is case-sensitive on the daemon side.
- \`topoheight\` MUST be an integer; use \`-1\` for the latest registry state.

Output: \`{ name, address }\`. On NOT_FOUND the daemon's RPC error is surfaced as a structured _meta.error.`,

  dero_get_block_template: `Get a mining block template for a miner payout address via DERO.GetBlockTemplate.

When to call: ONLY when you are actually mining. PREFER dero_get_last_block_header for general chain-tip inspection.

Input Requirements (CRITICAL):
- \`wallet_address\` MUST be a valid DERO address (\`dero1...\` or \`deto1...\`) that will receive the block reward.
- \`block\` is OPTIONAL. Set true to include the raw block blob in the response.
- \`miner\` is an OPTIONAL label.

Output: block template payload suitable for a mining client. Does NOT submit a block; submission requires the excluded DERO.SubmitBlock method.`,

  dero_docs_search: `Search the bundled DERO documentation index across derod, tela, hologram, and deropay (145+ pages). In-process — no network round trip.

When to call: when you need authoritative docs to answer a DERO question, OR before constructing a citation in your response. Call this BEFORE explaining DVM, RPC methods, TELA contracts, Hologram simulator, or DeroPay webhooks. PREFER returning the top match's \`canonical_url\` and \`slug\` to the user as a citation.

Input Requirements (CRITICAL):
- \`query\` MUST be a non-empty search string.
- \`product\` is OPTIONAL. Provide when you know the scope to reduce noise (e.g. \`tela\` for TELA-DOC-1 questions).
- \`section\` is OPTIONAL. Provide a slug prefix to scope further (e.g. \`rpc-api\` under \`product=derod\`).
- \`limit\` is OPTIONAL (default 8, max 25).

Output: ranked matches with \`title\`, \`slug\`, \`headings\`, \`excerpt\`, \`canonical_url\`, and \`score\`.`,

  dero_docs_get_page: `Get a single bundled docs page by slug, with full plain-text content and headings.

When to call: AFTER dero_docs_search has returned a candidate slug, OR when you have a known slug from a prior citation. PREFER dero_docs_search first when you only have a topic in mind.

Input Requirements (CRITICAL):
- \`slug\` MUST be a non-empty doc slug relative to pages/ (e.g. \`rpc-api/daemon-rpc-api\`, \`tutorials/first-app\`, \`dero-pay/quick-start\`).
- \`product\` is OPTIONAL but RECOMMENDED to disambiguate identical slugs across docs sites (\`derod\`, \`tela\`, \`hologram\`, \`deropay\`).

Output: \`{ product, slug, title, headings, content, canonical_url, last_updated, source_path }\`. Content is truncated at 20000 chars; if you need more, narrow with section anchors.`,

  dero_docs_list: `List indexed bundled docs pages across all four products with slugs, titles, and canonical URLs.

When to call: when surveying available docs (e.g. "what TELA tutorials exist?"), OR when you need a slug catalog before invoking dero_docs_get_page. PREFER dero_docs_search when you have a specific question.

Input Requirements:
- \`product\` is OPTIONAL. Provide to scope to one of \`derod | tela | hologram | deropay\`.
- \`limit\` is OPTIONAL (default 120, max 500).

Output: \`{ docs_source, total, products, pages: [{ product, slug, title, canonical_url, last_updated }] }\`.`,

  diagnose_chain_health: `Composite: run a four-step chain (DERO.Ping → DERO.GetInfo → DERO.GetHeight → DERO.GetTxPool) and return a single narrative health report with chain metadata, mempool snapshot, machine-readable signals, and curated docs citations.

When to call: as the first step in any chain-state investigation when the user asks "is the node healthy", "is it synced", or "what is the current state of the chain". PREFER this over chaining the four primitives yourself — the composite handles partial-failure modes and lag-depth classification consistently, and the response already cites the right docs page.

Input Requirements:
- \`include_tx_pool\` is OPTIONAL (default true). Set false to skip the mempool snapshot when you only need chain-tip status.

Output: \`{ status, narrative, signals[], chain, mempool, related_docs, _diagnostics }\`. \`status\` is one of \`healthy | lagging | partial | unreachable\`. \`chain\` is null when DERO.GetInfo was unreachable; \`mempool\` is null when skipped or the call failed. On total daemon unreachability the tool returns a structured \`_meta.error\` with code \`RPC_UNREACHABLE\`.`,
} as const

export type DeroToolName = keyof typeof TOOL_DESCRIPTIONS

export const DERO_TOOL_NAMES: readonly DeroToolName[] = Object.keys(
  TOOL_DESCRIPTIONS,
) as DeroToolName[]

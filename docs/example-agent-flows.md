# Example Agent Flows

How to use DERO MCP tools in multi-step conversations. These examples work in Cursor, OpenCode, Claude Desktop, or any MCP client with `dero-mcp-server` configured.

---

## Flow 1: Network Health Check

**User prompt:**
> "Is my DERO node synced?"

**Agent steps:**

1. `dero_daemon_ping` — confirm daemon is reachable
2. `dero_get_info` — get version, network, topoheight, difficulty
3. `dero_get_height` — get height, stableheight, topoheight

**What to look for:**
- Ping returns `"Pong"` → daemon is up
- `topoheight` is increasing over time → node is syncing
- `stableheight` close to `topoheight` → node is caught up
- Compare `topoheight` to a block explorer to verify sync status

**Example response:**
> Your node is reachable and synced. Current topoheight: 4,521,307. Network: mainnet. Daemon version: 3.5.1-1.DERO.STARGATE+05.

---

## Flow 2: Smart Contract Inspection

**User prompt:**
> "Show me the stored variables for SCID abc123..."

**Agent steps:**

1. `dero_get_sc` with `scid`, `variables: true`, `code: false`
2. Parse the `stringkeys` and `balances` from the response
3. Interpret Uint64/String values using DVM-BASIC conventions

**What to look for:**
- `stringkeys` contains stored state (key-value pairs)
- Keys starting with lowercase are typically private state
- `balances` shows token holdings if the contract manages assets
- `code` field contains DVM-BASIC source if `code: true`

**Example prompt:**
> "What's stored in the name registry contract?"

```
dero_get_sc({
  scid: "0000000000000000000000000000000000000000000000000000000000000001",
  variables: true,
  code: false
})
```

---

## Flow 3: Transaction Lookup

**User prompt:**
> "What happened in transaction 7f3a...?"

**Agent steps:**

1. `dero_get_transaction` with `txs_hashes: ["7f3a..."]`, `decode_as_json: 1`
2. Summarize transaction type, transfers, and SC invocations
3. Link to block height from response metadata

**What to look for:**
- `txs` array contains transaction details
- `sc_args` shows smart contract function calls
- `as_hex` is the raw transaction (skip unless debugging)
- `block_height` and `in_pool` indicate confirmation status

**Example:**
> Transaction 7f3a... was confirmed at block 4,521,200. It invoked the "Register" function on the name registry with argument "myname".

---

## Flow 4: Name Resolution

**User prompt:**
> "What address owns the name 'dero'?"

**Agent steps:**

1. `dero_name_to_address` with `name: "dero"`, `topoheight: -1`
2. Return the resolved address

**What to look for:**
- `address` field contains the DERO address (starts with `dero1` or `deto1`)
- If name is not registered, the RPC returns an error
- `topoheight: -1` means "latest chain state"

**Example:**
> The name "dero" resolves to `dero1qy...` (truncated). This is public on-chain data visible to anyone.

---

## Flow 5: Block Exploration

**User prompt:**
> "Show me block 4,500,000"

**Agent steps:**

1. `dero_get_block` with `height: 4500000`
2. Summarize: timestamp, miner reward, transaction count, hash

**Alternative — by hash:**
1. `dero_get_block_header_by_hash` with `hash: "abc123..."`

**What to look for:**
- `block_header.timestamp` — Unix timestamp of block
- `block_header.reward` — miner reward in atomic units (divide by 100000 for DERO)
- `txs` — list of transaction hashes in the block

---

## Flow 6: Contract Deploy Prep (Read-Only)

**User prompt:**
> "Estimate gas for deploying this contract"

**Agent steps:**

1. Validate DVM-BASIC syntax (use `dvm-basic` in Cursor, or equivalent workflow in OpenCode)
2. `dero_get_gas_estimate` with `sc: "<contract source>"`
3. Report compute and storage costs

**Important:** This MCP server is **read-only**. It cannot deploy contracts. After estimating gas, tell the user to deploy via:
- DERO CLI wallet (`curl` to wallet RPC)
- Engram wallet GUI
- XSWD browser integration

**Example:**
> Gas estimate: 5,000 compute + 12,000 storage = 17,000 total. Deploy via your wallet — this MCP cannot submit transactions.

---

## Flow 7: Mempool Check

**User prompt:**
> "Are there pending transactions?"

**Agent steps:**

1. `dero_get_tx_pool`
2. Report count of pending transaction hashes

**What to look for:**
- `tx_hashes` array — pending transactions waiting for blocks
- Empty array means mempool is clear
- Large mempool may indicate network congestion

---

## Flow 8: Encrypted Balance Lookup

**User prompt:**
> "Get the encrypted balance blob for address dero1qy..."

**Agent steps:**

1. `dero_get_encrypted_balance` with `address`, `topoheight: -1`
2. Return the encrypted balance data

**Important:** This returns **encrypted** balance data, not cleartext. Only the address owner can decrypt it with their private keys. This is useful for:
- Building transactions (ring signatures need balance commitments)
- Verifying an address exists on-chain

---

## Flow 9: Mining Template (Advanced)

**User prompt:**
> "Get a block template for mining"

**Agent steps:**

1. `dero_get_block_template` with `wallet_address: "dero1qy..."`
2. Return the template blob for mining software

**Note:** This is for miners integrating with pools or solo mining. Most users won't need this.

---

## Flow 10: Docs Retrieval (DERO + TELA + Hologram + DeroPay)

**User prompt:**
> "Find the DeroPay webhook docs and summarize required fields."

**Agent steps:**

1. `dero_docs_search` with `query: "webhooks required fields", product: "deropay"`
2. Pick the best hit and call `dero_docs_get_page` with returned `slug` and `product`
3. Summarize from returned headings/content and cite the canonical URL

**What to look for:**
- `results[].canonical_url` points to the public docs page
- `results[].headings` helps jump to relevant sections quickly
- `dero_docs_get_page` returns normalized text for model-friendly summarization

If you need browsing first, call `dero_docs_list` (optionally with `product`) to see available slugs.

---

## Combining Flows

Real conversations often combine multiple flows:

**User:** "Check if my node is synced, then show me the latest block and any pending transactions."

**Agent:**
1. `dero_daemon_ping` → confirm reachable
2. `dero_get_info` → get topoheight
3. `dero_get_last_block_header` → latest block details
4. `dero_get_tx_pool` → pending transactions

---

## Tips for Agents

1. **Always ping first** if unsure about daemon connectivity
2. **Use `topoheight: -1`** for latest state in queries that accept it
3. **SCIDs are 64-character hex** — validate format before calling
4. **Atomic units**: DERO amounts are in 1/100000 units (5 decimals)
5. **Read-only boundary**: This MCP cannot send transactions, deploy contracts, or modify state. Guide users to wallet tools for writes.
6. **Use structured errors**: failed tools return `_meta.error` with `code`, `hint`, and `retryable` for recovery logic.

---

## Related Skills

If using Cursor or OpenCode, these skills complement the MCP tools:

| Skill | Use for |
|---|---|
| `dero-rpc` | Direct curl commands, wallet RPC (transfers, scinvoke) |
| `dvm-basic` | Writing and debugging smart contract code |
| `smart-contracts` | Deployment workflows, ownership transfer |
| `tela-publisher` | Deploying TELA web apps on-chain |
| `gnomon-indexer` | Discovering contracts by stored variables |

The MCP provides **live chain reads**. Skills provide **workflow guidance** and access to wallet operations the MCP intentionally excludes.

## Built-in MCP Prompts

These prompts are available from `prompts/list`:

- `network_health_check`
- `inspect_smart_contract`
- `trace_transaction`

Use `prompts/get` with arguments, then execute the suggested tool sequence.

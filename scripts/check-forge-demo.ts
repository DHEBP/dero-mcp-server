/**
 * Guard: gold-standard test for the forge composite.
 *
 * The integrity-page Part 3 demo box documents the EXACT forged proof string
 * for these inputs:
 *   tx_hash:    5bbe1b7e…ce57e55 (the cited 2022 inflation-claim TX)
 *   ring_slot:  0
 *   amount:     -1 DERO
 *
 * If the composite reproduces that string byte-for-byte, the bn254 wrapper,
 * proof encoder, TX parser, and forge math are all correct end-to-end. This
 * is the single most load-bearing test for the FORGE feature.
 *
 * Runs offline (uses the bundled TX hex from check-tx-parse.ts; no daemon
 * call needed).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { forgeDemoProof } from '../src/composites/forge-demo-proof.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DOCS_PART3_EXPECTED =
  'deroproof1qyvvfxzyfqtjm0lgyf5jncleh6cxmmfahgmekxpyrzhhsz832dv8qq9zvfyyskpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxy4j4r0lllllllll8jcq3r0a08'

// Reuse the same TX hex constant the tx-parse guard uses so this script stays
// offline. We extract it via a tiny regex on the sibling file to avoid copy-pasting
// 5KB of hex twice.
const txParseSrc = readFileSync(resolve(__dirname, 'check-tx-parse.ts'), 'utf-8')
const m = txParseSrc.match(/CITED_2022_TX_HEX\s*=\s*\n?\s*'([0-9a-f]+)'/i)
if (!m) {
  console.error('check:forge-demo SETUP FAILED — could not extract TX hex from check-tx-parse.ts')
  process.exit(2)
}
const CITED_2022_TX_HEX = m[1]

// The composite requires an rpc closure even when tx_hex is provided (it never
// gets called in that path). Pass a stub that throws on use.
const stubRpc = async () => {
  throw new Error('stub rpc: should not be called when tx_hex is provided')
}

try {
  const result = await forgeDemoProof(stubRpc, {
    tx_hex: CITED_2022_TX_HEX,
    ring_slot: 0,
    amount_dero: '-1',
  })

  if (result.forged_proof_string !== DOCS_PART3_EXPECTED) {
    console.error('check:forge-demo FAILED — forged string does not match docs Part 3 expected')
    console.error('  expected:', DOCS_PART3_EXPECTED)
    console.error('  actual:  ', result.forged_proof_string)
    process.exit(1)
  }
  if (!result.self_check.verified) {
    console.error('check:forge-demo FAILED — self-check did not verify')
    process.exit(1)
  }
  if (result.target_amount.atoms_uint64 !== '18446744073709451616') {
    console.error('check:forge-demo FAILED — uint64 wraparound mismatch')
    console.error('  expected: 18446744073709451616')
    console.error('  actual:  ', result.target_amount.atoms_uint64)
    process.exit(1)
  }
  if (result.explorer_display_amount !== '184,467,440,737,094.51616 DERO') {
    console.error('check:forge-demo FAILED — explorer display string mismatch')
    console.error('  expected: 184,467,440,737,094.51616 DERO')
    console.error('  actual:  ', result.explorer_display_amount)
    process.exit(1)
  }

  console.log('check:forge-demo OK — forged string matches docs Part 3 byte-for-byte')
  console.log(`  forged: ${result.forged_proof_string}`)
  console.log(`  V uint64: ${result.target_amount.atoms_uint64}`)
  console.log(`  explorer display: ${result.explorer_display_amount}`)
  console.log(`  ring slot: ${result.ring_slot}/${result.ring_size}`)
} catch (err) {
  console.error('check:forge-demo FAILED')
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
}

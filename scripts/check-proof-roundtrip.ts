/**
 * Guard: decode the cited 2022 inflation-claim proof string, re-encode it,
 * confirm byte-equal output. Validates the bech32 + deterministic CBOR encoder
 * against the canonical DEROHE wire format.
 *
 * Run with: `npx tsx scripts/check-proof-roundtrip.ts`
 * Wired into package.json as `check:proof-roundtrip`.
 */

import { verifyProofEncoderRoundtrip } from '../src/proof-decode.js'

try {
  verifyProofEncoderRoundtrip()
  console.log('check:proof-roundtrip OK — cited 2022 proof string round-trips byte-equal')
} catch (err) {
  console.error('check:proof-roundtrip FAILED')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

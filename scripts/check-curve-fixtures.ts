/**
 * Guard: re-derive DERO bn254 G1 fixtures from scalar operations and confirm
 * they match the compressed bytes extracted from DEROHE's Go bn256 lib.
 *
 * Run with: `npx tsx scripts/check-curve-fixtures.ts`
 * Wired into package.json as `check:curve-fixtures`.
 */

import { verifyDeroBn254 } from '../src/bn254.js'

try {
  verifyDeroBn254()
  console.log('check:curve-fixtures OK — all 6 fixtures reproduced from scalar ops')
} catch (err) {
  console.error('check:curve-fixtures FAILED')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

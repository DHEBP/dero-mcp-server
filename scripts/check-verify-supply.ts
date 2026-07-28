#!/usr/bin/env npx tsx
/**
 * Offline CalcSupply parity checks for verify_supply.
 *
 * No daemon required — asserts the pure schedule helpers match the known
 * dero-docs / community-dev constants (premine + launch credit + epochs).
 */

import {
  calcBlockReward,
  calcSupplyAtoms,
  calcSupplyDero,
  LAUNCH_CREDIT,
  PREMINE,
  verifySupplyOffline,
} from '../src/composites/verify-supply.js'

function assertEq(label: string, got: number, want: number): void {
  if (got !== want) {
    throw new Error(`${label}: got ${got}, want ${want}`)
  }
  console.log(`OK  ${label} = ${want}`)
}

// Height 0: premine + credit only.
assertEq('supply atoms @0', calcSupplyAtoms(0), PREMINE + LAUNCH_CREDIT)
assertEq('supply dero @0', calcSupplyDero(0), 12_283_971)

// Height 1: + one starting reward (61_500 atomic = 0.615 DERO)
assertEq('reward @0', calcBlockReward(0), 61_500)
assertEq('supply atoms @1', calcSupplyAtoms(1), PREMINE + LAUNCH_CREDIT + 61_500)
assertEq('supply dero @1', calcSupplyDero(1), 12_283_972)

// First halving boundary: reward halves at height RRI.
assertEq('reward @6999999', calcBlockReward(6_999_999), 61_500)
assertEq('reward @7000000', calcBlockReward(7_000_000), 30_750)

// Live tip sample used during 0.4.9 session (linear GetInfo ≠ CalcSupply).
assertEq('supply dero @7394056', calcSupplyDero(7_394_056), 16_710_143)

// Offline helper shape.
const offline = verifySupplyOffline(0)
assertEq('offline.height', offline.height, 0)
assertEq('offline.atoms', offline.calc_supply_atoms, PREMINE + LAUNCH_CREDIT)

console.log('\n[check:verify-supply] OK — CalcSupply fixtures pass.')

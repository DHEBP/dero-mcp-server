#!/usr/bin/env npx tsx
import assert from 'node:assert/strict'
import {
  classifyPrimitiveFixtureAvailability,
  decideHistoricalFixtureCoverage,
} from './flow-composites.js'

const canonicalMissing = {
  txs_as_hex: [''],
  txs: [{
    as_hex: '',
    block_height: 0,
    reward: 0,
    in_pool: false,
    tx_hash: '',
    valid_block: '',
    ring: null,
    code: '',
  }],
  status: 'OK',
}
const canonicalAvailable = {
  txs_as_hex: ['deadbeef'],
  txs: [{ block_height: 3_112_760, in_pool: false, tx_hash: '22'.repeat(32) }],
  status: 'OK',
}

assert.equal(classifyPrimitiveFixtureAvailability(canonicalMissing), 'missing')
assert.equal(classifyPrimitiveFixtureAvailability(canonicalAvailable), 'available')
assert.equal(classifyPrimitiveFixtureAvailability({ txs: [], status: 'OK' }), 'indeterminate')
assert.equal(classifyPrimitiveFixtureAvailability({ ok: false, status: 'ERROR' }), 'indeterminate')

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'missing',
    explicitArchiveConfigured: false,
    mainnetConfirmed: true,
    primitiveAvailability: 'missing',
  }),
  { action: 'skip', reason: 'independently_confirmed_pruned' },
  'primary-pruned must skip only after independent mainnet + primitive confirmation',
)

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'available',
    explicitArchiveConfigured: false,
  }),
  { action: 'run' },
  'primary archive daemon must run historical coverage',
)

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'available',
    explicitArchiveConfigured: true,
  }),
  { action: 'run' },
  'explicit archive success must run historical coverage',
)

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'missing',
    explicitArchiveConfigured: true,
    mainnetConfirmed: true,
    primitiveAvailability: 'missing',
  }),
  { action: 'fail', reason: 'explicit_archive_miss' },
  'explicit archive miss must fail even when the primitive also misses',
)

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'missing',
    explicitArchiveConfigured: false,
    mainnetConfirmed: true,
    primitiveAvailability: 'available',
  }),
  { action: 'fail', reason: 'primitive_found_fixture' },
  'a primitive/composite disagreement must fail as a possible composite regression',
)

assert.deepEqual(
  decideHistoricalFixtureCoverage({
    compositeAvailability: 'missing',
    explicitArchiveConfigured: false,
    mainnetConfirmed: false,
    primitiveAvailability: 'missing',
  }),
  { action: 'fail', reason: 'mainnet_not_confirmed' },
  'a wrong or unconfirmed network must never be labeled pruned',
)

console.log('composite archive-routing checks: ok')

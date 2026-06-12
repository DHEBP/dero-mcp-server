#!/usr/bin/env npx tsx
/**
 * Offline fixture test for the lightweight TELA discovery engine (src/gnomon.ts).
 *
 * Uses a MOCK rpc closure (no network) that serves a canned GnomonSC registry +
 * contract set, so the full path — registry parse → newest-first scan →
 * dURL→SCID map → cache → resolveDurl, including non-unique dURL handling — is
 * exercised deterministically. The live-chain behavior (real vault.tela) is
 * covered by a flow test gated on the daemon.
 *
 * Run via `npm run check:gnomon`.
 */

import {
  parseRegistry,
  normalizeDurl,
  resolveDurl,
  getDiscoveryIndex,
  _resetGnomonCache,
  GNOMON_REGISTRY_SCID,
  type DeroDaemonRpc,
} from '../src/gnomon.js'

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}\n`)
  if (!ok) failed = true
}

const hx = (s: string) => Buffer.from(s, 'utf8').toString('hex')
const SCID = (n: number) => n.toString(16).padStart(64, '0')

// --- Pure helpers ---
check('normalizeDurl strips dero:// + lowercases', normalizeDurl('DERO://Vault.TELA') === 'vault.tela')

// Build a fake GnomonSC registry: keys "<scid>", "<scid>height", "<scid>owner".
const registryKeys: Record<string, unknown> = {}
function reg(scid: string, height: number) {
  registryKeys[scid] = ''
  registryKeys[scid + 'height'] = String(height)
  registryKeys[scid + 'owner'] = 'deadbeef'
}
// 5 contracts at varying heights; 2 are TELA, one dURL is shared (collision).
const S_TOKEN = SCID(1)
const S_VAULT = SCID(2)
const S_FEED_A = SCID(3)
const S_FEED_B = SCID(4)
const S_OLD = SCID(5)
reg(S_TOKEN, 7000000)
reg(S_VAULT, 6900000)
reg(S_FEED_A, 6800000) // newer FEED
reg(S_FEED_B, 6700000) // older FEED (same dURL → collision)
reg(S_OLD, 100)

const parsed = parseRegistry(registryKeys)
check('parseRegistry finds all 5 SCIDs', parsed.length === 5, `got ${parsed.length}`)
check('parseRegistry sorts newest-first', parsed[0].scid === S_TOKEN && parsed[0].height === 7000000, `top=${parsed[0]?.scid?.slice(0, 4)}`)
check('parseRegistry oldest last', parsed[4].scid === S_OLD, parsed[4]?.scid?.slice(0, 4))

// A TELA-INDEX contract's GetSC payload (hex-encoded values, as the daemon returns).
function telaIndexSc(durl: string, name: string, doc: string) {
  return {
    code: 'Function InitializePrivate() Uint64\n10 IF EXISTS("nameHdr")...\nEnd Function',
    stringkeys: {
      nameHdr: '1',
      var_header_name: hx(name),
      dURL: hx(durl),
      DOC1: hx(doc),
    },
    uint64keys: { commit: 0 },
  }
}
const nonTelaSc = {
  code: 'Function Register(name String) Uint64\nEnd Function',
  stringkeys: { somekey: hx('x'), feeTo: hx('y') },
  uint64keys: {},
}

// Mock rpc: serve the registry for GNOMON_REGISTRY_SCID, else per-SCID payloads.
const scPayloads: Record<string, unknown> = {
  [S_TOKEN]: nonTelaSc,
  [S_VAULT]: telaIndexSc('vault.tela', 'Dero Knowledge Vault', SCID(20)),
  [S_FEED_A]: telaIndexSc('feed.tela', 'FEED', SCID(30)),
  [S_FEED_B]: telaIndexSc('feed.tela', 'FEED', SCID(31)),
  [S_OLD]: nonTelaSc,
}
let scReads = 0
const mockRpc: DeroDaemonRpc = async (method, params) => {
  const p = params as { scid?: string }
  if (method !== 'DERO.GetSC') throw new Error('unexpected method ' + method)
  if (p.scid === GNOMON_REGISTRY_SCID) return { stringkeys: registryKeys } as never
  scReads++
  const payload = scPayloads[p.scid ?? '']
  if (!payload) throw new Error('unknown scid')
  return payload as never
}

// --- Full engine (async) ---
async function run() {
  _resetGnomonCache()
  const index = await getDiscoveryIndex(mockRpc)
  check('index finds the 2 TELA apps (vault + 2x feed = 3 apps, 1 non-tela skipped)', index.apps.length === 3, `got ${index.apps.length}`)
  check('non-TELA contracts excluded', !index.apps.some((a) => a.scid === S_TOKEN), '')
  check('apps decoded (name not hex)', index.apps.every((a) => a.name && !/^[0-9a-f]+$/.test(a.name!)), '')

  // dURL resolution
  const vault = await resolveDurl(mockRpc, 'vault.tela')
  check('resolveDurl(vault.tela) → 1 match, correct SCID', vault.length === 1 && vault[0].scid === S_VAULT, `n=${vault.length}`)

  const vaultUpper = await resolveDurl(mockRpc, 'DERO://Vault.TELA')
  check('resolveDurl normalizes case + dero:// prefix', vaultUpper.length === 1 && vaultUpper[0].scid === S_VAULT, '')

  // collision: feed.tela has two contracts, newest first
  const feed = await resolveDurl(mockRpc, 'feed.tela')
  check('resolveDurl(feed.tela) → 2 matches (collision)', feed.length === 2, `n=${feed.length}`)
  check('collision newest-first (FEED_A height 6.8M before FEED_B 6.7M)', feed[0].scid === S_FEED_A, feed[0]?.scid?.slice(0, 4))

  const miss = await resolveDurl(mockRpc, 'doesnotexist.tela')
  check('resolveDurl(unknown) → 0 matches', miss.length === 0, '')

  // cache: a second call must not re-read contracts
  const readsAfterFirst = scReads
  await resolveDurl(mockRpc, 'vault.tela')
  check('second lookup served from cache (no new GetSC reads)', scReads === readsAfterFirst, `reads grew by ${scReads - readsAfterFirst}`)

  process.stdout.write('\n')
  if (failed) {
    process.stderr.write('[check:gnomon] FAIL — discovery engine fixture regressed.\n')
    process.exit(1)
  }
  process.stdout.write('[check:gnomon] OK — all discovery fixtures pass.\n')
}

run().catch((err) => {
  process.stderr.write(`[check:gnomon] error: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})

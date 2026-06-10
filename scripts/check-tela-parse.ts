#!/usr/bin/env npx tsx
/**
 * Offline fixture test for the shared TELA parser (src/tela-parse.ts).
 *
 * No network: feeds hand-built DERO.GetSC-shaped fixtures into the pure parser
 * functions and asserts the parse. This is the load-bearing proof for the TELA
 * tooling because the on-chain schema is not yet validated against a live
 * mainnet SCID (sourced from civilware/tela parse.go, 2025-10-22). When a real
 * SCID is found, capture its GetSC code+stringkeys as a new fixture here and
 * assert byte-for-byte to convert this into a real-data regression.
 *
 * Run via `npm run check:tela-parse`.
 */

import {
  classifyTela,
  parseTelaIndex,
  parseTelaDoc,
  extractTelaDocContent,
} from '../src/tela-parse.js'

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}\n`)
  if (!ok) failed = true
}

const HEX = (n: number) => n.toString(16).padStart(64, '0')

// --- Fixture 1: a large INDEX with >50 DOCs (proves cap-bypass enumeration) ---
const bigIndexKeys: Record<string, unknown> = {
  nameHdr: '1',
  var_header_name: 'Big App',
  var_header_description: 'An app with many files',
  dURL: 'bigapp.tela',
  mods: 'vsoo,txdwd',
  hash: HEX(999),
  owner: 'deto1qsomeowneraddress',
}
const DOC_COUNT = 60
for (let i = 1; i <= DOC_COUNT; i++) bigIndexKeys[`DOC${i}`] = HEX(i)
// version history: numbered keys 0..3
for (let c = 0; c <= 3; c++) bigIndexKeys[String(c)] = HEX(1000 + c)
const bigIndexU = { commit: 3 }

const cls1 = classifyTela(bigIndexKeys, 'Function InitializePrivate() Uint64\n10 IF EXISTS("nameHdr")...')
check('F1 classifies >50-DOC INDEX as tela_index', cls1.kind === 'tela_index', cls1.kind)
const idx1 = parseTelaIndex(bigIndexKeys, bigIndexU)
check('F1 enumerates ALL 60 DOCs past the 50-cap', idx1.doc_count === DOC_COUNT, `got ${idx1.doc_count}`)
check('F1 DOC1 is entrypoint', idx1.docs[0]?.is_entrypoint === true && idx1.docs[0]?.position === 1, '')
check('F1 DOCs ordered by position', idx1.docs[59]?.position === 60, `last=${idx1.docs[59]?.position}`)
check('F1 mods parsed to array', idx1.mods.length === 2 && idx1.mods[0] === 'vsoo', idx1.mods.join(','))
check('F1 commit read from uint64keys', idx1.commit === 3, String(idx1.commit))
check('F1 version_history ordered 0..3', idx1.version_history.length === 4 && idx1.version_history[0].commit === 0, '')
check('F1 updateable is honest unknown', idx1.updateable === 'unknown', '')
check('F1 no spurious parse_notes', idx1.parse_notes.length === 0, idx1.parse_notes.join('; '))

// --- Fixture 2: a DOC with End Function + /* content */ (proves extraction) ---
const docCode = [
  'Function InitializePrivate() Uint64',
  '10 IF EXISTS("nameHdr") THEN GOTO 100',
  '30 STORE("var_header_name", "index.html")',
  '34 STORE("docType", "TELA-HTML-1")',
  '36 STORE("fileCheckC", "abc")',
  '37 STORE("fileCheckS", "def")',
  '100 RETURN 0',
  'End Function',
  '/*',
  '<html><body>Hello TELA!</body></html>',
  '*/',
].join('\n')
const docKeys: Record<string, unknown> = {
  var_header_name: 'index.html',
  docType: 'TELA-HTML-1',
  dURL: 'app.tela',
  subDir: '',
  fileCheckC: 'abc123',
  fileCheckS: 'def456',
}
const cls2 = classifyTela(docKeys, docCode)
check('F2 classifies DOC as tela_doc', cls2.kind === 'tela_doc', cls2.kind)
const doc2 = parseTelaDoc(docKeys, docCode)
check('F2 filename + docType parsed', doc2.filename === 'index.html' && doc2.doc_type === 'TELA-HTML-1', '')
check('F2 signature present', doc2.signature.present === true, '')
check('F2 content_embedded true', doc2.content_embedded === true, '')
const ext2 = extractTelaDocContent(docCode)
check('F2 content extracted exactly', ext2.content === '<html><body>Hello TELA!</body></html>', JSON.stringify(ext2.content))

// --- Fixture 3: a DOC with no /* */ block (DocShard/STATIC case) ---
const noBlockCode = [
  'Function InitializePrivate() Uint64',
  '30 STORE("var_header_name", "shard-1.js")',
  '34 STORE("docType", "TELA-STATIC-1")',
  '36 STORE("fileCheckC", "x")',
  '100 RETURN 0',
  'End Function',
].join('\n')
const ext3 = extractTelaDocContent(noBlockCode)
check('F3 no-block DOC → embedded false + note', ext3.embedded === false && !!ext3.note, ext3.note ?? '')

// --- Fixture 4: a non-TELA contract (name registry shape) ---
const registryKeys: Record<string, unknown> = { somename: 'deto1qx', anotherone: 'deto1qy' }
const registryCode = 'Function Register(name String) Uint64\n10 IF EXISTS(name) THEN GOTO 50\nEnd Function'
const cls4 = classifyTela(registryKeys, registryCode)
check('F4 registry contract is not_tela', cls4.kind === 'not_tela', `${cls4.kind} markers=${cls4.markers.join(',')}`)

// --- Fixture 5: collision (both INDEX and DOC markers) → tela_index precedence ---
const collisionKeys: Record<string, unknown> = {
  dURL: 'x.tela',
  DOC1: HEX(1),
  docType: 'TELA-HTML-1',
  fileCheckC: 'c',
}
const cls5 = classifyTela(collisionKeys, '')
check('F5 collision resolves to tela_index', cls5.kind === 'tela_index' && cls5.collision === true, `${cls5.kind} collision=${cls5.collision}`)

// --- Fixture 6: malformed DOC value (non-64-hex) kept raw + flagged, no throw ---
const badDocKeys: Record<string, unknown> = {
  var_header_name: 'App',
  dURL: 'app.tela',
  DOC1: 'not-a-valid-scid',
}
const idx6 = parseTelaIndex(badDocKeys, {})
check('F6 malformed DOC kept raw + flagged', idx6.docs[0]?.malformed === true && idx6.docs[0]?.scid === 'not-a-valid-scid', '')
check('F6 malformed DOC adds parse_note', idx6.parse_notes.some((n) => n.includes('64-hex')), idx6.parse_notes.join('; '))

// --- Fixture 7: empty/garbage code never throws ---
const extEmpty = extractTelaDocContent('')
check('F7 empty code → embedded false, no throw', extEmpty.embedded === false, '')
const clsEmpty = classifyTela(undefined, '')
check('F7 undefined keys → not_tela, no throw', clsEmpty.kind === 'not_tela', '')

// --- Fixture 8: REAL hex-encoded values (DERO.GetSC returns string-key values
// hex-encoded). Modeled on the live "Crypto hammer" app (f4ef31f2…). The parser
// must decode header text AND the double-hex DOC SCID. ---
const enc = (s: string): string => Buffer.from(s, 'utf8').toString('hex')
const realScid = 'f85b2995308ce5c486e4539d91b3e6ee048aaea179ccdfb104efa592c41072d9'
const hexIndexKeys: Record<string, unknown> = {
  nameHdr: '1',
  var_header_name: enc('Crypto hammer'),
  var_header_description: enc('Dero is the crypto hammer that will destroy the monetary system'),
  dURL: enc('c-hammer2-site.tela'),
  mods: enc('vsoo'),
  telaVersion: enc('1.1.0'),
  likes: enc('5'),
  dislikes: enc('1'),
  owner: enc('dero1qyjrv7hqstqgzw8eu5nnh2a8gf9sxttq800ksy43w2vj7ed4swn7uqgdhsv66'),
  DOC1: enc(realScid), // double-hex: 128 chars decoding to the 64-char SCID
}
const idx8 = parseTelaIndex(hexIndexKeys, {})
check('F8 decodes hex var_header_name', idx8.name === 'Crypto hammer', JSON.stringify(idx8.name))
check('F8 decodes hex dURL', idx8.durl === 'c-hammer2-site.tela', JSON.stringify(idx8.durl))
check('F8 decodes hex mods', idx8.mods.length === 1 && idx8.mods[0] === 'vsoo', idx8.mods.join(','))
check('F8 decodes double-hex DOC SCID + NOT malformed', idx8.docs[0]?.scid === realScid && idx8.docs[0]?.malformed === false, `scid=${idx8.docs[0]?.scid?.slice(0, 16)} malformed=${idx8.docs[0]?.malformed}`)
check('F8 no malformed-DOC parse_note', !idx8.parse_notes.some((n) => n.includes('64-hex')), idx8.parse_notes.join('; '))
check('F8 surfaces telaVersion + likes/dislikes', idx8.tela_version === '1.1.0' && idx8.likes === 5 && idx8.dislikes === 1, `v=${idx8.tela_version} likes=${idx8.likes} dislikes=${idx8.dislikes}`)
check('F8 decodes hex owner to dero address', idx8.owner?.startsWith('dero1qyjrv7hq') === true, JSON.stringify(idx8.owner?.slice(0, 16)))
// var_nameHdr fallback (app 2 "Cipher Chess" stored its name there, not var_header_name)
const altNameKeys: Record<string, unknown> = { dURL: enc('cipherchess.tela'), DOC1: enc(realScid), var_nameHdr: enc('Cipher Chess Standalone') }
const idx8b = parseTelaIndex(altNameKeys, {})
check('F8 name falls back to var_nameHdr', idx8b.name === 'Cipher Chess Standalone', JSON.stringify(idx8b.name))

process.stdout.write('\n')
if (failed) {
  process.stderr.write('[check:tela-parse] FAIL — TELA parser fixture regressed.\n')
  process.exit(1)
}
process.stdout.write('[check:tela-parse] OK — all TELA parser fixtures pass.\n')

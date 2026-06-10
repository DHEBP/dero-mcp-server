#!/usr/bin/env npx tsx
/**
 * Search-ranking regression guard for the BM25F docs scorer (src/docs.ts) and
 * the recommend_docs_path concept-intro nudge.
 *
 * Runs the 6 confirmed failure cases that motivated the scorer rewrite (the
 * old binary-substring scorePage failed all but case 6) through the REAL
 * searchDeroDocs / recommendDocsPath against the bundled index, and asserts the
 * after-state. Any future parameter drift (k1, field boosts, b_body, stoplist,
 * the nudge) that re-breaks a case fails CI here.
 *
 * Run via `npm run check:docs-ranking`. Offline — no daemon needed.
 *
 * Baseline (published v0.4.4, measured live 2026-06-10) for context:
 *   1 "dero vs monero"            → integrity/inflation-claim #1 ("vs" matched 144/147 pages)
 *   2 "...how much money..."      → captain #1, balance pages absent
 *   3 beginner intent (recommend) → privacy/payload-proofs + TELA-CLI tutorial
 *   4 captain sponge             → top-3 on generic queries
 *   5 "TELA-INDEX-1"             → spec #1 at score 9, cliff to 1
 *   6 "how does dero hide my balance" → balance-mechanics #1 (already worked)
 */

import { searchDeroDocs } from '../src/docs.js'
import { recommendDocsPath } from '../src/composites/recommend-docs-path.js'

type SearchResult = Awaited<ReturnType<typeof searchDeroDocs>>
type Check = { name: string; ok: boolean; detail: string }

const checks: Check[] = []
function assert(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

const slugs = (r: SearchResult, n: number): string[] =>
  r.results.slice(0, n).map((x) => `${x.product}/${x.slug}`)

const VS_TITLED = new Set([
  'derod/integrity/inflation-claim',
  'derod/integrity/payload-vs-transaction-proofs',
  'deropay/payment-router/escrow-vs-router',
])

async function main(): Promise<void> {
  // Case 1 — "dero vs monero": a Monero-bearing page leads; no vs-titled page in top-3.
  const c1 = await searchDeroDocs({ query: 'dero vs monero', limit: 5 })
  const c1top3 = slugs(c1, 3)
  assert(
    'C1 vs-titled pages demoted out of top-3',
    !c1top3.some((s) => VS_TITLED.has(s)),
    `top3=${c1top3.join(', ')}`,
  )
  assert(
    'C1 Monero page (basics/wallets) leads',
    c1.results[0] && `${c1.results[0].product}/${c1.results[0].slug}` === 'derod/basics/wallets',
    `#1=${c1top3[0]}`,
  )

  // Case 2 — conversational balance question: the dedicated explainers surface in top-3.
  const c2 = await searchDeroDocs({
    query: 'can anyone see how much money I have in my wallet',
    limit: 5,
  })
  const c2top3 = slugs(c2, 3)
  assert(
    'C2 surfaces smart-contract-fundamentals + homomorphic-encryption in top-3',
    c2top3.includes('derod/dvm/smart-contract-fundamentals') &&
      c2top3.includes('derod/privacy/homomorphic-encryption'),
    `top3=${c2top3.join(', ')}`,
  )

  // Case 3 — beginner conceptual intent via recommend_docs_path: orientation page in top-3.
  const c3 = await recommendDocsPath({
    intent:
      "I'm completely new to DERO and want to understand what it is and how the privacy works, where should I start reading",
  })
  const c3top3 = c3.recommended.slice(0, 3).map((x) => `${x.product}/${x.slug}`)
  assert(
    'C3 derod/basics/about in top-3 on beginner intent',
    c3top3.includes('derod/basics/about'),
    `top3=${c3top3.join(', ')}`,
  )

  // Case 3 negative control — a task intent must NOT trigger the about nudge.
  const c3neg = await recommendDocsPath({ intent: 'deploy a TELA app to mainnet' })
  const c3negTop = c3neg.recommended[0]
  assert(
    'C3neg task intent stays TELA, no about injection at #1',
    c3negTop?.product === 'tela',
    `#1=${c3negTop ? `${c3negTop.product}/${c3negTop.slug}` : '<none>'}`,
  )

  // Case 4 — Captain sponge: not top-3 on generic queries.
  for (const q of ['smart contract', 'wallet setup', 'privacy basics']) {
    const r = await searchDeroDocs({ query: q, limit: 5 })
    const top3 = slugs(r, 3)
    assert(
      `C4 captain not top-3 for "${q}"`,
      !top3.includes('derod/captain'),
      `top3=${top3.join(', ')}`,
    )
  }

  // Case 5 — "TELA-INDEX-1": spec #1 with a real margin (cliff→margin conversion).
  const c5 = await searchDeroDocs({ query: 'TELA-INDEX-1', limit: 5 })
  const c5_1 = c5.results[0]
  const c5_2 = c5.results[1]
  assert(
    'C5 tela-index-specification is #1',
    c5_1 && `${c5_1.product}/${c5_1.slug}` === 'tela/tela/tela-index-specification',
    `#1=${c5_1 ? `${c5_1.product}/${c5_1.slug}` : '<none>'}`,
  )
  assert(
    'C5 #1 leads #2 by > 1.4x (no score-9-then-cliff fragility)',
    !!c5_1 && !!c5_2 && c5_1.score > c5_2.score * 1.4,
    `#1=${c5_1?.score} #2=${c5_2?.score}`,
  )

  // Case 6 — MUST NOT REGRESS: balance-mechanics #1, >=2 privacy/balance pages top-5.
  const c6 = await searchDeroDocs({ query: 'how does dero hide my balance', limit: 5 })
  const c6top = c6.results[0]
  assert(
    'C6 balance-mechanics is #1 (no regression)',
    c6top && `${c6top.product}/${c6top.slug}` === 'derod/integrity/balance-mechanics',
    `#1=${c6top ? `${c6top.product}/${c6top.slug}` : '<none>'}`,
  )
  const privacyish = new Set([
    'derod/integrity/balance-mechanics',
    'derod/privacy/account-based-privacy',
    'derod/privacy/homomorphic-encryption',
    'derod/privacy/transaction-privacy',
    'derod/privacy/ring-signatures',
    'derod/privacy',
  ])
  const c6count = slugs(c6, 5).filter((s) => privacyish.has(s)).length
  assert('C6 >=2 privacy/balance pages in top-5', c6count >= 2, `count=${c6count}`)

  process.stdout.write('[check:docs-ranking] verifying 6 confirmed search cases...\n\n')
  let failed = false
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(60)} ${c.ok ? '' : `— ${c.detail}`}\n`)
    if (!c.ok) failed = true
  }

  if (failed) {
    process.stderr.write(
      '\n[check:docs-ranking] FAIL — a confirmed search case regressed. If you tuned a scorer constant or the stoplist, revert or re-baseline deliberately.\n',
    )
    process.exit(1)
  }
  process.stdout.write(`\n[check:docs-ranking] OK — all ${checks.length} ranking assertions pass.\n`)
}

main().catch((err) => {
  process.stderr.write(`[check:docs-ranking] error: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})

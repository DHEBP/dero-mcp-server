#!/usr/bin/env npx tsx
/**
 * Static guard for hand-curated tool → docs citations.
 *
 * For each entry in `RELATED_DOCS_BY_TOOL`:
 *   1. The slug MUST resolve against the bundled docs index for the given product.
 *   2. The title MUST exactly match the bundled docs page title.
 *   3. The canonical_url MUST match the URL the bundled index would produce.
 *
 * Without this check, a docs reorganization could silently produce 404
 * citations in production tool responses. Run in CI.
 *
 * Exit codes:
 *   0 — every citation resolves cleanly.
 *   1 — one or more citations failed; offenders listed on stderr.
 */

import {
  buildDeroCitation,
  FLAGGED_CHAIN_ARTIFACTS,
  RELATED_DOCS_BY_TOOL,
} from '../src/citations.js'
import { getDeroDocPage } from '../src/docs.js'

type Failure = {
  tool: string
  slug: string
  product: string
  reason: string
}

async function check(): Promise<Failure[]> {
  const failures: Failure[] = []

  for (const [tool, entries] of Object.entries(RELATED_DOCS_BY_TOOL)) {
    for (const entry of entries) {
      const expected = buildDeroCitation(entry.product, entry.slug, entry.title)

      let page: Awaited<ReturnType<typeof getDeroDocPage>>
      try {
        page = await getDeroDocPage({ product: entry.product, slug: entry.slug })
      } catch (error) {
        failures.push({
          tool,
          slug: entry.slug,
          product: entry.product,
          reason: `slug did not resolve: ${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }

      if (page.title !== entry.title) {
        failures.push({
          tool,
          slug: entry.slug,
          product: entry.product,
          reason: `title drift — expected "${entry.title}", bundled index has "${page.title}"`,
        })
      }

      if (page.canonical_url !== expected.canonical_url) {
        failures.push({
          tool,
          slug: entry.slug,
          product: entry.product,
          reason: `canonical_url drift — expected ${expected.canonical_url}, bundled index has ${page.canonical_url}`,
        })
      }
    }
  }

  // Validate flagged-artifact citations against the same bundled index.
  // These attach silently when tool inputs match adversarially-cited
  // on-chain artifacts, so a docs reorg breaking them would silently
  // degrade the defense.
  for (const artifact of FLAGGED_CHAIN_ARTIFACTS) {
    for (const entry of artifact.related_docs) {
      const expected = buildDeroCitation(entry.product, entry.slug, entry.title)
      const label = `flagged:${artifact.id}`

      let page: Awaited<ReturnType<typeof getDeroDocPage>>
      try {
        page = await getDeroDocPage({ product: entry.product, slug: entry.slug })
      } catch (error) {
        failures.push({
          tool: label,
          slug: entry.slug,
          product: entry.product,
          reason: `slug did not resolve: ${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }

      if (page.title !== entry.title) {
        failures.push({
          tool: label,
          slug: entry.slug,
          product: entry.product,
          reason: `title drift — expected "${entry.title}", bundled index has "${page.title}"`,
        })
      }

      if (page.canonical_url !== expected.canonical_url) {
        failures.push({
          tool: label,
          slug: entry.slug,
          product: entry.product,
          reason: `canonical_url drift — expected ${expected.canonical_url}, bundled index has ${page.canonical_url}`,
        })
      }
    }
  }

  return failures
}

async function main() {
  const entryCount = Object.values(RELATED_DOCS_BY_TOOL).reduce(
    (n, entries) => n + entries.length,
    0,
  )
  const toolCount = Object.keys(RELATED_DOCS_BY_TOOL).length
  const flaggedCount = FLAGGED_CHAIN_ARTIFACTS.reduce(
    (n, a) => n + a.related_docs.length,
    0,
  )
  console.log(
    `[check:citations] checking ${entryCount} curated citations across ${toolCount} tool(s) + ${flaggedCount} flagged-artifact citations across ${FLAGGED_CHAIN_ARTIFACTS.length} artifact(s)`,
  )

  const failures = await check()

  if (failures.length === 0) {
    console.log(`OK  every citation resolves against bundled docs index`)
    process.exit(0)
  }

  console.error('')
  console.error(`[check:citations] FAIL: ${failures.length} issue(s)`)
  for (const f of failures) {
    console.error(`  - ${f.tool}: [${f.product}] ${f.slug}`)
    console.error(`      ${f.reason}`)
  }
  console.error('')
  console.error('Fix offending entries in src/citations.ts (RELATED_DOCS_BY_TOOL) and rerun:')
  console.error('  npm run check:citations')
  process.exit(1)
}

main()

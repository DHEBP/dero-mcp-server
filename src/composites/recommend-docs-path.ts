/**
 * `recommend_docs_path` — Phase C composite #3.
 *
 * Docs-only composite. Takes a natural-language intent, runs scoped
 * searches across ALL four products in parallel, boosts
 * hint-matching scores by 1.5× (when `product_hint` is provided),
 * groups results by product, and returns a ranked path with
 * per-result rationale and ready-to-cite citations.
 *
 * Wedge: agents currently have to guess which docs product to search
 * (derod for daemon RPC, tela for on-chain apps, hologram for the
 * simulator, deropay for the merchant flow). This composite removes
 * that guess: one call, one ranked answer, with citations the agent
 * can drop straight into a response.
 *
 * Design contract § 3. Sequencing rule: SHIP
 * THIRD. Pure docs composition — no chain reads. Proves the
 * "docs-only composite" pattern that future docs-heavy tools can
 * reuse.
 *
 * Design clarification: the spec text "for each product (or just
 * `product_hint` if provided)" reads like a filter, but the spec's
 * scoring rule ("score by `score * productHintBoost` for hint
 * matches") only makes sense if all four products are always
 * searched and the hint is treated as a BIAS, not a FILTER. Treating
 * the hint as a filter would make the boost a uniform no-op. This
 * implementation searches all four products on every call so the
 * hint scoring carries real weight and the agent still sees relevant
 * cross-product docs (e.g. derod RPC pages that touch TELA).
 *
 * Failure model:
 *   - Zero matches across every product → throw
 *     `'No DERO docs matched intent: "..."'`. The `withStructuredErrors`
 *     wrapper classifies this as `NO_DOCS_MATCH` and emits a hint
 *     telling the agent to rephrase (or change the `product_hint`).
 *   - The bundled docs index missing → propagates the existing
 *     `DOCS_UNAVAILABLE` classification from `searchDeroDocs`.
 */

import { z } from 'zod'
import {
  DERO_DOC_PRODUCTS,
  searchDeroDocs,
  type DeroDocProduct,
} from '../docs.js'
import { buildDeroCitation, type DeroCitation } from '../citations.js'

const PRODUCT_HINT_BOOST = 1.5

export const recommendDocsPathInputSchema = {
  intent: z
    .string()
    .min(8)
    .describe(
      'Natural-language description of what the user wants to do (e.g. "deploy a TELA app", "trace a transaction by hash", "verify a webhook signature").',
    ),
  product_hint: z
    .enum(DERO_DOC_PRODUCTS)
    .optional()
    .describe('Optional bias toward one product (derod | tela | hologram | deropay) when known.'),
  limit_per_product: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Cap per-product search results before merging. Default 2.'),
} as const

type RecommendInput = {
  intent: string
  product_hint?: DeroDocProduct
  limit_per_product?: number
}

/**
 * Per-result shape returned by `searchDeroDocs`. Re-declared here as the
 * minimum surface the composite touches so this module stays decoupled
 * from internal changes to the docs search response.
 */
type SearchHit = {
  product: DeroDocProduct
  slug: string
  title: string
  description?: string
  canonical_url: string
  headings: string[]
  excerpt: string
  score: number
}

type Recommendation = {
  product: DeroDocProduct
  slug: string
  title: string
  canonical_url: string
  score: number
  boosted_score: number
  rationale: string
}

type ByProductSummary = Record<
  DeroDocProduct,
  { count: number; top_slug: string | null; top_score: number | null }
>

/**
 * Pure helper: turn raw per-product hits into a ranked, deduplicated
 * list with boosted scores and rationale strings. Exported so flow
 * tests / future unit tests can call it without spinning up an MCP
 * client.
 */
export function rankRecommendations(
  intent: string,
  productHint: DeroDocProduct | undefined,
  hitsByProduct: ReadonlyMap<DeroDocProduct, readonly SearchHit[]>,
): Recommendation[] {
  const out: Recommendation[] = []
  const seen = new Set<string>()

  for (const [product, hits] of hitsByProduct) {
    for (const hit of hits) {
      const key = `${product}::${hit.slug}`
      if (seen.has(key)) continue
      seen.add(key)
      const boost = product === productHint ? PRODUCT_HINT_BOOST : 1
      const boostedScore = Math.round(hit.score * boost * 100) / 100
      const topHeading = hit.headings[0]
      const rationale = buildRationale(intent, product, hit.score, boost, topHeading)
      out.push({
        product,
        slug: hit.slug,
        title: hit.title,
        canonical_url: hit.canonical_url,
        score: hit.score,
        boosted_score: boostedScore,
        rationale,
      })
    }
  }

  out.sort((a, b) => b.boosted_score - a.boosted_score)
  return out
}

function buildRationale(
  intent: string,
  product: DeroDocProduct,
  rawScore: number,
  boost: number,
  topHeading: string | undefined,
): string {
  const boostNote = boost > 1 ? ` (×${boost} product_hint boost applied)` : ''
  const headingPart = topHeading ? ` Top heading: "${topHeading.slice(0, 80)}".` : ''
  return `Match for "${intent.slice(0, 60)}" under product=${product} (raw score ${rawScore}${boostNote}).${headingPart}`
}

function summarizeByProduct(recs: readonly Recommendation[]): ByProductSummary {
  const out = Object.create(null) as ByProductSummary
  for (const product of DERO_DOC_PRODUCTS) {
    out[product] = { count: 0, top_slug: null, top_score: null }
  }
  for (const rec of recs) {
    const bucket = out[rec.product]
    bucket.count += 1
    if (bucket.top_score === null || rec.boosted_score > bucket.top_score) {
      bucket.top_score = rec.boosted_score
      bucket.top_slug = rec.slug
    }
  }
  return out
}

/**
 * Build top-N citations from the ranked recommendations. Always
 * deduplicated by `product::slug` (which `rankRecommendations` also
 * enforces) so the citation list never lists the same page twice.
 */
function citationsFromRecommendations(
  recs: readonly Recommendation[],
  topN: number,
): DeroCitation[] {
  return recs
    .slice(0, topN)
    .map((rec) => buildDeroCitation(rec.product, rec.slug, rec.title))
}

export async function recommendDocsPath(args: RecommendInput) {
  const intent = args.intent.trim()
  const limitPerProduct = args.limit_per_product ?? 2
  const productHint = args.product_hint

  // Always fan out to all four products. `searchDeroDocs` shares an
  // in-process page cache (15s TTL) so the second+ calls in the batch
  // resolve from memory; the network/disk cost is paid once per cache
  // window. See the module header for why we don't filter to
  // product_hint.
  const searches = await Promise.all(
    DERO_DOC_PRODUCTS.map((product) =>
      searchDeroDocs({ query: intent, product, limit: limitPerProduct }).then(
        (res) => [product, res.results as SearchHit[]] as const,
      ),
    ),
  )

  const hitsByProduct = new Map<DeroDocProduct, readonly SearchHit[]>(searches)
  const recommended = rankRecommendations(intent, productHint, hitsByProduct)

  if (recommended.length === 0) {
    throw new Error(
      `No DERO docs matched intent: "${intent}" across products: ${DERO_DOC_PRODUCTS.join(', ')}. Try rephrasing with product-specific nouns (e.g. "TELA INDEX-1 contract", "DeroPay webhook").`,
    )
  }

  const by_product = summarizeByProduct(recommended)
  const related_docs = citationsFromRecommendations(recommended, 2)

  return {
    intent,
    product_hint: productHint ?? null,
    limit_per_product: limitPerProduct,
    recommended,
    by_product,
    related_docs,
  }
}

/**
 * Citation helper for DERO MCP tool responses.
 *
 * The wedge for this server is the combination of live chain reads and the
 * in-process bundled docs index (145+ pages across derod, tela, hologram,
 * deropay). Citations let agents link their responses back to authoritative
 * docs without a second tool call, and they give downstream composite tools
 * a uniform shape to compose.
 *
 * Design contract:
 *   - One shape, used by primitives and composites alike.
 *   - URLs are produced by the same builder used by `dero_docs_*` so the
 *     citation always points at the same canonical page the agent would
 *     reach via dero_docs_get_page.
 *   - The slug is duplicated as `page_id` to give composites a stable join
 *     key across tools (mirrors the FoodNearMe COMPOSITES.md citation pattern).
 *   - The map of related docs per tool is hand-maintained and validated by
 *     `scripts/check-citations.ts` (added alongside this helper) so a docs
 *     reorganization cannot silently produce 404 citations in production.
 */

import { DOC_BASE_URLS, type DeroDocProduct } from './docs-parse.js'

export type DeroCitation = {
  /** Always `'dero_docs'` for now; future sources (e.g. `'dero_chain'`) can extend this. */
  source: 'dero_docs'
  product: DeroDocProduct
  slug: string
  title: string
  canonical_url: string
  /** Alias of `slug` so composites can use a single join key across tools. */
  page_id: string
}

function buildCanonicalUrl(product: DeroDocProduct, slug: string): string {
  const trimmed = slug.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return `${DOC_BASE_URLS[product]}/`
  return `${DOC_BASE_URLS[product]}/${trimmed}`
}

/**
 * Build a DeroCitation pointing at one bundled docs page.
 *
 * The title is required (not derived from the bundled index) so this helper
 * stays synchronous and zero-IO. It must match the docs page title; the
 * citation guard validates this against the bundled index in CI.
 */
export function buildDeroCitation(
  product: DeroDocProduct,
  slug: string,
  title: string,
): DeroCitation {
  return {
    source: 'dero_docs',
    product,
    slug,
    title,
    canonical_url: buildCanonicalUrl(product, slug),
    page_id: slug,
  }
}

/**
 * Map of MCP tool name → hand-curated related docs pages.
 *
 * Keep this list tight — only add entries when a tool's response is
 * meaningfully improved by linking the agent at a specific page. The CI
 * guard verifies every slug resolves against the bundled docs index, so any
 * docs reorganization will fail the build before it ships.
 *
 * Adding a tool here:
 *   1. Use `dero_docs_search` to find the right slug(s).
 *   2. Add an entry with product + slug + exact page title.
 *   3. Run `npm run check:citations` to confirm slugs resolve.
 */
type RelatedDocsEntry = { product: DeroDocProduct; slug: string; title: string }

export const RELATED_DOCS_BY_TOOL: Record<string, readonly RelatedDocsEntry[]> = {
  dero_get_info: [
    {
      product: 'derod',
      slug: 'rpc-api/daemon-rpc-api',
      title: 'DERO Daemon RPC API: Complete Reference Guide | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'basics/daemon',
      title: 'DERO Daemon: Backbone of the Privacy Blockchain | DERO Blockchain',
    },
  ],
  dero_get_sc: [
    {
      product: 'derod',
      slug: 'dvm/smart-contract-fundamentals',
      title: 'Smart Contract Fundamentals: Understanding DERO Contracts | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'dvm/dero-virtual-machine',
      title: 'DERO Virtual Machine (DVM): Private Smart Contract Platform | DERO Blockchain',
    },
  ],
  dero_get_gas_estimate: [
    {
      product: 'derod',
      slug: 'rpc-api/daemon-rpc-api',
      title: 'DERO Daemon RPC API: Complete Reference Guide | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'dvm/create-deploy-use-smart-contract',
      title: 'Create, Deploy & Use a Smart Contract on DERO | Step-by-Step Tutorial',
    },
  ],
  diagnose_chain_health: [
    {
      product: 'derod',
      slug: 'basics/daemon',
      title: 'DERO Daemon: Backbone of the Privacy Blockchain | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'rpc-api/daemon-rpc-api',
      title: 'DERO Daemon RPC API: Complete Reference Guide | DERO Blockchain',
    },
  ],
  trace_transaction_with_context: [
    {
      product: 'derod',
      slug: 'rpc-api/daemon-rpc-api',
      title: 'DERO Daemon RPC API: Complete Reference Guide | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'dvm/smart-contract-fundamentals',
      title: 'Smart Contract Fundamentals: Understanding DERO Contracts | DERO Blockchain',
    },
  ],
  estimate_deploy_cost: [
    {
      product: 'derod',
      slug: 'dvm/create-deploy-use-smart-contract',
      title: 'Create, Deploy & Use a Smart Contract on DERO | Step-by-Step Tutorial',
    },
    {
      product: 'derod',
      slug: 'dvm/dvm-basic',
      title: "DVM-BASIC: DERO's Smart Contract Language Guide | DERO Blockchain",
    },
  ],
  // Composite #2 (`explain_smart_contract`) curates all four DVM docs so its
  // heuristic can elevate whichever page best matches the detected surface
  // (token / registry / minimal / generic). The composite re-orders this
  // array at runtime; the static ordering here is the fallback when the
  // heuristic returns the same slug already at index 0 (the universal
  // "fundamentals" default).
  explain_smart_contract: [
    {
      product: 'derod',
      slug: 'dvm/smart-contract-fundamentals',
      title: 'Smart Contract Fundamentals: Understanding DERO Contracts | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'dvm/dvm-basic',
      title: "DVM-BASIC: DERO's Smart Contract Language Guide | DERO Blockchain",
    },
    {
      product: 'derod',
      slug: 'dvm/dero-virtual-machine',
      title: 'DERO Virtual Machine (DVM): Private Smart Contract Platform | DERO Blockchain',
    },
    {
      product: 'derod',
      slug: 'dvm/create-deploy-use-smart-contract',
      title: 'Create, Deploy & Use a Smart Contract on DERO | Step-by-Step Tutorial',
    },
  ],
} as const

/**
 * Resolve the hand-curated related docs list for a tool name and return it
 * as fully-built `DeroCitation` objects. Returns `undefined` when the tool
 * has no related docs configured.
 *
 * Use in tool handlers like:
 *   const related_docs = relatedDocsFor('dero_get_sc')
 *   return { ...rpcResult, ...(related_docs ? { related_docs } : {}) }
 */
export function relatedDocsFor(toolName: string): DeroCitation[] | undefined {
  const entries = RELATED_DOCS_BY_TOOL[toolName]
  if (!entries || entries.length === 0) return undefined
  return entries.map((entry) => buildDeroCitation(entry.product, entry.slug, entry.title))
}

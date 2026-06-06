import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DERO_DOC_PRODUCTS,
  type DeroDocProduct,
  type DeroDocsPage,
  type DocsIndexFile,
  indexDocsFromRoot,
  normalizeSlug,
  pathExists,
  resolveDeroDocsRoot,
} from './docs-parse.js'

export { DERO_DOC_PRODUCTS, type DeroDocProduct, resolveDeroDocsRoot } from './docs-parse.js'

const CACHE_TTL_MS = 15000

type DocsSource =
  | { kind: 'bundled'; indexPath: string }
  | { kind: 'filesystem'; root: string }

type LoadedDocs = {
  source: DocsSource
  pages: DeroDocsPage[]
}

let pageCache: { key: string; loadedAt: number; data: LoadedDocs } | null = null

function bundledIndexPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // dist/docs.js -> ../data/docs-index.json
  return path.resolve(here, '../data/docs-index.json')
}

async function loadBundledPages(indexPath: string): Promise<DeroDocsPage[] | null> {
  if (!(await pathExists(indexPath))) return null
  const raw = await fs.readFile(indexPath, 'utf8')
  const parsed = JSON.parse(raw) as DocsIndexFile
  if (!parsed?.pages?.length) return null
  return parsed.pages
}

async function resolveDocsSource(): Promise<DocsSource | null> {
  const overrideRoot = process.env.DERO_DOCS_ROOT?.trim()
  if (overrideRoot) {
    const derodPages = path.join(overrideRoot, 'derod-main', 'pages')
    if (await pathExists(derodPages)) {
      return { kind: 'filesystem', root: overrideRoot }
    }
  }

  const bundledPath = bundledIndexPath()
  if (await pathExists(bundledPath)) {
    return { kind: 'bundled', indexPath: bundledPath }
  }

  return null
}

async function loadPages(): Promise<LoadedDocs> {
  const source = await resolveDocsSource()
  if (!source) {
    throw new Error(
      'DERO docs unavailable. Bundled docs index missing and DERO_DOCS_ROOT is unset or invalid.',
    )
  }

  const cacheKey = source.kind === 'bundled' ? `bundled:${source.indexPath}` : `fs:${source.root}`
  if (pageCache && pageCache.key === cacheKey && Date.now() - pageCache.loadedAt < CACHE_TTL_MS) {
    return pageCache.data
  }

  let pages: DeroDocsPage[]
  if (source.kind === 'bundled') {
    const bundled = await loadBundledPages(source.indexPath)
    if (!bundled) {
      throw new Error('DERO bundled docs index is missing or empty.')
    }
    pages = bundled
  } else {
    pages = await indexDocsFromRoot(source.root)
  }

  const data: LoadedDocs = { source, pages }
  pageCache = { key: cacheKey, loadedAt: Date.now(), data }
  return data
}

function sourceMeta(source: DocsSource) {
  if (source.kind === 'bundled') {
    return { docs_source: 'bundled' as const, bundled_index: path.basename(source.indexPath) }
  }
  return { docs_source: 'filesystem' as const, docs_root: source.root }
}

type SearchArgs = {
  query: string
  product?: DeroDocProduct
  section?: string
  limit?: number
}

function scorePage(page: DeroDocsPage, terms: string[]): number {
  const title = page.title.toLowerCase()
  const slug = page.slug.toLowerCase()
  const headingBlob = page.headings.join(' ').toLowerCase()
  const body = page.plainText.toLowerCase()
  let score = 0

  for (const term of terms) {
    if (title.includes(term)) score += 6
    if (slug.includes(term)) score += 4
    if (headingBlob.includes(term)) score += 2
    if (body.includes(term)) score += 1
  }

  return score
}

/**
 * Lightweight docs-index freshness metadata for /health and dero_docs_list,
 * so an operator can see at a glance whether the live server is serving a
 * current bundle. Reads the bundled index header only; returns nulls when
 * docs come from a filesystem override or the index is unreadable.
 */
export async function docsIndexMeta(): Promise<{
  docs_generated_at: string | null
  docs_page_count: number | null
}> {
  try {
    const source = await resolveDocsSource()
    if (source?.kind !== 'bundled') return { docs_generated_at: null, docs_page_count: null }
    const raw = await fs.readFile(source.indexPath, 'utf8')
    const parsed = JSON.parse(raw) as DocsIndexFile
    return {
      docs_generated_at: parsed.generated_at ?? null,
      docs_page_count: parsed.page_count ?? parsed.pages?.length ?? null,
    }
  } catch {
    return { docs_generated_at: null, docs_page_count: null }
  }
}

export async function listDeroDocs(product?: DeroDocProduct) {
  const { source, pages } = await loadPages()
  const filtered = product ? pages.filter((page) => page.product === product) : pages

  return {
    ...sourceMeta(source),
    total: filtered.length,
    products: DERO_DOC_PRODUCTS,
    pages: filtered.map((page) => ({
      product: page.product,
      slug: page.slug,
      title: page.title,
      canonical_url: page.canonicalUrl,
      last_updated: page.lastUpdated,
    })),
  }
}

export async function searchDeroDocs(args: SearchArgs) {
  const query = args.query.trim()
  if (!query) throw new Error('DERO docs search requires a non-empty query')

  const { source, pages } = await loadPages()
  let filtered = pages
  if (args.product) {
    filtered = filtered.filter((page) => page.product === args.product)
  }
  if (args.section) {
    const normalizedSection = normalizeSlug(args.section).toLowerCase()
    filtered = filtered.filter((page) => {
      const slug = page.slug.toLowerCase()
      return slug === normalizedSection || slug.startsWith(`${normalizedSection}/`)
    })
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)

  const scored = filtered
    .map((page) => ({ page, score: scorePage(page, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = Math.max(1, Math.min(args.limit ?? 8, 25))
  const results = scored.slice(0, limit).map(({ page, score }) => ({
    product: page.product,
    slug: page.slug,
    title: page.title,
    description: page.description,
    canonical_url: page.canonicalUrl,
    headings: page.headings.slice(0, 5),
    excerpt: page.plainText.slice(0, 420),
    score,
  }))

  return {
    ...sourceMeta(source),
    query,
    total_matches: scored.length,
    returned: results.length,
    results,
  }
}

// Per-call content cap. Long pages (e.g. /captain at ~75k chars) need to be
// fetched in slices to stay LLM-context-friendly; callers paginate via offset
// using `content_truncated` + `next_offset` in the response.
const PAGE_CONTENT_CHUNK = 60000

export async function getDeroDocPage(params: {
  product?: DeroDocProduct
  slug: string
  offset?: number
}) {
  const slug = normalizeSlug(params.slug)
  if (!slug) throw new Error('DERO docs get page requires a non-empty slug')

  const { source, pages } = await loadPages()
  const target = pages.find((page) => {
    if (params.product && page.product !== params.product) return false
    return normalizeSlug(page.slug).toLowerCase() === slug.toLowerCase()
  })

  if (!target) {
    throw new Error(
      params.product
        ? `Doc page not found for product=${params.product} slug=${slug}`
        : `Doc page not found for slug=${slug}`,
    )
  }

  const total = target.plainText.length
  const offset = Math.max(0, Math.min(params.offset ?? 0, total))
  const end = Math.min(offset + PAGE_CONTENT_CHUNK, total)
  const truncated = end < total

  return {
    ...sourceMeta(source),
    product: target.product,
    slug: target.slug,
    title: target.title,
    description: target.description,
    canonical_url: target.canonicalUrl,
    last_updated: target.lastUpdated,
    headings: target.headings,
    content: target.plainText.slice(offset, end),
    content_offset: offset,
    content_length: total,
    content_truncated: truncated,
    next_offset: truncated ? end : null,
    source_path: target.sourcePath,
  }
}

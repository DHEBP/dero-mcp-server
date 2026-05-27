import { promises as fs } from 'node:fs'
import path from 'node:path'

export const DERO_DOC_PRODUCTS = ['derod', 'tela', 'hologram', 'deropay'] as const
export type DeroDocProduct = (typeof DERO_DOC_PRODUCTS)[number]

export const DOC_SITE_DIRS: Record<DeroDocProduct, string> = {
  derod: 'derod-main',
  tela: 'tela-main',
  hologram: 'hologram-main',
  deropay: 'deropay-main',
}

export const DOC_BASE_URLS: Record<DeroDocProduct, string> = {
  derod: 'https://derod.org',
  tela: 'https://tela.derod.org',
  hologram: 'https://hologram.derod.org',
  deropay: 'https://pay.derod.org',
}

export type DeroDocsPage = {
  product: DeroDocProduct
  slug: string
  title: string
  description: string | null
  canonicalUrl: string
  sourcePath: string
  headings: string[]
  plainText: string
  lastUpdated: string | null
}

export type DocsIndexFile = {
  version: 1
  generated_at: string
  page_count: number
  pages: DeroDocsPage[]
}

export function normalizeSlug(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function safeTitleFromSlug(slug: string): string {
  if (!slug) return 'Home'
  return slug
    .split('/')
    .at(-1)!
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return {}

  const frontmatter: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const keyValue = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/)
    if (!keyValue) continue
    frontmatter[keyValue[1]] = keyValue[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return frontmatter
}

export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

export function extractHeadings(markdown: string): string[] {
  const headings: string[] = []
  const headingRegex = /^#{1,3}\s+(.+)$/gm
  let match: RegExpExecArray | null = null
  while ((match = headingRegex.exec(markdown)) !== null) {
    headings.push(match[1].trim())
  }
  return headings
}

export function mdxToPlainText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^import\s+.*$/gm, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

async function walkMdxFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMdxFiles(fullPath)))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(fullPath)
    }
  }

  return files
}

function buildCanonicalUrl(product: DeroDocProduct, slug: string): string {
  if (!slug) return `${DOC_BASE_URLS[product]}/`
  // .md mirror suffix points agents at the LLM-canonical Markdown surface.
  // All four ecosystem sites (derod, tela, hologram, deropay) ship the App
  // Router .md mirror route as of 0.2.4.
  return `${DOC_BASE_URLS[product]}/${slug}.md`
}

/**
 * Normalize a frontmatter-supplied canonical URL so it carries the same
 * `.md` suffix as builder-generated URLs. Without this, any MDX page that
 * declared its own `canonicalUrl` in frontmatter would bypass the suffix
 * and point agents at the HTML version.
 */
function applyMdSuffix(_product: DeroDocProduct, url: string): string {
  // Don't double-suffix; preserve query/anchor if present.
  const [base, rest = ''] = url.split(/(?=[?#])/)
  if (/\.md$/.test(base) || /\.[a-z0-9]{2,5}$/i.test(base)) return url
  return `${base}.md${rest}`
}

export async function indexDocsFromRoot(root: string): Promise<DeroDocsPage[]> {
  const pages: DeroDocsPage[] = []

  for (const product of DERO_DOC_PRODUCTS) {
    const siteDir = DOC_SITE_DIRS[product]
    const pagesDir = path.join(root, siteDir, 'pages')
    if (!(await pathExists(pagesDir))) continue

    const files = await walkMdxFiles(pagesDir)
    for (const filePath of files) {
      const raw = await fs.readFile(filePath, 'utf8')
      const frontmatter = parseFrontmatter(raw)
      const content = stripFrontmatter(raw)
      const rel = path.relative(pagesDir, filePath).replace(/\\/g, '/')
      const slug = normalizeSlug(rel.replace(/\.mdx$/, '').replace(/\/index$/, '').replace(/^index$/, ''))
      const headings = extractHeadings(content)

      pages.push({
        product,
        slug,
        title: frontmatter.title || safeTitleFromSlug(slug),
        description: frontmatter.description || null,
        canonicalUrl: applyMdSuffix(product, frontmatter.canonicalUrl || buildCanonicalUrl(product, slug)),
        sourcePath: path.relative(root, filePath).replace(/\\/g, '/'),
        headings,
        plainText: mdxToPlainText(content),
        lastUpdated: frontmatter.lastUpdated || frontmatter.date || null,
      })
    }
  }

  pages.sort((a, b) => {
    if (a.product !== b.product) return a.product.localeCompare(b.product)
    return a.slug.localeCompare(b.slug)
  })

  return pages
}

export async function resolveDeroDocsRoot(customRoot?: string): Promise<string | null> {
  const explicit = customRoot ?? process.env.DERO_DOCS_ROOT
  if (explicit) {
    const derodPages = path.join(explicit, DOC_SITE_DIRS.derod, 'pages')
    return (await pathExists(derodPages)) ? explicit : null
  }

  const autoCandidates = [
    path.resolve(process.cwd(), '../dero-docs'),
    path.resolve(process.cwd(), '../../dero-docs'),
  ]

  for (const candidate of autoCandidates) {
    const derodPages = path.join(candidate, DOC_SITE_DIRS.derod, 'pages')
    if (await pathExists(derodPages)) return candidate
  }

  return null
}

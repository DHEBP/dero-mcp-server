#!/usr/bin/env npx tsx
/**
 * Build bundled docs index for npm distribution.
 * Maintainer runs this before publish when dero-docs is available locally.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexDocsFromRoot, resolveDeroDocsRoot, type DocsIndexFile } from '../src/docs-parse.js'

function parseDocsRoot(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--docs-root' || arg === '--root') && argv[i + 1]) {
      return argv[++i]
    }
    if (arg.startsWith('--docs-root=')) return arg.slice('--docs-root='.length)
    if (arg.startsWith('--root=')) return arg.slice('--root='.length)
  }
  return undefined
}

async function main() {
  const cliRoot = parseDocsRoot(process.argv.slice(2))
  const docsRoot = cliRoot ?? (await resolveDeroDocsRoot())

  if (!docsRoot) {
    console.error('[build:docs] FAIL: dero-docs monorepo not found.')
    console.error('Set DERO_DOCS_ROOT or clone dero-docs as ../dero-docs relative to dero-mcp-server.')
    process.exit(1)
  }

  const pages = await indexDocsFromRoot(docsRoot)
  if (pages.length < 50) {
    console.error(`[build:docs] FAIL: expected 50+ pages, got ${pages.length}`)
    process.exit(1)
  }

  const index: DocsIndexFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    page_count: pages.length,
    pages,
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const outPath = path.join(repoRoot, 'data', 'docs-index.json')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  const byProduct = Object.fromEntries(
    ['derod', 'tela', 'hologram', 'deropay'].map((product) => [
      product,
      pages.filter((p) => p.product === product).length,
    ]),
  )

  console.log(`[build:docs] wrote ${outPath}`)
  console.log(`[build:docs] pages=${pages.length}`, byProduct)
}

main().catch((error) => {
  console.error('[build:docs] FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})

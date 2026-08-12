#!/usr/bin/env npx tsx
/**
 * Smoke probes for dero_docs_* MCP tools.
 *
 * Verifies bundled docs index works with zero local clone (default npm path).
 */
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const PRODUCT_SAMPLES: Array<{
  product: 'derod' | 'tela' | 'hologram' | 'deropay'
  slug: string
  searchQuery: string
  // Code tokens that MUST survive mdx→plaintext. Guards against the
  // fenced-code-stripping regression (the parser once dropped every code
  // block, gutting the most-cited examples while pages still passed the
  // length check). If these vanish, the parser is silently corrupting docs.
  mustContain: string[]
}> = [
  { product: 'derod', slug: 'rpc-api/daemon-rpc-api', searchQuery: 'GetInfo json rpc', mustContain: ['curl', 'DERO.GetInfo', 'jsonrpc'] },
  { product: 'tela', slug: 'tutorials/first-app', searchQuery: 'TELA first app', mustContain: [] },
  { product: 'hologram', slug: 'quick-start', searchQuery: 'simulator wallet', mustContain: [] },
  { product: 'deropay', slug: 'dero-pay/webhooks', searchQuery: 'HMAC webhook', mustContain: [] },
]

function parseFirstTextJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const textEntry = result.content.find((c) => c.type === 'text' && typeof c.text === 'string')
  if (!textEntry?.text) throw new Error('Tool result missing text content')
  return JSON.parse(textEntry.text)
}

async function createClient(envOverrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  delete env.DERO_DOCS_ROOT
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env,
  })
  const client = new Client({ name: 'dero-docs-smoke-probes', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport }
}

async function main() {
  console.log('[smoke:docs] mode=bundled (no DERO_DOCS_ROOT)')
  console.log('================================')

  let passed = 0

  const ok = (label: string) => {
    console.log(`OK  ${label}`)
    passed++
  }

  const { client, transport } = await createClient()

  try {
    const listAll = parseFirstTextJson(
      (await client.callTool({ name: 'dero_docs_list', arguments: { limit: 500 } })) as {
        content: Array<{ type: string; text?: string }>
      },
    ) as { docs_source: string; total: number; pages: Array<{ product: string }> }

    if (listAll.docs_source !== 'bundled') {
      throw new Error(`expected docs_source=bundled, got ${listAll.docs_source}`)
    }
    if (listAll.total < 100) throw new Error(`expected 100+ pages, got ${listAll.total}`)
    for (const product of ['derod', 'tela', 'hologram', 'deropay']) {
      const count = listAll.pages.filter((p) => p.product === product).length
      if (count < 5) throw new Error(`${product} has only ${count} indexed pages`)
    }
    ok(`bundled index (total=${listAll.total}, all 4 products)`)

    for (const sample of PRODUCT_SAMPLES) {
      const search = parseFirstTextJson(
        (await client.callTool({
          name: 'dero_docs_search',
          arguments: { query: sample.searchQuery, product: sample.product, limit: 3 },
        })) as { content: Array<{ type: string; text?: string }> },
      ) as { docs_source: string; returned: number }
      if (search.docs_source !== 'bundled' || search.returned < 1) {
        throw new Error(`bundled search failed for ${sample.product}`)
      }

      const page = parseFirstTextJson(
        (await client.callTool({
          name: 'dero_docs_get_page',
          arguments: { product: sample.product, slug: sample.slug },
        })) as { content: Array<{ type: string; text?: string }> },
      ) as { docs_source: string; slug: string; content: string }
      if (page.docs_source !== 'bundled' || page.slug !== sample.slug || page.content.length < 50) {
        throw new Error(`bundled get_page failed for ${sample.slug}`)
      }

      // Content-fidelity: the cited code examples must survive parsing.
      const missing = sample.mustContain.filter((tok) => !page.content.includes(tok))
      if (missing.length > 0) {
        throw new Error(
          `${sample.slug}: code examples stripped from index — missing [${missing.join(', ')}]. ` +
            `The mdx→plaintext parser is dropping fenced code.`,
        )
      }

      ok(`${sample.product}: search/get (${sample.slug})${sample.mustContain.length ? ` +code[${sample.mustContain.length}]` : ''}`)
    }

    const badSlug = parseFirstTextJson(
      (await client.callTool({
        name: 'dero_docs_get_page',
        arguments: { product: 'derod', slug: 'this-page-does-not-exist-xyz' },
      })) as { content: Array<{ type: string; text?: string }> },
    ) as { ok?: boolean; _meta?: { error?: { code?: string } } }
    if (badSlug.ok !== false || badSlug._meta?.error?.code !== 'DOC_NOT_FOUND') {
      throw new Error('expected DOC_NOT_FOUND structured error')
    }
    ok('DOC_NOT_FOUND error shape')

    await client.close()
    await transport.close()

    // Invalid override should fall back to bundled, not fail.
    const fallback = await createClient({ DERO_DOCS_ROOT: '/tmp/dero-docs-smoke-nonexistent' })
    try {
      const res = parseFirstTextJson(
        (await fallback.client.callTool({
          name: 'dero_docs_search',
          arguments: { query: 'wallet', product: 'derod', limit: 1 },
        })) as { content: Array<{ type: string; text?: string }> },
      ) as { docs_source: string; returned: number }
      if (res.docs_source !== 'bundled' || res.returned < 1) {
        throw new Error('invalid DERO_DOCS_ROOT should fall back to bundled index')
      }
      ok('invalid DERO_DOCS_ROOT falls back to bundled')
    } finally {
      await fallback.client.close()
      await fallback.transport.close()
    }

    console.log('')
    console.log(`Docs smoke probes: ${passed} passed`)
    console.log('All docs smoke probes passed.')
    process.exit(0)
  } catch (error) {
    console.error('')
    console.error('[smoke:docs] FAIL:', error instanceof Error ? error.message : error)
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
    process.exit(1)
  }
}

main()

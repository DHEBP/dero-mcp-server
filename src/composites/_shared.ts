/**
 * Shared utilities for DERO MCP composite tools.
 *
 * A composite tool stitches several primitives (daemon RPC reads + bundled
 * docs lookups) into one intent-shaped response. These utilities exist so
 * every composite handles failures, latency tracking, and citation
 * attachment the same way.
 *
 * Anything reused by more than one composite belongs here. Composite-local
 * helpers (e.g. narrative builders specific to one composite's response
 * shape) should live next to that composite, not in this file.
 *
 * See `docs/composites.md` for the design contract that governs which
 * utilities live here and the gate every composite must satisfy before it
 * lands on main.
 */

import { relatedDocsFor, type DeroCitation } from '../citations.js'

/**
 * One step in a composite's internal chain.
 *
 * `required: true` aborts the chain if the step throws (use for liveness
 * gates like `DERO.Ping`). `required: false` lets the chain continue with
 * a degraded payload (use for enrichments like a mempool snapshot).
 */
export type ChainStep<T = unknown> = {
  name: string
  required?: boolean
  fn: () => Promise<T>
}

export type ChainStepResult = {
  name: string
  ok: boolean
  value?: unknown
  error?: { message: string }
  latencyMs: number
}

export type ChainResult = {
  results: ChainStepResult[]
  haltedAt: string | null
  totalMs: number
}

/**
 * Run a chain of named primitive calls sequentially. Required-step
 * failures halt the chain and record `haltedAt`; non-required failures
 * are recorded and the chain continues. Step latencies are captured so
 * composites can attach diagnostics to a degraded response.
 */
export async function runChain(steps: readonly ChainStep[]): Promise<ChainResult> {
  const results: ChainStepResult[] = []
  const startedAt = performance.now()
  let haltedAt: string | null = null

  for (const step of steps) {
    const stepStart = performance.now()
    try {
      const value = await step.fn()
      results.push({
        name: step.name,
        ok: true,
        value,
        latencyMs: Math.round(performance.now() - stepStart),
      })
    } catch (error) {
      results.push({
        name: step.name,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
        latencyMs: Math.round(performance.now() - stepStart),
      })
      if (step.required) {
        haltedAt = step.name
        break
      }
    }
  }

  return {
    results,
    haltedAt,
    totalMs: Math.round(performance.now() - startedAt),
  }
}

/**
 * Extract a single step's successful return value from a ChainResult.
 * Returns null when the step was skipped (chain halted earlier), failed,
 * or simply was not part of the chain.
 */
export function stepValue<T = unknown>(chain: ChainResult, name: string): T | null {
  const entry = chain.results.find((r) => r.name === name)
  if (!entry || !entry.ok) return null
  return entry.value as T
}

/**
 * Per-step latency map suitable for embedding in a composite's response
 * under a `_diagnostics` field. Lets agents and operators see which step
 * was slow without needing to instrument the host.
 */
export function stepLatencies(chain: ChainResult): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of chain.results) out[r.name] = r.latencyMs
  return out
}

/**
 * Attach curated `related_docs` citations to a composite's payload.
 * Mirrors how primitives attach citations so the response shape stays
 * uniform across primitives and composites. Returns the payload
 * unchanged when no curated docs are configured for the tool name.
 */
export function attachCitations<T extends Record<string, unknown>>(
  payload: T,
  toolName: string,
): T & { related_docs?: DeroCitation[] } {
  const related_docs = relatedDocsFor(toolName)
  if (!related_docs || related_docs.length === 0) return payload
  return { ...payload, related_docs }
}

/**
 * Shape used by the JSON-RPC `rpc` closure created in `src/server.ts`.
 * Re-declared here so composites can take it as a dependency without
 * importing from the server module (keeps the composite layer free of
 * `McpServer` coupling).
 */
export type DeroDaemonRpc = <T = unknown>(method: string, params?: unknown) => Promise<T>

const DEFAULT_TIMEOUT_MS = 45_000

export type JsonRpcResponse<T = unknown> = {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

/**
 * POST JSON-RPC 2.0 to a DERO daemon or wallet endpoint (…/json_rpc).
 */
export async function deroJsonRpc<T = unknown>(
  jsonRpcUrl: string,
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: 'dero-mcp',
    method,
  }
  if (params !== undefined) body.params = params

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(jsonRpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
    }
    let json: JsonRpcResponse<T>
    try {
      json = JSON.parse(text) as JsonRpcResponse<T>
    } catch {
      throw new Error(`Invalid JSON from node: ${text.slice(0, 200)}`)
    }
    if (json.error) {
      throw new Error(
        `RPC error ${json.error.code}: ${json.error.message}${json.error.data != null ? ` ${JSON.stringify(json.error.data)}` : ''}`,
      )
    }
    return json.result as T
  } finally {
    clearTimeout(timer)
  }
}

export function jsonRpcEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  return trimmed.endsWith('/json_rpc') ? trimmed : `${trimmed}/json_rpc`
}

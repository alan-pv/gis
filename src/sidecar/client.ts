/**
 * client.ts — browser client for the interpreter agent.
 *
 * The only provider is the hybrid sidecar (sidecar/server.py), reached through
 * the Vite dev proxy at /api/sidecar (Vite server.proxy). The envelope it
 * returns is NOT validated here: the validator does that when it is applied.
 */
import type { CanvasState } from '@/contract/index.js'

export type InterpretResult =
  | {
      ok: true
      envelope: unknown
      /**
       * Readable cause when the text model (ollama) failed on a turn where Laya
       * did decide content (timeout, ollama error, out of VRAM, empty reply).
       * The turn is NOT a legitimate no-op.
       */
      textError?: string
    }
  | { ok: false; error: string }

/** true if the sidecar answers /health (through the Vite proxy). */
export async function checkSidecar(): Promise<boolean> {
  try {
    const response = await fetch('/api/sidecar/health')
    return response.ok
  } catch {
    return false
  }
}

/**
 * Sends one utterance plus the current canvas state to the sidecar and returns
 * the raw envelope. Never throws: any failure becomes { ok: false, error }.
 */
export async function interpretUtterance(
  state: CanvasState,
  utterance: string,
): Promise<InterpretResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  try {
    let response: Response
    try {
      response = await fetch('/api/sidecar/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, utterance }),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false, error: 'The sidecar request took more than 30 seconds.' }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Network error (sidecar): ${message}` }
    }

    if (!response.ok) {
      const detail = await response
        .json()
        .then((json: unknown) => {
          const errJson = json as Record<string, unknown>
          return typeof errJson['error'] === 'string' ? errJson['error'] : JSON.stringify(errJson)
        })
        .catch(() => response.statusText)
      return { ok: false, error: `Sidecar error (${response.status}): ${detail}` }
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      return { ok: false, error: 'The sidecar response is not valid JSON.' }
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'The sidecar response is not a JSON object.' }
    }

    const obj = data as Record<string, unknown>
    if (!('envelope' in obj)) {
      return { ok: false, error: 'The sidecar response has no "envelope".' }
    }

    const textError = parseTextError(obj)
    return {
      ok: true,
      envelope: obj['envelope'],
      ...(textError !== undefined ? { textError } : {}),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Top-level `textError` (or nested in `metrics`); only if non-empty text. */
function parseTextError(obj: Record<string, unknown>): string | undefined {
  const direct = obj['textError']
  if (typeof direct === 'string' && direct.trim() !== '') return direct
  const m = obj['metrics']
  if (m !== null && typeof m === 'object' && !Array.isArray(m)) {
    const nested = (m as Record<string, unknown>)['textError']
    if (typeof nested === 'string' && nested.trim() !== '') return nested
  }
  return undefined
}

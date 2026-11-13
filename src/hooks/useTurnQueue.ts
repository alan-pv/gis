/**
 * useTurnQueue — the live session core: a queue of utterances, drained one at a
 * time. Each utterance goes to the sidecar together with the board state; the
 * returned envelope is applied to the board through the same path as the rest.
 *
 * `enqueuePhrase` is the only entry point to the queue (continuous speech, push to
 * talk and the typed phrase all go through it), so no phrase is silently lost
 * while the model is busy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { EnvelopeSchema } from '@/contract/index.js'
import type { Library } from '@/library/index.js'
import { documentToAgentState } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'
import { interpretUtterance } from '@/sidecar/index.js'
import { parseEnvelopeText } from '@/validator/parse-envelope-text.js'
import type { ValidationMode } from '@/validator/index.js'
import { gateClause } from '@/speech/index.js'
import { enqueue, markProcessing, markDone, markDiscarded, markError, nextPending, prune } from '@/speech/queue.js'
import type { Queue, QueueItem } from '@/speech/queue.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'
import type { ApplyEnvelopeResult } from './useDocumentState.js'

/** Size of the window of recent phrases sent as context. */
const RECENT_WINDOW = 3

/**
 * Result of `interpret()`: the queue-draining effect needs the timings and the
 * outcome to mark the item (`done` / `error`).
 */
interface TurnOutcome {
  ok: boolean
  llmMs: number | null
  applyMs: number | null
  opsAccepted: number
  opsRejected: number
  envelopeValid: boolean
  error: string | null
  /** The text model failed (the turn is not a legitimate no-op). */
  textError?: string
}

export interface UseTurnQueueOptions {
  document: GisDocument
  library: Library
  applyEnvelope: (raw: unknown, library: Library, canvas: { width: number; height: number }, mode?: ValidationMode) => ApplyEnvelopeResult
  isRunning: boolean
  isInterpreting: boolean
  setIsRunning: (running: boolean) => void
  setIsInterpreting: (interpreting: boolean) => void
  setParseError: (error: string | null) => void
  setAgentInfo: (info: string | null) => void
  /** Hides the shape menu and the selection: the board may change. */
  clearTransient: () => void
  /** Shows the envelope the sidecar returned (developer console). */
  showTurn: (envelopeText: string, utterance: string) => void
}

export function useTurnQueue({
  document, library, applyEnvelope, isRunning, isInterpreting, setIsRunning, setIsInterpreting,
  setParseError, setAgentInfo, clearTransient, showTurn,
}: UseTurnQueueOptions) {
  /** Text of the teacher-phrase input. */
  const [agentInput, setAgentInput] = useState('')
  /** Sliding window of previous phrases (does NOT include the current one). */
  const [recentUtterances, setRecentUtterances] = useState<string[]>([])
  /** Queue of pending / in-progress / finished phrases (pure logic in src/speech/queue.ts). */
  const [queue, setQueue] = useState<Queue>([])
  /** Re-entrancy guard of the draining effect: never two drains at once. */
  const drainingRef = useRef(false)

  /**
   * Core of the interpretation cycle, parameterized by the raw text and the mode.
   * Called from the queue-draining effect with mode='live'. Returns an
   * `TurnOutcome` so the caller can record llmMs/applyMs/ops and mark the queue item.
   */
  const interpret = useCallback(async (raw: string, mode: ValidationMode): Promise<TurnOutcome> => {
    const utterance = raw.trim()
    const empty: TurnOutcome = {
      ok: false, llmMs: null, applyMs: null, opsAccepted: 0, opsRejected: 0,
      envelopeValid: false, error: null,
    }
    if (!utterance || isRunning || isInterpreting) return empty

    setIsInterpreting(true)
    setParseError(null)
    setAgentInfo(null)
    // Interpreting an envelope may change the canvas: hide the menu and the selection
    clearTransient()

    // try/finally: `setIsInterpreting(false)` must run no matter what. Without it, a
    // throw halfway leaves the flag `true` forever and blocks both the queue drain
    // and the manual button. The catch returns a normal 'ok: false' result.
    try {
      // Canvas state with the PREVIOUS phrases (not the current one).
      // recentUtterances is global to the document: it follows the teacher, not the page.
      const canvasState = documentToAgentState(
        document,
        { width: CANVAS_W, height: CANVAS_H },
        recentUtterances,
      )

      const llmStart = performance.now()
      const result = await interpretUtterance(canvasState, utterance)
      const llmMs = performance.now() - llmStart

      if (!result.ok) {
        setParseError(result.error)
        return { ok: false, llmMs, applyMs: null, opsAccepted: 0, opsRejected: 0, envelopeValid: false, error: result.error }
      }

      // Show the envelope in the developer console
      const prettyEnvelope = JSON.stringify(result.envelope, null, 2)
      showTurn(prettyEnvelope, utterance)
      // Laya decided content but the text model failed: visible warning through the
      // same error channel (never a silent no-op).
      setParseError(result.textError ? `Text model: ${result.textError}` : null)

      // Apply the envelope through the same code path as the console "Run" button
      let applyMs: number | null = null
      let opsAccepted = 0
      const parsed = parseEnvelopeText(prettyEnvelope)
      if (parsed.ok) {
        // Apply timing: only the layout computation, not the animation.
        const applyStart = performance.now()
        const { steps, accepted } = applyEnvelope(parsed.envelope, library, { width: CANVAS_W, height: CANVAS_H }, mode)
        applyMs = performance.now() - applyStart
        opsAccepted = accepted
        if (steps > 0) {
          setIsRunning(true)
        } else {
          if (!result.textError) setAgentInfo('🤫 The agent decided to draw nothing for this phrase (empty response — valid and common)')
        }
      }

      const parsedForValidity = EnvelopeSchema.safeParse(result.envelope)
      const envelopeValid = parsedForValidity.success
      const opsRejected = envelopeValid
        ? Math.max(0, parsedForValidity.data.operations.length - opsAccepted)
        : 0

      // Add the current phrase to the buffer (RECENT_WINDOW window)
      setRecentUtterances(prev => {
        const next = [...prev, utterance]
        return next.slice(-RECENT_WINDOW)
      })

      // Clear the phrase input
      setAgentInput('')

      return {
        ok: true, llmMs, applyMs, opsAccepted, opsRejected, envelopeValid, error: null,
        ...(result.textError ? { textError: result.textError } : {}),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setParseError(message)
      return { ...empty, error: message }
    } finally {
      setIsInterpreting(false)
    }
  }, [isRunning, isInterpreting, document, recentUtterances, library, applyEnvelope,
    setIsInterpreting, setParseError, setAgentInfo, clearTransient, showTurn, setIsRunning])

  /**
   * Enqueues a new item. Single entry point to the queue: it never calls
   * `interpret` directly, so no phrase is lost while the model is busy.
   */
  const enqueuePhrase = useCallback((
    text: string,
    source: QueueItem['source'],
    datos: {
      audioMs: number | null
      sttMs: number | null
      /** STT provider that produced `text`. undefined = not applicable (typed phrase). */
      stt?: 'webspeech' | null
      /** Only 'webspeech': ms from the press to the first partial result. */
      sttFirstPartialMs?: number | null
      /** true if `text` was emitted by early cut. */
      earlyCut?: boolean | null
    },
  ) => {
    // Early guard: the VAD closes clauses very often and many transcribe to an empty
    // or whitespace-only string (silence, noise, an "uh"). They are ignored HERE,
    // BEFORE creating the item: no row, no record. This differs from the gate's
    // rejection (real text the gate does not accept), which stays visible as
    // 'discarded' with its "Force" button.
    if (text.trim() === '') return
    const item: QueueItem = {
      id: crypto.randomUUID(),
      text,
      status: 'pending',
      ts: Date.now(),
      source,
      audioMs: datos.audioMs,
      sttMs: datos.sttMs,
      stt: datos.stt ?? null,
      sttFirstPartialMs: datos.sttFirstPartialMs ?? null,
      earlyCut: datos.earlyCut ?? null,
      gateReason: null,
      llmMs: null,
      applyMs: null,
      opsAccepted: null,
      opsRejected: null,
      error: null,
    }
    // The gate only applies to continuous mode: a typed phrase is explicit intent
    // of the teacher and skips the gate.
    if (source === 'continuous') {
      const decision = gateClause(text)
      if (!decision.pass) {
        setQueue(prev => prune(markDiscarded(enqueue(prev, item), item.id, decision.reason)))
        return
      }
    }
    setQueue(prev => prune(enqueue(prev, item)))
  }, [])

  /** "Interpret" button / Enter: enqueues the input phrase as 'manual'. */
  const handleInterpret = useCallback(() => {
    const utterance = agentInput.trim()
    if (!utterance) return
    enqueuePhrase(utterance, 'manual', { audioMs: null, sttMs: null })
    setAgentInput('')
  }, [agentInput, enqueuePhrase])

  /** Per-item "Force": re-enqueues a `discarded` item as `pending`, skipping the gate. */
  const handleForceItem = useCallback((id: string) => {
    setQueue(prev => prev.map(item => (item.id === id ? { ...item, status: 'pending' as const, gateReason: null } : item)))
  }, [])

  /** "Clear finished": removes `done` / `discarded` / `error` items from the queue. */
  const handleClearQueue = useCallback(() => {
    setQueue(prev => prev.filter(item => item.status === 'pending' || item.status === 'processing'))
  }, [])

  /**
   * Queue-draining effect: when nothing is running (`isRunning`/`isInterpreting`) and
   * `nextPending(queue)` returns an item, it marks it `processing` and
   * interprets it. When done it marks the item (`done` / `error`) and — since `setQueue`
   * changes — the effect fires again by itself and takes the next one: that is the
   * auto-advance. `drainingRef` prevents two drains at once.
   */
  useEffect(() => {
    if (isRunning || isInterpreting) return
    if (drainingRef.current) return

    const next = nextPending(queue)
    if (!next) return

    drainingRef.current = true

    void (async () => {
      // try/finally: if any step in here throws, `drainingRef` must be released anyway —
      // otherwise the queue stops draining forever. The catch also leaves the failure
      // visible on the queue item (markError) instead of losing it.
      try {
        // The setState goes inside the async wrapper (not directly in the effect body)
        // to avoid synchronous cascading renders.
        setQueue(prev => markProcessing(prev, next.id))

        const result = await interpret(next.text, 'live')

        setQueue(prev =>
          result.ok && !result.textError
            ? markDone(prev, next.id, {
                llmMs: result.llmMs ?? 0,
                applyMs: result.applyMs ?? 0,
                opsAccepted: result.opsAccepted,
                opsRejected: result.opsRejected,
              })
            : markError(
                prev,
                next.id,
                result.error ??
                  (result.textError ? `Text model: ${result.textError}` : 'Unknown error while interpreting'),
              ),
        )

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setQueue(prev => markError(prev, next.id, message))
      } finally {
        drainingRef.current = false
      }
    })()
  }, [queue, isRunning, isInterpreting, interpret])

  /** Part of the full board reset: empties the context, the input and the queue. */
  const reset = useCallback(() => {
    setAgentInput('')
    setRecentUtterances([])
    // A zombie 'processing' item would not block draining (nextPending only
    // looks at 'pending'), but it would stay visible in the queue panel for no reason.
    setQueue([])
  }, [])

  return {
    queue, agentInput, setAgentInput, recentUtterances, enqueuePhrase,
    handleInterpret, handleForceItem, handleClearQueue, reset,
  }
}

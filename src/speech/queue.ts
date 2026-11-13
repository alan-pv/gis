/**
 * queue.ts — queue of phrases waiting to be interpreted (pure logic).
 *
 * `onClause` always enqueues (a phrase is never dropped silently while the model
 * is busy); the auto-advance effect in App.tsx drains the queue one item at a
 * time, always taking the oldest `pending` item. The `discarded` status makes the
 * gate's verdict (src/speech/gate.ts) visible instead of losing the phrase.
 *
 * No React, no fetch, no mutation: pure reducers, testable with Vitest.
 */

// ── Public types ──────────────────────────────────────────────────────────────

/** Status of a queue item. */
export type ItemStatus =
  | 'pending' // enqueued, waiting its turn
  | 'processing' // the model is interpreting it right now
  | 'done' // interpreted and applied
  | 'discarded' // rejected by the gate (visible, NOT silent)
  | 'error' // STT or the interpreter failed

/** Queue item: a phrase and its journey through the pipeline. */
export interface QueueItem {
  id: string
  text: string
  status: ItemStatus
  /** Creation timestamp (epoch ms), used to order by age. */
  ts: number
  source: 'continuous' | 'manual'
  audioMs: number | null
  sttMs: number | null
  /**
   * Which STT provider produced `text`. Absent on typed phrases (no STT involved).
   * Optional on purpose so that previously saved sessions keep loading.
   */
  stt?: 'webspeech' | null
  /**
   * Milliseconds from pressing push-to-talk to the browser's first partial
   * result (only when `stt === 'webspeech'`). Optional, absent otherwise.
   */
  sttFirstPartialMs?: number | null
  /**
   * true if `text` was emitted by an early cut: the partial stayed unchanged for
   * the configured time and was sent before the browser's `isFinal`. Optional,
   * absent/false otherwise (including typed phrases).
   */
  earlyCut?: boolean | null
  /** Gate reason (GateDecision.reason) when status === 'discarded'. */
  gateReason: string | null
  llmMs: number | null
  applyMs: number | null
  opsAccepted: number | null
  opsRejected: number | null
  error: string | null
}

/** The queue is simply an ordered list of items (arrival order). */
export type Queue = QueueItem[]

// ── Maximum number of finished items that prune() keeps by default ───────────

const MAX_FINISHED_DEFAULT = 50

// ── enqueue ───────────────────────────────────────────────────────────────────

/** Appends `item` to the end of the queue. Does not mutate `queue`. */
export function enqueue(queue: Queue, item: QueueItem): Queue {
  return [...queue, item]
}

// ── Status transition helpers ─────────────────────────────────────────────────

/** Applies `changes` to the item with `id`; leaves the rest untouched. Does not mutate. */
function updateItem(queue: Queue, id: string, changes: Partial<QueueItem>): Queue {
  return queue.map((item) => (item.id === id ? { ...item, ...changes } : item))
}

// ── markProcessing ────────────────────────────────────────────────────────────

/** Moves item `id` to `processing`. Does not mutate `queue`. */
export function markProcessing(queue: Queue, id: string): Queue {
  return updateItem(queue, id, { status: 'processing' })
}

// ── markDone ──────────────────────────────────────────────────────────────────

/** Data available once an item has been interpreted and applied. */
export interface DoneData {
  llmMs: number
  applyMs: number
  opsAccepted: number
  opsRejected: number
}

/** Moves item `id` to `done` with its final metrics. Does not mutate `queue`. */
export function markDone(queue: Queue, id: string, data: DoneData): Queue {
  return updateItem(queue, id, {
    status: 'done',
    llmMs: data.llmMs,
    applyMs: data.applyMs,
    opsAccepted: data.opsAccepted,
    opsRejected: data.opsRejected,
  })
}

// ── markDiscarded ─────────────────────────────────────────────────────────────

/** Moves item `id` to `discarded` (visible gate rejection). Does not mutate `queue`. */
export function markDiscarded(queue: Queue, id: string, reason: string): Queue {
  return updateItem(queue, id, { status: 'discarded', gateReason: reason })
}

// ── markError ─────────────────────────────────────────────────────────────────

/** Moves item `id` to `error` (STT or the interpreter failed). Does not mutate `queue`. */
export function markError(queue: Queue, id: string, message: string): Queue {
  return updateItem(queue, id, { status: 'error', error: message })
}

// ── nextPending ───────────────────────────────────────────────────────────────

/**
 * Returns the oldest `pending` item (the one auto-advance takes next), or `null`
 * if there is none. Does not mutate `queue`.
 */
export function nextPending(queue: Queue): QueueItem | null {
  const pendingItems = queue.filter((item) => item.status === 'pending')
  if (pendingItems.length === 0) return null
  return pendingItems.reduce((oldest, item) => (item.ts < oldest.ts ? item : oldest))
}

// ── prune ─────────────────────────────────────────────────────────────────────

/**
 * Trims the queue so it cannot grow without bound: keeps ALL `pending` /
 * `processing` items (never dropped, however many there are) and at most the
 * last `max` finished ones (`done` / `discarded` / `error`), counted in arrival
 * order (the most recent are kept).
 *
 * Does not mutate `queue`. The relative order of the kept items is preserved.
 */
export function prune(queue: Queue, max: number = MAX_FINISHED_DEFAULT): Queue {
  const inProgress = queue.filter((item) => item.status === 'pending' || item.status === 'processing')
  const finishedItems = queue.filter((item) => item.status !== 'pending' && item.status !== 'processing')
  const keptFinished = max <= 0 ? [] : finishedItems.slice(Math.max(0, finishedItems.length - max))

  const keptIds = new Set([...inProgress, ...keptFinished].map((item) => item.id))
  // Iterate the original queue to preserve the relative arrival order.
  return queue.filter((item) => keptIds.has(item.id))
}

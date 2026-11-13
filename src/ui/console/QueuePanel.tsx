/**
 * QueuePanel.tsx — list of queued phrases for the developer console.
 *
 * Pure rendering over the `Queue` (logic lives in `src/speech/queue.ts`): it
 * mutates nothing and only emits `onForce` / `onClear` so App.tsx updates the state.
 *
 * Vertical list, newest first, with its own scroll. Each row shows a status chip
 * and the timings as they become known (stt on enqueue, llm/apply when finished).
 */
import type { Queue, QueueItem, ItemStatus } from '@/speech/queue.js'
import styles from './QueuePanel.module.css'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface QueuePanelProps {
  /** Whole queue (every status); the panel decides how to order and show it. */
  queue: Queue
  /** Re-enqueues a discarded item as `pending`, skipping the gate. */
  onForce: (id: string) => void
  /** Removes every finished item (`done` / `discarded` / `error`) from the queue. */
  onClear: () => void
}

// ── Presentation helpers ───────────────────────────────────────────────────

/** Short label of each status chip. */
const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'queued',
  processing: 'processing',
  done: 'done',
  discarded: 'discarded',
  error: 'error',
}

/** Formats milliseconds as seconds with one decimal (e.g. "1.6s"). */
function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** Builds the timings/ops detail of a row from whatever is already known. */
function detailOf(item: QueueItem): string {
  const parts: string[] = []
  if (item.sttMs !== null) parts.push(`stt ${formatMs(item.sttMs)}`)
  if (item.llmMs !== null) parts.push(`llm ${formatMs(item.llmMs)}`)
  if (item.opsAccepted !== null) parts.push(`${item.opsAccepted} ops`)
  if (item.status === 'discarded' && item.gateReason) parts.push(`gate: ${item.gateReason}`)
  if (item.status === 'error' && item.error) parts.push(item.error)
  return parts.join(' · ')
}

// ── Component ────────────────────────────────────────────────────────────────

export function QueuePanel({ queue, onForce, onClear }: QueuePanelProps) {
  const queued = queue.filter((i) => i.status === 'pending' || i.status === 'processing').length
  const processed = queue.filter((i) => i.status === 'done' || i.status === 'discarded' || i.status === 'error').length
  // Newest first (the queue is stored in arrival order).
  const newestFirst = [...queue].reverse()

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.counter}>{queued} queued · {processed} processed</span>
        <button
          type="button"
          className={styles.clear}
          onClick={onClear}
          disabled={processed === 0}
        >
          Clear finished
        </button>
      </div>
      <ul className={styles.list} role="log" aria-live="polite">
        {newestFirst.length === 0 && (
          <li className={styles.empty}>No phrases yet.</li>
        )}
        {newestFirst.map((item) => (
          <li key={item.id} className={styles.row}>
            <span className={`${styles.chip} ${styles[item.status]}`} aria-hidden="true" />
            <span className={styles.text} title={item.text}>{item.text || '(empty)'}</span>
            <span className={styles.detail}>{detailOf(item)}</span>
            {item.status === 'discarded' && (
              <button
                type="button"
                className={styles.force}
                onClick={() => onForce(item.id)}
                title="Force the interpretation of this phrase, skipping the gate"
              >
                Force
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.legend} aria-hidden="true">
        {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((status) => (
          <span key={status} className={styles.legendItem}>
            <span className={`${styles.chip} ${styles[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  )
}

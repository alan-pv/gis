/**
 * queue.test.ts — tests for the pure phrase-queue reducers.
 */
import { describe, expect, it } from 'vitest'
import {
  enqueue,
  markDiscarded,
  markError,
  markDone,
  markProcessing,
  prune,
  nextPending,
} from './queue.js'
import type { Queue, QueueItem, ItemStatus } from './queue.js'

/** Builds a test QueueItem with overrides. */
function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    text: 'dibuja un sol',
    status: 'pending',
    ts: Date.now(),
    source: 'continuous',
    audioMs: null,
    sttMs: null,
    gateReason: null,
    llmMs: null,
    applyMs: null,
    opsAccepted: null,
    opsRejected: null,
    error: null,
    ...overrides,
  }
}

describe('enqueue', () => {
  it('appends the item to an empty queue', () => {
    const a = item({ id: 'a' })
    const queue = enqueue([], a)
    expect(queue).toEqual([a])
  })

  it('appends at the end, preserving previous items', () => {
    const a = item({ id: 'a' })
    const b = item({ id: 'b' })
    const queue = enqueue([a], b)
    expect(queue.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the input queue', () => {
    const original: Queue = [item({ id: 'a' })]
    const originalCopy = [...original]
    enqueue(original, item({ id: 'b' }))
    expect(original).toEqual(originalCopy)
  })
})

describe('markProcessing', () => {
  it('moves the given item to processing without touching the others', () => {
    const a = item({ id: 'a', status: 'pending' })
    const b = item({ id: 'b', status: 'pending' })
    const result = markProcessing([a, b], 'a')
    expect(result.find((i) => i.id === 'a')?.status).toBe('processing')
    expect(result.find((i) => i.id === 'b')?.status).toBe('pending')
  })

  it('does not mutate the input queue', () => {
    const queue: Queue = [item({ id: 'a', status: 'pending' })]
    markProcessing(queue, 'a')
    expect(queue[0]?.status).toBe('pending')
  })

  it('unknown id: the queue stays the same', () => {
    const queue: Queue = [item({ id: 'a', status: 'pending' })]
    const result = markProcessing(queue, 'no-existe')
    expect(result).toEqual(queue)
  })
})

describe('markDone', () => {
  it('sets status done and the final metrics', () => {
    const a = item({ id: 'a', status: 'processing' })
    const result = markDone([a], 'a', {
      llmMs: 1800,
      applyMs: 40,
      opsAccepted: 2,
      opsRejected: 1,
    })
    const updated = result.find((i) => i.id === 'a')
    expect(updated?.status).toBe('done')
    expect(updated?.llmMs).toBe(1800)
    expect(updated?.applyMs).toBe(40)
    expect(updated?.opsAccepted).toBe(2)
    expect(updated?.opsRejected).toBe(1)
  })

  it('does not mutate the input queue', () => {
    const queue: Queue = [item({ id: 'a', status: 'processing' })]
    markDone(queue, 'a', { llmMs: 1, applyMs: 1, opsAccepted: 0, opsRejected: 0 })
    expect(queue[0]?.status).toBe('processing')
  })
})

describe('markDiscarded', () => {
  it('sets status discarded with the gateReason (visible, not silent)', () => {
    const a = item({ id: 'a', status: 'pending' })
    const result = markDiscarded([a], 'a', 'no-content')
    const updated = result.find((i) => i.id === 'a')
    expect(updated?.status).toBe('discarded')
    expect(updated?.gateReason).toBe('no-content')
  })

  it('does not mutate the input queue', () => {
    const queue: Queue = [item({ id: 'a', status: 'pending' })]
    markDiscarded(queue, 'a', 'empty')
    expect(queue[0]?.status).toBe('pending')
    expect(queue[0]?.gateReason).toBeNull()
  })
})

describe('markError', () => {
  it('sets status error with the message', () => {
    const a = item({ id: 'a', status: 'processing' })
    const result = markError([a], 'a', 'timeout del intérprete')
    const updated = result.find((i) => i.id === 'a')
    expect(updated?.status).toBe('error')
    expect(updated?.error).toBe('timeout del intérprete')
  })

  it('does not mutate the input queue', () => {
    const queue: Queue = [item({ id: 'a', status: 'processing' })]
    markError(queue, 'a', 'boom')
    expect(queue[0]?.status).toBe('processing')
    expect(queue[0]?.error).toBeNull()
  })
})

describe('nextPending', () => {
  it('empty queue → null', () => {
    expect(nextPending([])).toBeNull()
  })

  it('queue without any pending item → null', () => {
    const queue: Queue = [
      item({ id: 'a', status: 'done' }),
      item({ id: 'b', status: 'processing' }),
      item({ id: 'c', status: 'error' }),
    ]
    expect(nextPending(queue)).toBeNull()
  })

  it('mixed queue: returns the oldest pending item, not the first in the list', () => {
    const queue: Queue = [
      item({ id: 'hecha-vieja', status: 'done', ts: 100 }),
      item({ id: 'pending-new', status: 'pending', ts: 500 }),
      item({ id: 'pendiente-viejo', status: 'pending', ts: 300 }),
      item({ id: 'processing', status: 'processing', ts: 50 }),
    ]
    const result = nextPending(queue)
    expect(result?.id).toBe('pendiente-viejo')
  })

  it('a single pending item among finished ones: returns it', () => {
    const queue: Queue = [
      item({ id: 'a', status: 'discarded', ts: 10 }),
      item({ id: 'b', status: 'pending', ts: 20 }),
      item({ id: 'c', status: 'done', ts: 30 }),
    ]
    expect(nextPending(queue)?.id).toBe('b')
  })
})

describe('prune', () => {
  it('keeps every pending/processing item even beyond max', () => {
    const inProgress: Queue = Array.from({ length: 10 }, (_, i) =>
      item({ id: `p${i}`, status: i % 2 === 0 ? 'pending' : 'processing', ts: i }),
    )
    const result = prune(inProgress, 3)
    expect(result).toHaveLength(10)
  })

  it('never drops a pending or processing item, even mixed with excess finished ones', () => {
    const queue: Queue = [
      ...Array.from({ length: 5 }, (_, i) => item({ id: `pend${i}`, status: 'pending' as ItemStatus, ts: i })),
      item({ id: 'proc', status: 'processing', ts: 5 }),
      ...Array.from({ length: 100 }, (_, i) =>
        item({ id: `term${i}`, status: 'done' as ItemStatus, ts: 10 + i }),
      ),
    ]
    const result = prune(queue, 5)

    const idsPendientesYProcesando = queue
      .filter((i) => i.status === 'pending' || i.status === 'processing')
      .map((i) => i.id)
    const resultIds = new Set(result.map((i) => i.id))

    for (const id of idsPendientesYProcesando) {
      expect(resultIds.has(id)).toBe(true)
    }
  })

  it('keeps only the last max finished items (the most recent)', () => {
    const finished: Queue = Array.from({ length: 10 }, (_, i) =>
      item({ id: `term${i}`, status: 'done', ts: i }),
    )
    const result = prune(finished, 3)
    expect(result.map((i) => i.id)).toEqual(['term7', 'term8', 'term9'])
  })

  it('with max=0, drops every finished item but no in-progress one', () => {
    const queue: Queue = [
      item({ id: 'pend', status: 'pending', ts: 1 }),
      item({ id: 'term1', status: 'done', ts: 2 }),
      item({ id: 'term2', status: 'discarded', ts: 3 }),
    ]
    const result = prune(queue, 0)
    expect(result.map((i) => i.id)).toEqual(['pend'])
  })

  it('counts the three finished statuses (done/discarded/error) against max', () => {
    const queue: Queue = [
      item({ id: 't1', status: 'done', ts: 1 }),
      item({ id: 't2', status: 'discarded', ts: 2 }),
      item({ id: 't3', status: 'error', ts: 3 }),
    ]
    const result = prune(queue, 2)
    expect(result.map((i) => i.id)).toEqual(['t2', 't3'])
  })

  it('uses max=50 by default', () => {
    const finished: Queue = Array.from({ length: 60 }, (_, i) =>
      item({ id: `term${i}`, status: 'done', ts: i }),
    )
    const result = prune(finished)
    expect(result).toHaveLength(50)
    expect(result[0]?.id).toBe('term10')
  })

  it('does not mutate the input queue', () => {
    const queue: Queue = Array.from({ length: 5 }, (_, i) => item({ id: `t${i}`, status: 'done', ts: i }))
    const copy = [...queue]
    prune(queue, 2)
    expect(queue).toEqual(copy)
  })

  it('preserves the relative arrival order of the kept items', () => {
    const queue: Queue = [
      item({ id: 'a', status: 'done', ts: 1 }),
      item({ id: 'b', status: 'pending', ts: 2 }),
      item({ id: 'c', status: 'done', ts: 3 }),
      item({ id: 'd', status: 'processing', ts: 4 }),
    ]
    const result = prune(queue, 50)
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

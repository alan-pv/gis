/**
 * webspeech.test.ts — tests for the `webspeech` provider with a fake
 * `SpeechRecognition` installed on `window`.
 *
 * There is no real Web Speech API in happy-dom, so the test installs a toy
 * implementation that fires the same events (`onresult` / `onerror` / `onend`) as
 * the real browser and checks that the module interprets them the way a real
 * consumer would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startWebSpeechPtt, startWebSpeechContinuous } from './webspeech.js'

// ── Fake SpeechRecognition ────────────────────────────────────────────────

/** Alternative of a result: only the field the module reads (`transcript`). */
function alternative(transcript: string) {
  return { transcript, confidence: 0.9 }
}

/** A toy SpeechRecognitionResult: array-like with `isFinal`. */
function fakeResult(transcript: string, isFinal: boolean) {
  const alt = alternative(transcript)
  const arr = [alt] as unknown as { isFinal: boolean; length: number; item(i: number): unknown } & ArrayLike<typeof alt>
  ;(arr as unknown as { isFinal: boolean }).isFinal = isFinal
  return arr
}

/** Last instance created: the test uses it to fire "browser" events. */
let lastInstance: FakeSpeechRecognition | null = null

/**
 * ALL instances created in the current test, in order: used by the
 * `startWebSpeechContinuous` tests to check that an automatic restart creates a
 * NEW instance (different from the previous one) instead of reusing the old one.
 */
let instances: FakeSpeechRecognition[] = []

class FakeSpeechRecognition {
  lang = ''
  interimResults = false
  maxAlternatives = 1
  continuous = false
  onresult: ((event: { resultIndex: number; results: ArrayLike<unknown> }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null

  startCalled = false
  stopCalled = false
  abortCalled = false

  start(): void {
    this.startCalled = true
  }

  /** The real stop() is asynchronous: the last results and then onend arrive later. */
  stop(): void {
    this.stopCalled = true
  }

  /** Used by startWebSpeechContinuous (real silence: discards, does not wait for results). */
  abort(): void {
    this.abortCalled = true
  }
}

/**
 * Proxy over the constructor: captures the newly created instance in
 * `lastInstance` without aliasing `this` (avoids @typescript-eslint/no-this-alias
 * and keeps the class above free of test-harness details).
 */
const CapturingCtor = new Proxy(FakeSpeechRecognition, {
  construct(target, args): FakeSpeechRecognition {
    const instance = new target(...(args as []))
    lastInstance = instance
    instances.push(instance)
    return instance
  },
})

beforeEach(() => {
  lastInstance = null
  instances = []
  ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = CapturingCtor
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
})

// ── Browser without support ──────────────────────────────────────────────────────

describe('startWebSpeechPtt — browser without support', () => {
  it('throws if neither SpeechRecognition nor webkitSpeechRecognition exists', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    expect(() => startWebSpeechPtt()).toThrow(/Web Speech API is not available/)
  })
})

// ── Session configuration ────────────────────────────────────────────────

describe('startWebSpeechPtt — configuration', () => {
  it('start() with lang en-US, interimResults=true, maxAlternatives=1', () => {
    startWebSpeechPtt()
    expect(lastInstance).not.toBeNull()
    expect(lastInstance?.lang).toBe('en-US')
    expect(lastInstance?.interimResults).toBe(true)
    expect(lastInstance?.maxAlternatives).toBe(1)
    expect(lastInstance?.startCalled).toBe(true)
  })
})

// ── Start/stop flow → final phrase ────────────────────────────────────────────

describe('startWebSpeechPtt — final flow', () => {
  it('a final result → text with that transcript; the browser stop() is propagated', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })

    const promesa = handle.stop()
    expect(inst.stopCalled).toBe(true)
    // The browser fires onend AFTER stop() (really async); simulated with a microtask.
    queueMicrotask(() => inst.onend?.())

    const result = await promesa
    expect(result.text).toBe('draw the sun')
    expect(result.error).toBeNull()
    expect(result.sttMs).toBeGreaterThanOrEqual(0)
  })

  it('several final results are concatenated in order', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the', true)] })
    inst.onresult?.({ resultIndex: 1, results: [fakeResult('draw the', true), fakeResult('sun', true)] })

    const promesa = handle.stop()
    queueMicrotask(() => inst.onend?.())
    const result = await promesa
    expect(result.text).toBe('draw the sun')
  })

  it('no result at all (silence) → empty text, does not throw', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!

    const promesa = handle.stop()
    queueMicrotask(() => inst.onend?.())
    const result = await promesa
    expect(result.text).toBe('')
    expect(result.error).toBeNull()
  })

  it('if onend already fired before stop() is called, it resolves immediately', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('hello', true)] })
    inst.onend?.() // the browser already closed the session by itself

    const result = await handle.stop()
    expect(result.text).toBe('hello')
  })
})

// ── Partials and sttFirstPartialMs ────────────────────────────────────────────

describe('startWebSpeechPtt — partial results', () => {
  it('onPartial is called with every result (interim and final)', () => {
    const parciales: string[] = []
    startWebSpeechPtt({ onPartial: (t) => parciales.push(t) })
    const inst = lastInstance!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw', false)] })
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })

    expect(parciales).toEqual(['draw', 'draw the sun'])
  })

  it('sttFirstPartialMs is measured from start() to the first non-empty text', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!

    // A first empty result does not count as the "first partial".
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('', false)] })
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw', false)] })
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })

    const promesa = handle.stop()
    queueMicrotask(() => inst.onend?.())
    const result = await promesa
    expect(result.sttFirstPartialMs).not.toBeNull()
    expect(result.sttFirstPartialMs as number).toBeGreaterThanOrEqual(0)
  })

  it('no non-empty partial → sttFirstPartialMs null', async () => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!
    const promesa = handle.stop()
    queueMicrotask(() => inst.onend?.())
    const result = await promesa
    expect(result.sttFirstPartialMs).toBeNull()
  })
})

// ── Errors (they must never break a class) ──────────────────

describe('startWebSpeechPtt — browser errors', () => {
  it.each([
    ['no-speech', /no speech was detected/],
    ['network', /network error/],
    ['not-allowed', /permission/],
    ['aborted', /aborted/],
  ])('%s is translated to a readable message without throwing', async (code, expected) => {
    const handle = startWebSpeechPtt()
    const inst = lastInstance!

    inst.onerror?.({ error: code })
    const promesa = handle.stop()
    queueMicrotask(() => inst.onend?.())
    const result = await promesa

    expect(result.error).toMatch(expected)
    // Empty phrase: the caller discards it like any phrase without speech; the
    // module neither throws nor forces text, it only reports.
    expect(result.text).toBe('')
  })
})

// ── startWebSpeechContinuous ─────────────────────────────────────────────────────
//
// Uses fake timers: automatic restarts go through setTimeout (backoff, or 0 ms on
// a normal close), so the clock has to be advanced by hand.

describe('startWebSpeechContinuous — browser without support', () => {
  it('throws if neither SpeechRecognition nor webkitSpeechRecognition exists', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    expect(() => startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn() })).toThrow(
      /Web Speech API is not available/,
    )
  })
})

describe('startWebSpeechContinuous — configuration', () => {
  it('starts with lang en-US, interimResults=true, maxAlternatives=1, continuous=true', () => {
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn() })
    expect(instances).toHaveLength(1)
    const inst = instances[0]!
    expect(inst.lang).toBe('en-US')
    expect(inst.interimResults).toBe(true)
    expect(inst.maxAlternatives).toBe(1)
    expect(inst.continuous).toBe(true)
    expect(inst.startCalled).toBe(true)
  })
})

describe('startWebSpeechContinuous — final phrases', () => {
  it('a non-empty final result → onPhrase with the text and metrics', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() })
    const inst = instances[0]!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw', false)] })
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })

    expect(onPhrase).toHaveBeenCalledTimes(1)
    const [text, metrics] = onPhrase.mock.calls[0] as [string, { sttMs: number; sttFirstPartialMs: number | null }]
    expect(text).toBe('draw the sun')
    expect(metrics.sttMs).toBeGreaterThanOrEqual(0)
    expect(metrics.sttFirstPartialMs).not.toBeNull()
  })

  it('an empty final result does not call onPhrase (silence transcribed to nothing)', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() })
    const inst = instances[0]!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('  ', true)] })

    expect(onPhrase).not.toHaveBeenCalled()
  })

  it('onPartial receives every interim result of the phrase in progress', () => {
    const onPartial = vi.fn()
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn(), onPartial })
    const inst = instances[0]!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw', false)] })
    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the', false)] })

    expect(onPartial).toHaveBeenCalledTimes(2)
  })

  it('several phrases in a row in the same session: each fires its own onPhrase', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() })
    const inst = instances[0]!

    inst.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })
    inst.onresult?.({ resultIndex: 1, results: [fakeResult('draw the sun', true), fakeResult('now the sky', true)] })

    expect(onPhrase).toHaveBeenCalledTimes(2)
    expect(onPhrase.mock.calls[0]![0]).toBe('draw the sun')
    expect(onPhrase.mock.calls[1]![0]).toBe('now the sky')
  })
})

describe('startWebSpeechContinuous — automatic restart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('the browser closes the session by itself (onend without error) → restarts with a new instance', () => {
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn() })
    expect(instances).toHaveLength(1)
    const first = instances[0]!

    first.onend?.()
    vi.advanceTimersByTime(0)

    expect(instances).toHaveLength(2)
    expect(instances[1]).not.toBe(first)
    expect(instances[1]!.startCalled).toBe(true)
  })

  it('after stop(), the browser onend does NOT restart', () => {
    const handle = startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn() })
    const first = instances[0]!

    handle.stop()
    expect(first.abortCalled).toBe(true)

    // The browser may deliver onend late, after abort().
    first.onend?.()
    vi.advanceTimersByTime(10_000)

    expect(instances).toHaveLength(1) // no new instance
  })

  it('stop() before an already scheduled restart (backoff) fires cancels that restart', () => {
    const handle = startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal: vi.fn() })
    const first = instances[0]!

    // network onerror (counts as an error) + onend schedules a restart with backoff > 0.
    first.onerror?.({ error: 'network' })
    first.onend?.()

    // stop() is called BEFORE the scheduled timer fires.
    handle.stop()
    vi.advanceTimersByTime(10_000)

    expect(instances).toHaveLength(1) // the scheduled restart never ran
  })
})

describe('startWebSpeechContinuous — errors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('not-allowed stops listening (onFatal, no retry)', () => {
    const onFatal = vi.fn()
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal })
    const first = instances[0]!

    first.onerror?.({ error: 'not-allowed' })
    expect(onFatal).toHaveBeenCalledTimes(1)
    expect((onFatal.mock.calls[0]![0] as string)).toMatch(/permission/)

    // onend may arrive after the error; it must not restart.
    first.onend?.()
    vi.advanceTimersByTime(10_000)
    expect(instances).toHaveLength(1)
  })

  it('audio-capture stops listening just like not-allowed', () => {
    const onFatal = vi.fn()
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal })
    const first = instances[0]!

    first.onerror?.({ error: 'audio-capture' })
    first.onend?.()
    vi.advanceTimersByTime(10_000)

    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(instances).toHaveLength(1)
  })

  it('no-speech does not count toward the retry limit (restarts anyway, no backoff)', () => {
    const onFatal = vi.fn()
    const onError = vi.fn()
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal, onError })

    for (let i = 0; i < 10; i++) {
      const actual = instances[instances.length - 1]!
      actual.onerror?.({ error: 'no-speech' })
      actual.onend?.()
      vi.advanceTimersByTime(0)
    }

    expect(onFatal).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(10)
    expect(instances).toHaveLength(11) // 1 initial + 10 restarts
  })

  it('5 consecutive network errors (no final phrase in between) → onFatal, stops', () => {
    const onFatal = vi.fn()
    startWebSpeechContinuous({ onPhrase: vi.fn(), onFatal })

    for (let i = 0; i < 5; i++) {
      const actual = instances[instances.length - 1]!
      actual.onerror?.({ error: 'network' })
      actual.onend?.()
      vi.advanceTimersByTime(10_000) // enough for any backoff
    }

    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(onFatal.mock.calls[0]![0]).toMatch(/too many consecutive errors/)
  })

  it('a successful final phrase resets the counter: errors do not accumulate across streaks', () => {
    const onFatal = vi.fn()
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal })

    // 4 network errors (one fewer than the limit) with a restart between each.
    for (let i = 0; i < 4; i++) {
      const actual = instances[instances.length - 1]!
      actual.onerror?.({ error: 'network' })
      actual.onend?.()
      vi.advanceTimersByTime(10_000)
    }
    expect(onFatal).not.toHaveBeenCalled()

    // A successfully recognized phrase resets the counter.
    const actual = instances[instances.length - 1]!
    actual.onresult?.({ resultIndex: 0, results: [fakeResult('draw the sun', true)] })
    expect(onPhrase).toHaveBeenCalledTimes(1)

    // 4 more errors must NOT reach the limit (the counter was reset to 0).
    for (let i = 0; i < 4; i++) {
      const actual2 = instances[instances.length - 1]!
      actual2.onerror?.({ error: 'network' })
      actual2.onend?.()
      vi.advanceTimersByTime(10_000)
    }
    expect(onFatal).not.toHaveBeenCalled()
  })
})

// ── Cut by duration cap ───────────────────────────────────────────────────────
//
// options.maxPhraseMs: until that time from the segment start it NEVER cuts (only
// isFinal emits); past the cap it cuts at the first micro-pause (earlyCutMs, 250
// if 0) or, as a hard ceiling, at maxPhraseMs + 1500.

describe('startWebSpeechContinuous — cut by duration cap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  const parcial = (t: string) => ({ resultIndex: 0, results: [fakeResult(t, false)] })
  const final = (t: string) => ({ resultIndex: 0, results: [fakeResult(t, true)] })

  it('maxPhraseMs=0 → never cuts, only isFinal emits', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 0 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(60_000)
    expect(onPhrase).not.toHaveBeenCalled()

    inst.onresult?.(final('draw the sun'))
    expect(onPhrase).toHaveBeenCalledTimes(1)
    expect((onPhrase.mock.calls[0]![1] as { earlyCut?: boolean }).earlyCut).toBe(false)
  })

  it('does not cut before maxPhraseMs even with long pauses', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(5_900)

    expect(onPhrase).not.toHaveBeenCalled()
  })

  it('past the cap, cuts at the first micro-pause (earlyCut=true)', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(5_000)
    inst.onresult?.(parcial('draw the sun and the sky'))
    vi.advanceTimersByTime(900) // t = 5900
    expect(onPhrase).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100) // t = 6000: cap reached and more than 250 ms already passed without change
    expect(onPhrase).toHaveBeenCalledTimes(1)
    const [text, metrics] = onPhrase.mock.calls[0] as [string, { sttMs: number; earlyCut?: boolean }]
    expect(text).toBe('draw the sun and the sky')
    expect(metrics.earlyCut).toBe(true)
  })

  it('the micro-pause counts from the last change even if it happens right before the cap', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(5_900)
    inst.onresult?.(parcial('draw the sun and'))
    vi.advanceTimersByTime(200) // t = 6100: cap exceeded, only 200 ms without change
    expect(onPhrase).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50) // t = 6150: 250 ms without change
    expect(onPhrase).toHaveBeenCalledTimes(1)
    expect(onPhrase.mock.calls[0]![0]).toBe('draw the sun and')
  })

  it('earlyCutMs=0 uses a 250 ms micro-pause after the cap', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { maxPhraseMs: 1000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(999)
    expect(onPhrase).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onPhrase).toHaveBeenCalledTimes(1)
  })

  it('hard ceiling: with no micro-pause, cuts at maxPhraseMs + 1500', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    // The partial changes every 100 ms: there are never 250 ms of calm.
    let text = 'one two three'
    inst.onresult?.(parcial(text))
    for (let t = 100; t < 7_500; t += 100) {
      vi.advanceTimersByTime(100)
      text += ' w'
      inst.onresult?.(parcial(text))
    }
    expect(onPhrase).not.toHaveBeenCalled() // t = 7400
    vi.advanceTimersByTime(100) // t = 7500
    expect(onPhrase).toHaveBeenCalledTimes(1)
    expect((onPhrase.mock.calls[0]![1] as { earlyCut?: boolean }).earlyCut).toBe(true)
  })

  it('a partial with fewer than 3 words does not cut even past the cap', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('the sun'))
    vi.advanceTimersByTime(60_000)

    expect(onPhrase).not.toHaveBeenCalled()
  })

  it('repeated cuts in a long phrase emit only the new text', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('the water goes up'))
    vi.advanceTimersByTime(6_250)
    expect(onPhrase).toHaveBeenCalledTimes(1)
    expect(onPhrase.mock.calls[0]![0]).toBe('the water goes up')

    // Second segment: the clock started at the previous cut.
    inst.onresult?.(parcial('the water goes up and then'))
    vi.advanceTimersByTime(5_000)
    expect(onPhrase).toHaveBeenCalledTimes(1) // the new segment's cap has not elapsed yet
    inst.onresult?.(parcial('the water goes up and then it cools down'))
    vi.advanceTimersByTime(1_250)
    expect(onPhrase).toHaveBeenCalledTimes(2)
    expect(onPhrase.mock.calls[1]![0]).toBe('and then it cools down')
  })

  it('fewer than 3 new words after a cut: keeps waiting', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('the water goes up'))
    vi.advanceTimersByTime(6_250)
    expect(onPhrase).toHaveBeenCalledTimes(1)

    inst.onresult?.(parcial('the water goes up and then'))
    vi.advanceTimersByTime(30_000)
    expect(onPhrase).toHaveBeenCalledTimes(1)
  })

  it('a final identical to the already cut text does not duplicate', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(6_250)
    expect(onPhrase).toHaveBeenCalledTimes(1)

    inst.onresult?.(final('draw the sun'))
    expect(onPhrase).toHaveBeenCalledTimes(1)
  })

  it('a final that only corrects/adds <= 2 words at the end does not duplicate', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(6_250)
    inst.onresult?.(final('draw the sun now'))

    expect(onPhrase).toHaveBeenCalledTimes(1)
  })

  it('a final after several cuts emits only the tail not yet emitted', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('the water goes up'))
    vi.advanceTimersByTime(6_250)
    inst.onresult?.(parcial('the water goes up and then it cools'))
    vi.advanceTimersByTime(6_250)
    expect(onPhrase).toHaveBeenCalledTimes(2)
    expect(onPhrase.mock.calls[1]![0]).toBe('and then it cools')

    inst.onresult?.(final('the water goes up and then it cools and forms a cloud'))
    expect(onPhrase).toHaveBeenCalledTimes(3)
    expect(onPhrase.mock.calls[2]![0]).toBe('and forms a cloud')
    expect((onPhrase.mock.calls[2]![1] as { earlyCut?: boolean }).earlyCut).toBe(false)
  })

  it('a substantially different final is not re-sent and is logged to the console', () => {
    const onPhrase = vi.fn()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(6_250)
    inst.onresult?.(final('erase the whole board please'))

    expect(onPhrase).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(
      '[webspeech] early cut differs from the final',
      expect.objectContaining({ earlyCut: 'draw the sun', final: 'erase the whole board please' }),
    )
  })

  it('after the final, the next phrase starts with a clean clock and state', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    vi.advanceTimersByTime(6_250)
    inst.onresult?.(final('draw the sun'))
    vi.advanceTimersByTime(1_000)

    inst.onresult?.(parcial('now the sky'))
    vi.advanceTimersByTime(5_000)
    expect(onPhrase).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_250)
    expect(onPhrase).toHaveBeenCalledTimes(2)
    expect(onPhrase.mock.calls[1]![0]).toBe('now the sky')
  })

  it('stop() cancels the pending cut timer', () => {
    const onPhrase = vi.fn()
    const handle = startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    handle.stop()
    vi.advanceTimersByTime(60_000)

    expect(onPhrase).not.toHaveBeenCalled()
  })

  it('isFinal cancels the pending timer', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    inst.onresult?.(final('draw the sun'))
    vi.advanceTimersByTime(60_000)

    expect(onPhrase).toHaveBeenCalledTimes(1)
  })

  it('onend cancels the pending timer', () => {
    const onPhrase = vi.fn()
    startWebSpeechContinuous({ onPhrase, onFatal: vi.fn() }, { earlyCutMs: 250, maxPhraseMs: 6000 })
    const inst = instances[0]!

    inst.onresult?.(parcial('draw the sun'))
    inst.onend?.()
    vi.advanceTimersByTime(60_000)

    expect(onPhrase).not.toHaveBeenCalled()
  })
})

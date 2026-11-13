/**
 * webspeech.ts — `webspeech` STT provider: the browser's Web Speech API
 * (Chrome/Edge, transcription runs in Google's cloud). Experimental, opt-in.
 *
 * There are no integration tests against a real browser: `SpeechRecognition` does
 * not exist in happy-dom. The tests inject a fake `SpeechRecognition` into
 * `window` (webspeech.test.ts), which exercises this module end to end without
 * mocking its internals.
 *
 * Two modes, two functions:
 *   - `startWebSpeechPtt`: push-to-talk. No continuous recognition: the session
 *     lasts exactly as long as the teacher holds the control. Kept as a test
 *     path in the developer console.
 *   - `startWebSpeechContinuous`: continuous mode, the same UX as the main
 *     `MicButton`: one click starts listening, every phrase the browser closes
 *     with `isFinal` is delivered by `onPhrase`, and the browser may end the
 *     session on its own (long silence, ~60 s limit, `no-speech`); unless the
 *     teacher muted, it restarts itself. `stop()` = `abort()` + never restart.
 *
 * In both modes the final text enters the SAME phrase queue
 * (`src/speech/queue.ts`): the interpreter never knows which STT produced it.
 *
 * The TypeScript lib.dom.d.ts ships the auxiliary Web Speech types
 * (`SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent`, ...) but NOT
 * `SpeechRecognition` itself nor its constructor (nor the `webkit` prefix), so
 * they are declared here with `declare global`.
 */

import { CUT_CEILING_EXTRA_MS, EARLY_CUT_MS, MAX_PHRASE_MS } from './defaults.js'

// ── Ambient types missing from lib.dom.d.ts ──────────────────────────────

interface SpeechRecognition extends EventTarget {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

// ── getSpeechRecognitionCtor ───────────────────────────────────────────────────

/** The constructor available in this browser, or undefined if there is none. */
function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

// ── Error mapping (a recognition failure must never break a class) ───────────

/**
 * Translates a SpeechRecognitionErrorEvent code into a readable message.
 * `no-speech` is not really an operational error (the teacher simply said
 * nothing): it is described anyway for visibility, but the caller treats it as an
 * empty phrase, not as a failure.
 */
function errorMessage(code: string): string {
  switch (code) {
    case 'no-speech':
      return 'Web Speech API: no speech was detected.'
    case 'network':
      return 'Web Speech API: network error (needs internet — transcription runs in the Google cloud).'
    case 'not-allowed':
      return 'Web Speech API: microphone permission denied.'
    case 'aborted':
      return 'Web Speech API: recognition aborted.'
    case 'audio-capture':
      return 'Web Speech API: could not capture audio from the microphone.'
    default:
      return `Web Speech API: error "${code}".`
  }
}

// ── Cut by duration cap ───────────────────────────────────────────────────────
//
// Rule: prefer waiting for the end of the phrase (`isFinal`), but if it takes
// longer than `maxPhraseMs` (`MAX_PHRASE_MS` in `defaults.ts`; 0 = no cap),
// cut.
//   - Phase 1: from the segment's first partial up to `maxPhraseMs` it NEVER cuts;
//     only `isFinal` emits.
//   - Phase 2: past `maxPhraseMs` without `isFinal`, it cuts at the first
//     micro-pause (partial unchanged, normalized, for `earlyCutMs`;
//     0 means `EARLY_CUT_MS`). Hard ceiling: with no micro-pause
//     it cuts anyway at `maxPhraseMs + 1500` ms from the segment start.
//   - After a cut only the NEW text relative to what was already emitted in the
//     phrase is emitted, and the segment clock restarts at the cut (a long
//     monologue comes out in chunks of ~`maxPhraseMs`). Each chunk needs >= 3 new
//     words.
//   - The later `isFinal` emits only the part not yet emitted
//     (`compareCutWithFinal`).
// Why: cutting on pause alone (250 ms) sent fragments ("a tube called", "we are
// going to") and the interpreter produced bad output. In recorded sessions the
// median phrase lasts ~4 s (p75 5.3 s): with a 6 s cap ~80 % arrive whole.

/** Trim + lowercase + collapsed whitespace: comparison tolerant to cosmetic diffs. */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Words of an already normalized text (empty array if the normalized text is ''). */
function wordsOf(normalized: string): string[] {
  return normalized === '' ? [] : normalized.split(' ')
}

/** Number of identical leading words between two word lists. */
function commonWordPrefix(a: string[], b: string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Result of comparing the text already emitted by an early cut against the real `isFinal`. */
export type CutFinalComparison =
  | { kind: 'duplicate' }
  | { kind: 'suffix'; text: string }
  | { kind: 'different' }

/**
 * Decides what to do when the `isFinal` of a phrase that was ALREADY emitted by an
 * early cut arrives (verbatim text on each side, not normalized).
 *
 * - 'duplicate': the final equals the cut, or only adds/corrects <= 2 words at the
 *   end (same utterance, not re-sent).
 * - 'suffix': the cut is an exact prefix (fully confirmed) of the final, which
 *   adds MORE than 2 new words: only that tail is sent, as a separate phrase.
 * - 'different': the final is not a minor extension/correction of the cut
 *   (something changed before the end): not re-sent, only logged.
 */
export function compareCutWithFinal(rawCut: string, rawFinal: string): CutFinalComparison {
  const cutNorm = normalizeText(rawCut)
  const finalNorm = normalizeText(rawFinal)
  if (cutNorm === finalNorm) return { kind: 'duplicate' }

  const cutWords = wordsOf(cutNorm)
  const finalWords = wordsOf(finalNorm)
  const k = commonWordPrefix(cutWords, finalWords)

  const unconfirmedCutTail = cutWords.length - k
  const newFinalTail = finalWords.length - k

  // Short correction or extension (<= 2 words) at the end: same utterance.
  if (unconfirmedCutTail <= 2 && newFinalTail <= 2) {
    return { kind: 'duplicate' }
  }

  // The cut was fully confirmed (exact prefix) and the final adds more than 2 new
  // words: send only that tail, taken from the RAW final text (keeps the original
  // capitalization and punctuation, not the normalized version).
  if (unconfirmedCutTail === 0 && newFinalTail > 2) {
    const rawFinalWords = rawFinal.trim().split(/\s+/)
    const suffix = rawFinalWords.slice(rawFinalWords.length - newFinalTail).join(' ')
    return { kind: 'suffix', text: suffix }
  }

  return { kind: 'different' }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface WebSpeechPttCallbacks {
  /** Partial (interim) transcript, exactly as the browser delivers it. */
  onPartial?: (text: string) => void
}

export interface WebSpeechPttResult {
  /** VERBATIM final text (concatenation of the results marked isFinal). */
  text: string
  /** Milliseconds from releasing the control (stop()) until the final result. */
  sttMs: number
  /** Milliseconds from pressing (start()) until the first partial result; null if there was none. */
  sttFirstPartialMs: number | null
  /** Message of the last error reported by the browser during the session, or null. */
  error: string | null
}

export interface WebSpeechPttHandle {
  /** Stops recognition and resolves with the final text + metrics of this press. */
  stop(): Promise<WebSpeechPttResult>
}

// ── startWebSpeechPtt ──────────────────────────────────────────────────────────

/**
 * Starts a push-to-talk session with the Web Speech API: `lang='en-US'`,
 * `interimResults=true`, `maxAlternatives=1`. `continuous=true` so that the
 * session does not close itself at the first pause: the end of the session is
 * decided by the teacher releasing the control (`handle.stop()`), not by the
 * browser.
 *
 * Throws if the browser does not support the Web Speech API; the caller must have
 * checked support beforehand: this module does not decide the fallback.
 */
export function startWebSpeechPtt(
  callbacks: WebSpeechPttCallbacks = {},
): WebSpeechPttHandle {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) {
    throw new Error(
      'Web Speech API is not available in this browser (use Chrome or Edge; Firefox does not implement it).',
    )
  }

  const recognition = new Ctor()
  recognition.lang = 'en-US'
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.continuous = true

  const startedAt = performance.now()
  let firstPartialMs: number | null = null
  let finalText = ''
  let lastError: string | null = null
  let ended = false
  let onEnded: (() => void) | null = null

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (!result) continue
      const text = result[0]?.transcript ?? ''

      if (firstPartialMs === null && text.trim() !== '') {
        firstPartialMs = performance.now() - startedAt
      }
      callbacks.onPartial?.(text)

      if (result.isFinal) {
        finalText = `${finalText} ${text}`.trim()
      }
    }
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    lastError = errorMessage(event.error)
  }

  recognition.onend = () => {
    ended = true
    onEnded?.()
    onEnded = null
  }

  try {
    recognition.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not start the Web Speech API: ${message}`, { cause: err })
  }

  return {
    stop(): Promise<WebSpeechPttResult> {
      return new Promise((resolve) => {
        const releasedAt = performance.now()
        const finish = () => {
          resolve({
            text: finalText,
            sttMs: performance.now() - releasedAt,
            sttFirstPartialMs: firstPartialMs,
            error: lastError,
          })
        }
        if (ended) {
          finish()
          return
        }
        onEnded = finish
        // stop() (not abort()): lets the browser deliver the results already in
        // flight before closing the session; abort() would discard them.
        recognition.stop()
      })
    },
  }
}

// ── startWebSpeechContinuous ─────────────────────────────────────────────────────
//
// Continuous mode: the same UX as the main `MicButton`. One click opens the
// session and leaves it listening; every phrase the browser closes with `isFinal`
// comes out by itself through `onPhrase`. Chrome ends a `continuous=true` session
// on its own after a while (long silence, ~60 s, `no-speech`): unless the
// teacher called `stop()`, this module reopens the session, so "continuous"
// feels continuous even though the browser restarts it in pieces internally.

/** Limit of CONSECUTIVE errors (with no final phrase in between) before giving up. */
const CONTINUOUS_MAX_CONSECUTIVE_ERRORS = 5

/** Base backoff between retries after a real error, in ms (doubles per error, capped). */
const CONTINUOUS_BASE_BACKOFF_MS = 250

/** Backoff cap between retries, in ms. */
const CONTINUOUS_MAX_BACKOFF_MS = 4_000

export interface WebSpeechContinuousCallbacks {
  /**
   * Non-empty final phrase (VERBATIM text, only `trim()`med). `metrics.sttMs` =
   * from the LAST partial result of THIS phrase to the final result (phrase-close
   * latency; 0 if there was no partial before the final). `metrics.sttFirstPartialMs`
   * = from the FIRST non-empty partial of THIS phrase to the final (approximate
   * duration of the spoken phrase; null if there was no partial). The Web Speech
   * API gives no audio timestamps: both metrics derive from when the EVENTS reach
   * the JS thread, not from the audio.
   *
   * `metrics.earlyCut`: true when this chunk was emitted by the duration-cap cut
   * (`maxPhraseMs` exceeded without `isFinal`, on a micro-pause or at the hard
   * ceiling); then `sttMs` is the time from the LAST partial change to the
   * emission, not the real close latency. false otherwise, including the suffix
   * that can arrive after a cut (see `compareCutWithFinal`).
   */
  onPhrase: (
    text: string,
    metrics: { sttMs: number; sttFirstPartialMs: number | null; earlyCut?: boolean },
  ) => void
  /** Partial (interim) transcript of the phrase in progress, to show in the UI while speaking. */
  onPartial?: (text: string) => void
  /** Recoverable session error (listening restarts by itself; informational only). */
  onError?: (message: string) => void
  /**
   * Unrecoverable end: microphone permission denied / no audio device, or the
   * retries ran out after consecutive errors. Listening stays stopped as if
   * `stop()` had been called: the caller must reflect that in the UI (muted) and
   * may offer to retry with a new `startWebSpeechContinuous`.
   */
  onFatal: (message: string) => void
}

export interface WebSpeechContinuousHandle {
  /** Aborts the current session and stops the automatic restarts. It NEVER listens again after this. */
  stop(): void
}

export interface WebSpeechContinuousOptions {
  /**
   * Micro-pause (ms) that triggers the cut once `maxPhraseMs` is exceeded: the
   * partial text in progress stays unchanged (compared normalized) for this long.
   * Default value: `EARLY_CUT_MS` in `defaults.ts`;
   * 0 = use `EARLY_CUT_MS`. It does NOT cut on its own before the cap. The caller reads
   * it and passes it here: this module never touches `import.meta.env`.
   */
  earlyCutMs?: number
  /**
   * Duration cap (ms) of a phrase segment without `isFinal` (see the "Cut by
   * duration cap" block above). Default `MAX_PHRASE_MS`; 0 = no cap (only `isFinal` emits).
   * Never emits chunks of fewer than 3 new words (avoids sending "the", "so um").
   */
  maxPhraseMs?: number
}

/**
 * Opens a continuous Web Speech API session (`lang='en-US'`,
 * `interimResults=true`, `maxAlternatives=1`, `continuous=true`) that restarts
 * itself whenever the browser closes it, until the caller invokes `handle.stop()`.
 *
 * Throws if the browser does not support the Web Speech API; the caller must have
 * checked support beforehand (same contract as `startWebSpeechPtt`).
 */
export function startWebSpeechContinuous(
  callbacks: WebSpeechContinuousCallbacks,
  options: WebSpeechContinuousOptions = {},
): WebSpeechContinuousHandle {
  const earlyCutMs = options.earlyCutMs ?? 0
  const maxPhraseMs = options.maxPhraseMs ?? MAX_PHRASE_MS
  /** Effective micro-pause after the cap: the configured value, or `EARLY_CUT_MS` if it is 0. */
  const microPauseMs = earlyCutMs > 0 ? earlyCutMs : EARLY_CUT_MS
  const ctorOrNull = getSpeechRecognitionCtor()
  if (!ctorOrNull) {
    throw new Error(
      'Web Speech API is not available in this browser (use Chrome or Edge; Firefox does not implement it).',
    )
  }
  // Reassigned to a binding whose type no longer includes `undefined`:
  // `startSession` is a nested function, and TS does not carry the narrowing of
  // `ctorOrNull` into closures declared further down the body.
  const Ctor: SpeechRecognitionConstructor = ctorOrNull

  /** true after stop(): no later onend/onerror may reopen the session. */
  let stoppedByUser = false
  /** Real errors (not counting 'no-speech') since the last recognized final phrase. */
  let consecutiveErrors = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  /** Active SpeechRecognition instance, or null between restarts / after stop(). */
  let current: SpeechRecognition | null = null
  /**
   * Timer of the early cut for the phrase IN PROGRESS (outer scope, not local to
   * `startSession`, so `stop()` can cancel it from outside without exposing the
   * rest of the session's internal state).
   */
  let earlyCutTimer: ReturnType<typeof setTimeout> | null = null

  function cancelEarlyCut(): void {
    if (earlyCutTimer !== null) {
      clearTimeout(earlyCutTimer)
      earlyCutTimer = null
    }
  }

  function stopWithFatal(message: string): void {
    stoppedByUser = true
    current = null
    cancelEarlyCut()
    callbacks.onFatal(message)
  }

  function scheduleRestart(delayMs: number): void {
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!stoppedByUser) startSession()
    }, delayMs)
  }

  function backoffFor(errors: number): number {
    return Math.min(CONTINUOUS_BASE_BACKOFF_MS * 2 ** (errors - 1), CONTINUOUS_MAX_BACKOFF_MS)
  }

  function startSession(): void {
    const recognition = new Ctor()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.continuous = true

    // Marks of the phrase IN PROGRESS inside this session; reset when each phrase
    // closes with a final result (a session may hold several phrases in a row
    // before the browser cuts it).
    let lastPartialAt: number | null = null
    let firstPartialAt: number | null = null
    // Duration-cap cut of the phrase in progress: last partial (verbatim and
    // normalized, to detect real changes rather than every event), start of the
    // current segment (first partial or last cut), and what was already emitted by
    // cuts in this phrase (word count and verbatim text), used to emit only what
    // is new and to compare against the real `isFinal`.
    let lastNormalized = ''
    let lastChangeAt = 0
    let lastPartial = ''
    let segStartAt: number | null = null
    let emittedWords = 0
    let emittedText = ''

    /** Emits the new text of the partial as a phrase (>= 3 words), if there is any. */
    const cut = (): void => {
      earlyCutTimer = null
      const tokens = lastPartial.trim().split(/\s+/).filter((t) => t !== '')
      const newWords = tokens.slice(emittedWords)
      if (newWords.length < 3) return
      const text = newWords.join(' ')
      emittedWords = tokens.length
      emittedText = `${emittedText} ${text}`.trim()
      const clock = performance.now()
      segStartAt = clock // the segment clock restarts at the cut
      callbacks.onPhrase(text, {
        sttMs: clock - lastChangeAt,
        sttFirstPartialMs: firstPartialAt !== null ? clock - firstPartialAt : null,
        earlyCut: true,
      })
    }

    /**
     * (Re)schedules the cut after a partial change. Target = first possible
     * micro-pause past the cap (`start + maxPhraseMs`), with a hard ceiling at
     * `start + maxPhraseMs + 1500`. Without >= 3 new words nothing is scheduled
     * (the next partial change re-evaluates).
     */
    const scheduleCut = (): void => {
      cancelEarlyCut()
      if (maxPhraseMs <= 0 || segStartAt === null) return
      const words = wordsOf(normalizeText(lastPartial))
      if (words.length - emittedWords < 3) return
      const ceiling = segStartAt + maxPhraseMs + CUT_CEILING_EXTRA_MS
      const target = Math.min(ceiling, Math.max(segStartAt + maxPhraseMs, lastChangeAt + microPauseMs))
      earlyCutTimer = setTimeout(cut, Math.max(0, target - performance.now()))
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const text = result[0]?.transcript ?? ''
        const now = performance.now()

        if (!result.isFinal) {
          if (text.trim() !== '') {
            if (firstPartialAt === null) firstPartialAt = now
            if (segStartAt === null) segStartAt = now
            lastPartialAt = now
            callbacks.onPartial?.(text)

            const normalized = normalizeText(text)
            lastPartial = text
            if (normalized !== lastNormalized) {
              lastNormalized = normalized
              lastChangeAt = now
              scheduleCut()
            }
          }
          continue
        }

        // Final result: a complete phrase. A successful recognition resets the
        // retry counter (the limit is on CONSECUTIVE errors, not on the session
        // total).
        consecutiveErrors = 0
        cancelEarlyCut()
        const clean = text.trim()

        if (emittedText !== '') {
          // Part of this phrase was already emitted by a cut: decide whether the
          // final confirms it (do not re-send), extends it (re-send only the new
          // tail) or differs substantially (do not re-send, only log: data to
          // measure the cut's error rate; it is not corrected here).
          const decision = compareCutWithFinal(emittedText, clean)
          if (decision.kind === 'suffix' && decision.text.trim() !== '') {
            callbacks.onPhrase(decision.text.trim(), {
              sttMs: lastPartialAt !== null ? now - lastPartialAt : 0,
              sttFirstPartialMs: null,
              earlyCut: false,
            })
          } else if (decision.kind === 'different') {
            console.log('[webspeech] early cut differs from the final', {
              earlyCut: emittedText,
              final: clean,
            })
          }
        } else if (clean !== '') {
          callbacks.onPhrase(clean, {
            sttMs: lastPartialAt !== null ? now - lastPartialAt : 0,
            sttFirstPartialMs: firstPartialAt !== null ? now - firstPartialAt : null,
            earlyCut: false,
          })
        }
        firstPartialAt = null
        lastPartialAt = null
        lastNormalized = ''
        lastChangeAt = 0
        lastPartial = ''
        segStartAt = null
        emittedWords = 0
        emittedText = ''
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error
      if (code === 'not-allowed' || code === 'audio-capture') {
        // No permission or no microphone: retrying is pointless, so stop right
        // here (do not wait for onend, which arrives anyway but does nothing
        // because stoppedByUser is already true).
        stopWithFatal(errorMessage(code))
        return
      }
      // 'no-speech' is the normal case of long silence (the teacher is not
      // talking): it does not count toward the retry limit and is only reported
      // for visibility (same as in startWebSpeechPtt).
      if (code !== 'no-speech') consecutiveErrors++
      callbacks.onError?.(errorMessage(code))
    }

    recognition.onend = () => {
      current = null
      // Any early cut scheduled for the phrase in progress of THIS session no
      // longer applies: the session ended (normally, by error, or stop()) and a
      // later session starts with no phrase in progress.
      cancelEarlyCut()
      if (stoppedByUser) return

      if (consecutiveErrors >= CONTINUOUS_MAX_CONSECUTIVE_ERRORS) {
        stopWithFatal(
          `Web Speech API: too many consecutive errors (${consecutiveErrors}); continuous listening stopped.`,
        )
        return
      }

      // Backoff only after real errors; a normal close (the browser ending the
      // session after long silence or its internal limit, or after a well
      // recognized phrase) restarts almost immediately.
      scheduleRestart(consecutiveErrors === 0 ? 0 : backoffFor(consecutiveErrors))
    }

    try {
      recognition.start()
      current = recognition
    } catch (err) {
      // start() can throw synchronously (e.g. invalid state after a restart that
      // was too fast). Treated like a browser error: it counts toward the limit
      // and is retried with backoff.
      consecutiveErrors++
      const message = err instanceof Error ? err.message : String(err)
      callbacks.onError?.(`Web Speech API: could not (re)start the session: ${message}`)
      if (consecutiveErrors >= CONTINUOUS_MAX_CONSECUTIVE_ERRORS) {
        stopWithFatal(
          `Web Speech API: too many consecutive errors (${consecutiveErrors}); continuous listening stopped.`,
        )
        return
      }
      scheduleRestart(backoffFor(consecutiveErrors))
    }
  }

  startSession()

  return {
    stop(): void {
      stoppedByUser = true
      if (restartTimer !== null) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      // A real browser fires onend after abort() (which already cancels the early
      // cut), but we do not depend on that: it is cancelled here too, for the
      // simulated case in tests and to avoid a stray timer if onend is late.
      cancelEarlyCut()
      if (current !== null) {
        // abort() (not stop()): discards any result in flight; the teacher asked
        // for real silence, not "finish writing what you have".
        current.abort()
        current = null
      }
    },
  }
}

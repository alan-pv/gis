/**
 * useSpeechInput — voice input through the browser's Web Speech API: the teacher's
 * microphone toggle (continuous mode), the developer push-to-talk button, the sidecar
 * availability check and the visible notice when the sidecar is offline.
 *
 * Final phrases go to the turn queue through `enqueuePhrase`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { checkSidecar } from '@/sidecar/index.js'
import {
  EARLY_CUT_MS,
  MAX_PHRASE_MS,
  startWebSpeechPtt,
  startWebSpeechContinuous,
} from '@/speech/index.js'
import type { WebSpeechPttHandle, WebSpeechContinuousHandle } from '@/speech/index.js'
import type { QueueItem } from '@/speech/queue.js'
import { SIDECAR_OFFLINE_MESSAGE } from '@/demo/demo-mode.js'

type EnqueuePhrase = (
  text: string,
  source: QueueItem['source'],
  datos: {
    audioMs: number | null
    sttMs: number | null
    stt?: 'webspeech' | null
    sttFirstPartialMs?: number | null
    earlyCut?: boolean | null
  },
) => void

export interface UseSpeechInputOptions {
  demo: boolean
  isRunning: boolean
  isInterpreting: boolean
  enqueuePhrase: EnqueuePhrase
  setParseError: (error: string | null) => void
}

export function useSpeechInput({ demo, isRunning, isInterpreting, enqueuePhrase, setParseError }: UseSpeechInputOptions) {
  /** Status of the sidecar (Laya + text model): undefined = checking. */
  const [sidecarOk, setSidecarOk] = useState<boolean | undefined>(undefined)
  /** true while the continuous Web Speech session is open. */
  const [isContinuous, setIsContinuous] = useState(false)
  /** Active Web Speech push-to-talk session; null if no press is active. */
  const webSpeechHandleRef = useRef<WebSpeechPttHandle | null>(null)
  /** true while the Web Speech push-to-talk button is pressed. */
  const [isWebSpeechRecording, setIsWebSpeechRecording] = useState(false)
  /** Latest partial transcript from Web Speech, only for the developer console (never on the board). */
  const [webSpeechPartial, setWebSpeechPartial] = useState('')
  /** Handle of the CONTINUOUS session: null if the main MicButton is muted/off. */
  const webSpeechContinuousRef = useRef<WebSpeechContinuousHandle | null>(null)
  /** Visible (non-dev) message, e.g. when the local sidecar is not running. */
  const [notice, setNotice] = useState<string | null>(null)

  // Check the sidecar (Laya + text model) on startup
  useEffect(() => {
    if (demo) return // static demo: no sidecar calls at all
    void checkSidecar().then(setSidecarOk)
  }, [demo])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  // Stop continuous listening on unmount.
  useEffect(() => {
    return () => {
      if (webSpeechContinuousRef.current !== null) {
        webSpeechContinuousRef.current.stop()
        webSpeechContinuousRef.current = null
      }
    }
  }, [])

  /** On press: opens the Web Speech session (start()). */
  const handleWebSpeechPttDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (isRunning || isInterpreting || webSpeechHandleRef.current !== null) return

    e.currentTarget.setPointerCapture(e.pointerId)
    setWebSpeechPartial('')

    try {
      webSpeechHandleRef.current = startWebSpeechPtt({
        onPartial: (text) => { setWebSpeechPartial(text) },
      })
      setIsWebSpeechRecording(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setParseError(message)
      webSpeechHandleRef.current = null
      setIsWebSpeechRecording(false)
    }
  }, [isRunning, isInterpreting, setParseError])

  /** On release: stops the session (stop()) and enqueues the final phrase. */
  const handleWebSpeechPttUp = useCallback(() => {
    const handle = webSpeechHandleRef.current
    if (handle === null) return
    webSpeechHandleRef.current = null
    setIsWebSpeechRecording(false)

    void (async () => {
      const result = await handle.stop()
      setWebSpeechPartial('')
      // Browser errors (no-speech/network/not-allowed/aborted, already translated by
      // webspeech.ts): visible, but they do not block the class. An empty phrase
      // (e.g. 'no-speech') is dropped by enqueuePhrase like any phrase without voice.
      if (result.error !== null) setParseError(result.error)
      enqueuePhrase(result.text, 'manual', {
        audioMs: null,
        sttMs: result.sttMs,
        sttFirstPartialMs: result.sttFirstPartialMs,
        stt: 'webspeech',
      })
    })()
  }, [enqueuePhrase, setParseError])

  /** Turns continuous mode on/off. */
  const handleToggleContinuous = useCallback(() => {
    const active = webSpeechContinuousRef.current
    if (active !== null) {
      active.stop()
      webSpeechContinuousRef.current = null
      setIsContinuous(false)
      setWebSpeechPartial('')
      return
    }

    setParseError(null)
    setWebSpeechPartial('')
    try {
      webSpeechContinuousRef.current = startWebSpeechContinuous({
        onPhrase: (text, metrics) => {
          // The early cut does not clear the shown partial: the browser keeps
          // recognizing the SAME phrase until its real isFinal (which may or may not
          // be re-sent, see compareCutWithFinal in webspeech.ts); only a normal
          // final (or a suffix after a cut) visually closes the phrase in progress.
          if (metrics.earlyCut !== true) setWebSpeechPartial('')
          enqueuePhrase(text, 'continuous', {
            audioMs: null,
            sttMs: metrics.sttMs,
            sttFirstPartialMs: metrics.sttFirstPartialMs,
            stt: 'webspeech',
            earlyCut: metrics.earlyCut ?? false,
          })
        },
        onPartial: (text) => { setWebSpeechPartial(text) },
        onError: (message) => { setParseError(message) },
        // Unrecoverable end (permission denied / no mic / too many errors in a row):
        // reflect it as "muted" in the UI, like a stop().
        onFatal: (message) => {
          webSpeechContinuousRef.current = null
          setIsContinuous(false)
          setWebSpeechPartial('')
          setParseError(message)
        },
      }, { earlyCutMs: EARLY_CUT_MS, maxPhraseMs: MAX_PHRASE_MS })
      setIsContinuous(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      webSpeechContinuousRef.current = null
      setIsContinuous(false)
      setParseError(`Could not start continuous listening: ${message}`)
    }
  }, [enqueuePhrase, setParseError])

  /** Mic button: turning it ON needs the local sidecar; say so clearly instead of failing silently. */
  const handleMicClick = useCallback(() => {
    if (demo) return
    if (isContinuous || sidecarOk !== false) {
      handleToggleContinuous()
      return
    }
    // The sidecar looked offline: re-check once (it may have been started since).
    void checkSidecar().then(ok => {
      setSidecarOk(ok)
      if (ok) handleToggleContinuous()
      else setNotice(SIDECAR_OFFLINE_MESSAGE)
    })
  }, [demo, isContinuous, sidecarOk, handleToggleContinuous])

  /** Part of the full board reset: stops the continuous session. */
  const reset = useCallback(() => {
    if (webSpeechContinuousRef.current !== null) {
      webSpeechContinuousRef.current.stop()
      webSpeechContinuousRef.current = null
    }
    setIsContinuous(false)
    setWebSpeechPartial('')
  }, [])

  return {
    sidecarOk, isContinuous, isWebSpeechRecording, webSpeechPartial, notice,
    handleWebSpeechPttDown, handleWebSpeechPttUp, handleMicClick, reset,
  }
}

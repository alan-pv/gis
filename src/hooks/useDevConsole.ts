/**
 * useDevConsole — state of the developer console: the visibility toggle, the raw
 * envelope text box (paste / run) and the manual lesson-turn loader.
 */
import { useCallback, useMemo, useState } from 'react'
import { parseEnvelopeText } from '@/validator/parse-envelope-text.js'
import type { ValidationMode } from '@/validator/index.js'
import type { LoadedSeed } from '@/demo/lessons.js'

export interface UseDevConsoleOptions {
  seeds: LoadedSeed[]
  isRunning: boolean
  applyAndAnimate: (envelope: unknown, mode: ValidationMode) => number
  setParseError: (error: string | null) => void
  resetDocument: () => void
  clearSnapshots: () => void
}

export function useDevConsole({
  seeds, isRunning, applyAndAnimate, setParseError, resetDocument, clearSnapshots,
}: UseDevConsoleOptions) {
  // Developer mode: ephemeral state (no localStorage), every session starts in the clean teacher view.
  const [devMode, setDevMode] = useState(false)
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const handleImportJson = useCallback(() => {
    setDevMode(true); setConsoleCollapsed(false)
  }, [])

  // Id of the lesson selected in the picker; default = first lesson.
  const [selectedSeedId, setSelectedSeedId] = useState<string>(() => seeds[0]?.id ?? '')
  // Index of the next turn to load (0-based). When seedStep === turns.length all turns are loaded ("end").
  const [seedStep, setSeedStep] = useState(0)
  // Active register of the shown utterance.
  const [register, setRegister] = useState<'formal' | 'coloquial'>('formal')
  // Tags of the turn currently loaded in the textarea (empty = nothing loaded).
  const [loadedCaseTags, setLoadedCaseTags] = useState<string[]>([])

  // Textarea content and active utterance
  const [envelopeText, setEnvelopeText] = useState('')
  const [activeUtterance, setActiveUtterance] = useState<string | null>(null)

  /** Derived: the currently selected lesson. */
  const selectedSeed = useMemo(
    () => seeds.find(s => s.id === selectedSeedId) ?? seeds[0] ?? null,
    [seeds, selectedSeedId],
  )

  /** Changes the active lesson. Resets seedStep, envelopeText, activeUtterance and tags. */
  const handleSelectSeed = useCallback((id: string) => {
    setSelectedSeedId(id)
    setSeedStep(0)
    setEnvelopeText('')
    setActiveUtterance(null)
    setLoadedCaseTags([])
    setParseError(null)
  }, [setParseError])

  /**
   * Loads the current turn (seedStep) into the textarea and advances the step.
   * At the end it clamps at turns.length ("End"). It does NOT run the animation.
   */
  const handleLoadTurn = useCallback(() => {
    if (!selectedSeed) return
    const { turns } = selectedSeed
    if (turns.length === 0 || seedStep >= turns.length) return
    const turn = turns[seedStep]!
    setEnvelopeText(JSON.stringify(turn.envelope, null, 2))
    setActiveUtterance(register === 'formal' ? turn.utteranceFormal : turn.utteranceColoquial)
    setLoadedCaseTags(turn.caseTags)
    setParseError(null)
    setSeedStep(prev => Math.min(prev + 1, turns.length))
  }, [selectedSeed, seedStep, register, setParseError])

  /** Clears the board (resetDocument) and resets the step, the envelope text and the active utterance. */
  const handleResetBoard = useCallback(() => {
    setSeedStep(0)
    setEnvelopeText('')
    setActiveUtterance(null)
    setLoadedCaseTags([])
    setParseError(null)
    resetDocument()
    clearSnapshots()
  }, [resetDocument, clearSnapshots, setParseError])

  /** "Run": parses the text and applies it through the shared apply → animate path. */
  const handleRun = useCallback(() => {
    if (isRunning) return

    const result = parseEnvelopeText(envelopeText)
    if (!result.ok) {
      setParseError(result.error)
      return
    }

    // The raw box accepts whole envelopes (cap of 200 operations) and there is no live audience to protect.
    applyAndAnimate(result.envelope, 'slide')
  }, [envelopeText, isRunning, applyAndAnimate, setParseError])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEnvelopeText(e.target.value)
    setParseError(null)
  }, [setParseError])

  /** Part of the full board reset (the envelope text is intentionally kept). */
  const resetLoader = useCallback(() => {
    setSeedStep(0)
    setLoadedCaseTags([])
    setActiveUtterance(null)
  }, [])

  /** Shows a turn the live session just applied: its envelope and its utterance. */
  const showTurn = useCallback((text: string, utterance: string) => {
    setEnvelopeText(text)
    setActiveUtterance(utterance)
  }, [])

  return {
    devMode, setDevMode, consoleCollapsed, setConsoleCollapsed, handleImportJson,
    selectedSeedId, selectedSeed, seedStep, register, setRegister, loadedCaseTags, envelopeText, activeUtterance,
    handleSelectSeed, handleLoadTurn, handleResetBoard, handleRun, handleTextChange,
    resetLoader, showTurn,
  }
}

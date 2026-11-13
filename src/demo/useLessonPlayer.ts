/**
 * useLessonPlayer — React glue for the pure state machine in lesson-player.ts.
 *
 * It owns only the timing: when the player is playing and nothing is animating,
 * it waits the scheduled pause and then asks the host (App) to play the next
 * turn. The host applies the envelope through the same path as live use.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { LoadedSeed } from './lessons.js'
import { IDLE_PLAYER, captionFor, nextStep, playerReducer } from './lesson-player.js'

export interface UseLessonPlayerOptions {
  seeds: LoadedSeed[]
  /** True while a turn's animation (or any model call) is in progress. */
  animating: boolean
  /** Applies one turn's envelope through the live path (apply → validate → animate). */
  playTurn: (envelope: unknown) => void
  /** Called when a lesson starts: the host clears the board. */
  onStart: () => void
}

export function useLessonPlayer({ seeds, animating, playTurn, onStart }: UseLessonPlayerOptions) {
  const [state, dispatch] = useReducer(playerReducer, IDLE_PLAYER)
  const seed = useMemo(() => seeds.find(s => s.id === state.seedId) ?? null, [seeds, state.seedId])
  const shownTurn = seed && state.shown >= 0 ? seed.turns[state.shown] : undefined
  const caption = captionFor(shownTurn)

  const playTurnRef = useRef(playTurn)
  useEffect(() => { playTurnRef.current = playTurn }, [playTurn])

  useEffect(() => {
    if (!seed) return
    const step = nextStep(state, animating, caption)
    if (step.kind === 'none') return
    const timer = setTimeout(() => {
      if (step.kind === 'play') {
        const turn = seed.turns[step.index]
        if (turn) playTurnRef.current(turn.envelope)
        dispatch({ type: 'turnShown', index: step.index })
      } else {
        dispatch({ type: 'finish' })
      }
    }, step.delayMs)
    return () => clearTimeout(timer)
  }, [state, animating, caption, seed])

  const start = useCallback((seedId: string) => {
    const s = seeds.find(x => x.id === seedId)
    if (!s || s.turns.length === 0) return
    onStart()
    dispatch({ type: 'start', seedId, total: s.turns.length })
  }, [seeds, onStart])

  const active = state.status !== 'idle'
  const canNext = (state.status === 'playing' || state.status === 'paused') && !animating && state.shown + 1 < state.total

  return {
    state,
    seed,
    caption,
    active,
    canNext,
    start,
    pause: useCallback(() => dispatch({ type: 'pause' }), []),
    resume: useCallback(() => dispatch({ type: 'resume' }), []),
    next: useCallback(() => dispatch({ type: 'skip' }), []),
    stop: useCallback(() => dispatch({ type: 'stop' }), []),
  }
}

/**
 * lesson-player.ts — pure logic of the recorded-lesson player (no React, no DOM).
 *
 * The player replays a seed turn by turn through the SAME application path as
 * live envelopes (App owns that: apply → validate → animate). This module only
 * decides WHAT happens next and WHEN, so it is testable without a canvas:
 *
 *   - `playerReducer`: state machine (idle / playing / paused / finished).
 *   - `captionFor`: the utterance shown as a subtitle (coloquial, else formal).
 *   - `readingDelayMs`: pause after a turn's animation, proportional to the
 *     utterance length (~reading time), clamped to [1.2 s, 4 s].
 *   - `nextStep`: given the state and whether an animation is running, returns
 *     the next scheduled action (wait N ms then play turn k / finish / nothing).
 */

import type { SeedTurn } from './lessons.js'

export const MIN_DELAY_MS = 1200
export const MAX_DELAY_MS = 4000
/** Per-character reading time (~ 22 chars/s). */
export const MS_PER_CHAR = 45
/** Short beat before the first turn, so the fresh board is visible. */
export const START_DELAY_MS = 500

export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'finished'

export interface PlayerState {
  status: PlayerStatus
  seedId: string | null
  /** Number of turns of the seed. */
  total: number
  /** Index of the turn currently shown (-1 = none yet). */
  shown: number
  /** "Next" pressed: the pending reading pause is skipped. */
  skip: boolean
}

export type PlayerAction =
  | { type: 'start'; seedId: string; total: number }
  | { type: 'turnShown'; index: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'finish' }
  | { type: 'stop' }

export const IDLE_PLAYER: PlayerState = { status: 'idle', seedId: null, total: 0, shown: -1, skip: false }

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'start':
      if (action.total <= 0) return IDLE_PLAYER
      return { status: 'playing', seedId: action.seedId, total: action.total, shown: -1, skip: false }
    case 'turnShown':
      if (state.status === 'idle' || state.status === 'finished') return state
      return { ...state, shown: action.index, skip: false }
    case 'pause':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state
    case 'resume':
      return state.status === 'paused' ? { ...state, status: 'playing' } : state
    case 'skip':
      return state.status === 'playing' || state.status === 'paused'
        ? { ...state, status: 'playing', skip: true }
        : state
    case 'finish':
      return state.status === 'playing' ? { ...state, status: 'finished' } : state
    case 'stop':
      return IDLE_PLAYER
  }
}

/** Subtitle of a turn: the colloquial utterance, falling back to the formal one. */
export function captionFor(turn: Pick<SeedTurn, 'utteranceColoquial' | 'utteranceFormal'> | undefined): string {
  if (!turn) return ''
  return turn.utteranceColoquial.trim() !== '' ? turn.utteranceColoquial : turn.utteranceFormal
}

/** Pause after a turn finished animating: proportional to the caption length, clamped to 1.2–4 s. */
export function readingDelayMs(caption: string): number {
  const ms = caption.trim().length * MS_PER_CHAR
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, ms))
}

export type NextStep =
  | { kind: 'none' }
  | { kind: 'play'; index: number; delayMs: number }
  | { kind: 'finish'; delayMs: number }

/**
 * What to schedule next. `animating` = the previous turn's animation is still
 * running (or the model is busy): nothing is scheduled until it ends.
 * `shownCaption` = caption of the turn currently shown (drives the reading pause).
 */
export function nextStep(state: PlayerState, animating: boolean, shownCaption: string): NextStep {
  if (state.status !== 'playing' || animating) return { kind: 'none' }
  const delayMs = state.skip ? 0 : state.shown < 0 ? START_DELAY_MS : readingDelayMs(shownCaption)
  if (state.shown + 1 < state.total) return { kind: 'play', index: state.shown + 1, delayMs }
  return state.shown >= 0 ? { kind: 'finish', delayMs } : { kind: 'none' }
}

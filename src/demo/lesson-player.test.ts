// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  IDLE_PLAYER, MAX_DELAY_MS, MIN_DELAY_MS, START_DELAY_MS,
  captionFor, nextStep, playerReducer, readingDelayMs,
} from './lesson-player.js'
import type { PlayerState } from './lesson-player.js'

const started = (total = 3): PlayerState => playerReducer(IDLE_PLAYER, { type: 'start', seedId: 'x', total })

describe('captionFor', () => {
  it('prefers the colloquial utterance and falls back to the formal one', () => {
    expect(captionFor({ utteranceColoquial: 'hey', utteranceFormal: 'Hello' })).toBe('hey')
    expect(captionFor({ utteranceColoquial: '  ', utteranceFormal: 'Hello' })).toBe('Hello')
    expect(captionFor(undefined)).toBe('')
  })
})

describe('readingDelayMs', () => {
  it('is proportional to length, clamped to 1.2–4 s', () => {
    expect(readingDelayMs('')).toBe(MIN_DELAY_MS)
    expect(readingDelayMs('hi')).toBe(MIN_DELAY_MS)
    expect(readingDelayMs('x'.repeat(50))).toBe(50 * 45)
    expect(readingDelayMs('x'.repeat(500))).toBe(MAX_DELAY_MS)
  })
})

describe('playerReducer', () => {
  it('starts playing; an empty lesson stays idle', () => {
    expect(started().status).toBe('playing')
    expect(playerReducer(IDLE_PLAYER, { type: 'start', seedId: 'x', total: 0 })).toEqual(IDLE_PLAYER)
  })

  it('pause / resume only toggle between playing and paused', () => {
    const paused = playerReducer(started(), { type: 'pause' })
    expect(paused.status).toBe('paused')
    expect(playerReducer(paused, { type: 'resume' }).status).toBe('playing')
    expect(playerReducer(IDLE_PLAYER, { type: 'pause' })).toEqual(IDLE_PLAYER)
  })

  it('turnShown records the turn and clears the skip flag', () => {
    const s = playerReducer(playerReducer(started(), { type: 'skip' }), { type: 'turnShown', index: 0 })
    expect(s.shown).toBe(0)
    expect(s.skip).toBe(false)
  })

  it('finish only applies while playing; stop always returns to idle', () => {
    expect(playerReducer(started(), { type: 'finish' }).status).toBe('finished')
    expect(playerReducer(playerReducer(started(), { type: 'pause' }), { type: 'finish' }).status).toBe('paused')
    expect(playerReducer(started(), { type: 'stop' })).toEqual(IDLE_PLAYER)
  })
})

describe('nextStep (auto-advance)', () => {
  it('schedules turn 0 after a short beat', () => {
    expect(nextStep(started(), false, '')).toEqual({ kind: 'play', index: 0, delayMs: START_DELAY_MS })
  })

  it('waits while a turn animates', () => {
    expect(nextStep({ ...started(), shown: 0 }, true, 'abc')).toEqual({ kind: 'none' })
  })

  it('after an animation: reading pause proportional to the caption, then the next turn', () => {
    const s = { ...started(), shown: 0 }
    expect(nextStep(s, false, 'x'.repeat(60))).toEqual({ kind: 'play', index: 1, delayMs: 60 * 45 })
    // A turn with no operations still gets a caption pause (min 1.2 s).
    expect(nextStep(s, false, 'ok')).toEqual({ kind: 'play', index: 1, delayMs: MIN_DELAY_MS })
  })

  it('does nothing while paused, idle or finished', () => {
    const s = { ...started(), shown: 0 }
    expect(nextStep(playerReducer(s, { type: 'pause' }), false, 'a')).toEqual({ kind: 'none' })
    expect(nextStep(IDLE_PLAYER, false, 'a')).toEqual({ kind: 'none' })
    expect(nextStep(playerReducer(s, { type: 'finish' }), false, 'a')).toEqual({ kind: 'none' })
  })

  it('"Next" (skip) removes the pause', () => {
    const s = playerReducer({ ...started(), shown: 0 }, { type: 'skip' })
    expect(nextStep(s, false, 'x'.repeat(100))).toEqual({ kind: 'play', index: 1, delayMs: 0 })
  })

  it('after the last turn it finishes (after its reading pause)', () => {
    const s = { ...started(3), shown: 2 }
    expect(nextStep(s, false, 'x'.repeat(40))).toEqual({ kind: 'finish', delayMs: 40 * 45 })
  })
})

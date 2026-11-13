/**
 * Tests for path-length.ts: approximate length of SVG paths.
 */
import { describe, it, expect } from 'vitest'
import { approxPathLength } from './path-length.js'

describe('approxPathLength', () => {

  it('exact horizontal straight line', () => {
    // M 0 0 L 100 0 → length = 100
    expect(approxPathLength('M 0 0 L 100 0')).toBeCloseTo(100, 1)
  })

  it('exact vertical straight line', () => {
    expect(approxPathLength('M 0 0 L 0 50')).toBeCloseTo(50, 1)
  })

  it('exact diagonal line', () => {
    // sqrt(3^2 + 4^2) = 5
    expect(approxPathLength('M 0 0 L 3 4')).toBeCloseTo(5, 1)
  })

  it('ClosePath Z returns to the start', () => {
    // Triangle 0,0 → 4,0 → 0,3 → Z (back to 0,0)
    // L1 = 4, L2 = 5 (3-4-5), Z = 3
    const d = 'M 0 0 L 4 0 L 4 3 Z'
    const len = approxPathLength(d)
    expect(len).toBeGreaterThan(10)  // 4 + 3 + 5 = 12
    expect(len).toBeCloseTo(12, 0)
  })

  it('cubic curve C exceeds the chord', () => {
    // M 0 0 C 0 50 100 50 100 0 — a gentle S curve
    const d = 'M 0 0 C 0 50 100 50 100 0'
    const chord = 100  // straight-line distance P0→P3
    const len = approxPathLength(d)
    expect(len).toBeGreaterThan(chord)
  })

  it('quadratic curve Q exceeds the chord', () => {
    const d = 'M 0 0 Q 50 100 100 0'
    const chord = 100
    const len = approxPathLength(d)
    expect(len).toBeGreaterThan(chord)
  })

  it('relative command l', () => {
    // Equivalent to M 0 0 L 3 4
    expect(approxPathLength('M 0 0 l 3 4')).toBeCloseTo(5, 1)
  })

  it('absolute horizontal command H', () => {
    expect(approxPathLength('M 10 0 H 60')).toBeCloseTo(50, 1)
  })

  it('absolute vertical command V', () => {
    expect(approxPathLength('M 0 5 V 35')).toBeCloseTo(30, 1)
  })

  it('empty path returns 0', () => {
    expect(approxPathLength('')).toBe(0)
  })

  it('M alone without L returns 0', () => {
    expect(approxPathLength('M 10 20')).toBe(0)
  })

  it('complex sun rayo_1 path (vertical line)', () => {
    // "M 60 5 L 60 22" → length = 17
    expect(approxPathLength('M 60 5 L 60 22')).toBeCloseTo(17, 1)
  })

  it('clamped duration: very short path → ≥ STROKE_MIN_MS', () => {
    // 1px path → (1/450)*1000 ~ 2ms → should clamp to 200ms
    // This test checks path-length, not the clamp; only ensure it is not negative
    const len = approxPathLength('M 0 0 L 1 0')
    expect(len).toBeGreaterThan(0)
  })

  it('path with several L segments accumulates lengths', () => {
    // M 0 0 L 3 4 L 6 8 → each segment = 5, total = 10
    expect(approxPathLength('M 0 0 L 3 4 L 6 8')).toBeCloseTo(10, 0)
  })

})

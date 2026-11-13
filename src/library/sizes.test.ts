/**
 * Tests for src/library/sizes.ts.
 *
 * Covers:
 * - normalizedFigureSize: fitting figures into the standard box
 *   (STANDARD_FIGURE_BOX = 120), preserving the natural proportion (never distorts).
 */
import { describe, it, expect } from 'vitest'
import { STANDARD_FIGURE_BOX, normalizedFigureSize } from './sizes.js'
import type { ObjectMeta } from './meta.js'

/** Helper: builds a minimal ObjectMeta (SVG variant) with the requested default_size. */
function makeMeta(width: number, height: number): ObjectMeta {
  return {
    name: 'figura_test',
    format_version: 1,
    default_size: { width, height },
    anchors: {
      top: { x: width / 2, y: 0 },
      bottom: { x: width / 2, y: height },
      left: { x: 0, y: height / 2 },
      right: { x: width, y: height / 2 },
    },
    stroke_order: ['cuerpo'],
  }
}

describe('normalizedFigureSize — standard figure box', () => {
  it('STANDARD_FIGURE_BOX is 120', () => {
    expect(STANDARD_FIGURE_BOX).toBe(120)
  })

  it('mar 240×80 → 120×40 (width is the longer side)', () => {
    expect(normalizedFigureSize(makeMeta(240, 80))).toEqual({ width: 120, height: 40 })
  })

  it('persona 80×160 → 60×120 (height is the longer side)', () => {
    expect(normalizedFigureSize(makeMeta(80, 160))).toEqual({ width: 60, height: 120 })
  })

  it('circle 100×100 → 120×120 (square, both sides scale equally)', () => {
    expect(normalizedFigureSize(makeMeta(100, 100))).toEqual({ width: 120, height: 120 })
  })

  it('a very wide figure 120×12 → 120×12 (the longer side already measures exactly 120)', () => {
    expect(normalizedFigureSize(makeMeta(120, 12))).toEqual({ width: 120, height: 12 })
  })

  it('the longer side of the output is always exactly STANDARD_FIGURE_BOX', () => {
    const casos: Array<[number, number]> = [[240, 80], [80, 160], [100, 100], [140, 180], [220, 140]]
    for (const [w, h] of casos) {
      const { width, height } = normalizedFigureSize(makeMeta(w, h))
      expect(Math.max(width, height)).toBe(STANDARD_FIGURE_BOX)
    }
  })

  it('preserves the proportion (never distorts): width/height holds within rounding', () => {
    const w = 220
    const h = 140
    const { width, height } = normalizedFigureSize(makeMeta(w, h))
    expect(width / height).toBeCloseTo(w / h, 1)
  })
})

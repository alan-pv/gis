import { describe, it, expect } from 'vitest'
import { IDENTITY_VIEWPORT, FIT_MARGIN, fitViewport } from './viewport.js'

const CANVAS = { width: 1440, height: 810 }

describe('fitViewport', () => {
  it('window wider than the board: height governs and there is spare room at the sides, centered', () => {
    const area = { width: 2000, height: 600 }
    const vp = fitViewport(area, CANVAS)
    expect(vp.scale).toBeCloseTo((600 - 2 * FIT_MARGIN) / 810, 9)
    expect(vp.y).toBeCloseTo(FIT_MARGIN, 9)
    expect(vp.x).toBeCloseTo((2000 - 1440 * vp.scale) / 2, 9)
    expect(vp.x).toBeGreaterThan(FIT_MARGIN)
  })

  it('taller window: width governs and there is spare room above and below', () => {
    const vp = fitViewport({ width: 800, height: 1200 }, CANVAS)
    expect(vp.scale).toBeCloseTo((800 - 2 * FIT_MARGIN) / 1440, 9)
    expect(vp.x).toBeCloseTo(FIT_MARGIN, 9)
    expect(vp.y).toBeCloseTo((1200 - 810 * vp.scale) / 2, 9)
  })

  it('symmetric margins, never below the minimum', () => {
    for (const area of [{ width: 1000, height: 700 }, { width: 3000, height: 500 }, { width: 500, height: 3000 }]) {
      const vp = fitViewport(area, CANVAS)
      const right = area.width - (vp.x + 1440 * vp.scale)
      const bottom = area.height - (vp.y + 810 * vp.scale)
      expect(right).toBeCloseTo(vp.x, 9)
      expect(bottom).toBeCloseTo(vp.y, 9)
      expect(vp.x).toBeGreaterThanOrEqual(FIT_MARGIN - 1e-9)
      expect(vp.y).toBeGreaterThanOrEqual(FIT_MARGIN - 1e-9)
    }
  })

  it('keeps the canvas aspect ratio (a single scale)', () => {
    const vp = fitViewport({ width: 1234, height: 777 }, CANVAS)
    expect(vp.scale).toBeGreaterThan(0)
    expect(1440 * vp.scale).toBeLessThanOrEqual(1234 - 2 * FIT_MARGIN + 1e-9)
    expect(810 * vp.scale).toBeLessThanOrEqual(777 - 2 * FIT_MARGIN + 1e-9)
  })

  it('degenerate area: identity', () => {
    expect(fitViewport({ width: 0, height: 0 }, CANVAS)).toEqual(IDENTITY_VIEWPORT)
  })

  it('area smaller than the margins: positive scale', () => {
    expect(fitViewport({ width: 10, height: 10 }, CANVAS).scale).toBeGreaterThan(0)
  })
})


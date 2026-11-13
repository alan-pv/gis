/**
 * Tests for bbox.ts: types and geometry helpers.
 */
import { describe, it, expect } from 'vitest'
import { clampToCanvas } from './bbox.js'
import type { BBox } from './bbox.js'

describe('clampToCanvas', () => {
  const canvas = { width: 1200, height: 900 }

  it('leaves a box well inside the canvas unchanged', () => {
    const box: BBox = { x: 100, y: 100, width: 200, height: 100 }
    expect(clampToCanvas(box, canvas)).toEqual(box)
  })

  it('clamps negative x to 0', () => {
    const box: BBox = { x: -50, y: 100, width: 200, height: 100 }
    const result = clampToCanvas(box, canvas)
    expect(result.x).toBe(0)
    expect(result.y).toBe(100)
  })

  it('clamps negative y to 0', () => {
    const box: BBox = { x: 100, y: -30, width: 200, height: 100 }
    const result = clampToCanvas(box, canvas)
    expect(result.y).toBe(0)
  })

  it('clamps when the right edge overflows', () => {
    const box: BBox = { x: 1100, y: 100, width: 200, height: 100 }
    const result = clampToCanvas(box, canvas)
    expect(result.x + result.width).toBeLessThanOrEqual(canvas.width)
  })

  it('clamps when the bottom edge overflows', () => {
    const box: BBox = { x: 100, y: 850, width: 200, height: 100 }
    const result = clampToCanvas(box, canvas)
    expect(result.y + result.height).toBeLessThanOrEqual(canvas.height)
  })

  it('a box larger than the canvas ends up at (0,0)', () => {
    const box: BBox = { x: 500, y: 500, width: 2000, height: 2000 }
    const result = clampToCanvas(box, canvas)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })
})

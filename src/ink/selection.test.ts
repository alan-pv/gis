/**
 * Tests for the marquee selection module.
 */
import { describe, it, expect } from 'vitest'
import { strokesInRect } from './selection.js'
import type { InkStroke, SelectionRect } from './index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a stroke with id and flattened points (x0,y0,x1,y1,...). */
function stroke(id: string, ...points: number[]): InkStroke {
  return { id, points }
}

/** Normalized rect (no negative dimensions). */
function rect(x: number, y: number, w: number, h: number): SelectionRect {
  return { x, y, width: w, height: h }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('strokesInRect', () => {
  it('selects a stroke completely contained in the rect', () => {
    const strokes = [stroke('ink_1', 10, 10, 30, 30)]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual(['ink_1'])
  })

  it('does not select a stroke partly outside the rect', () => {
    // The stroke goes from (10,10) to (110,30): its bbox.maxX=110 > rect.maxX=100
    const strokes = [stroke('ink_1', 10, 10, 110, 30)]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual([])
  })

  it('does not select a stroke completely outside the rect', () => {
    const strokes = [stroke('ink_1', 200, 200, 250, 250)]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual([])
  })

  it('selects only the completely contained strokes', () => {
    const strokes = [
      stroke('ink_1', 10, 10, 30, 30),   // dentro
      stroke('ink_2', 10, 10, 110, 30),  // parcialmente fuera
      stroke('ink_3', 50, 50, 80, 80),   // dentro
    ]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual(['ink_1', 'ink_3'])
  })

  it('normalizes a rect with negative width (drag to the left)', () => {
    // The user dragged from (100,0) to (0,100): width=-100, height=100
    const strokes = [stroke('ink_1', 10, 10, 30, 30)]
    const r: SelectionRect = { x: 100, y: 0, width: -100, height: 100 }
    // Normalized: x=0, y=0, width=100, height=100
    expect(strokesInRect(strokes, r)).toEqual(['ink_1'])
  })

  it('normalizes a rect with negative height (drag upwards)', () => {
    const strokes = [stroke('ink_1', 10, 10, 30, 30)]
    const r: SelectionRect = { x: 0, y: 100, width: 100, height: -100 }
    // Normalized: x=0, y=0, width=100, height=100
    expect(strokesInRect(strokes, r)).toEqual(['ink_1'])
  })

  it('normalizes a rect with negative width and height (fully reversed drag)', () => {
    const strokes = [stroke('ink_1', 10, 10, 30, 30)]
    const r: SelectionRect = { x: 100, y: 100, width: -100, height: -100 }
    // Normalized: x=0, y=0, width=100, height=100
    expect(strokesInRect(strokes, r)).toEqual(['ink_1'])
  })

  it('returns [] for a page without strokes', () => {
    expect(strokesInRect([], rect(0, 0, 1000, 1000))).toEqual([])
  })

  it('does not select strokes with fewer than 4 values (null bbox)', () => {
    const strokes = [stroke('ink_1', 10, 20)]  // only 2 values = 1 point
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual([])
  })

  it('selects a stroke whose extremes are exactly on the rect edge', () => {
    // stroke bbox: minX=0, minY=0, maxX=100, maxY=100
    const strokes = [stroke('ink_1', 0, 0, 100, 100)]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual(['ink_1'])
  })

  it('does not select a stroke whose bbox exceeds the rect edge by 1px', () => {
    const strokes = [stroke('ink_1', 0, 0, 101, 100)]
    const r = rect(0, 0, 100, 100)
    expect(strokesInRect(strokes, r)).toEqual([])
  })
})

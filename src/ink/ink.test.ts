/**
 * Tests for the freehand ink module.
 *
 * Pure logic only: no Konva, React or DOM.
 * Covers all the functions of src/ink/model.ts.
 */
import { describe, it, expect } from 'vitest'
import { emptyInk, addStroke, removeStroke, translateStroke, strokeAtBoxPoint } from './model.js'

// ── emptyInk ──────────────────────────────────────────────────────────────────

describe('emptyInk', () => {
  it('returns a layer with empty strokes', () => {
    const layer = emptyInk()
    expect(layer.strokes).toHaveLength(0)
  })

  it('returns nextStrokeId=1', () => {
    const layer = emptyInk()
    expect(layer.nextStrokeId).toBe(1)
  })
})

// ── addStroke ─────────────────────────────────────────────────────────────────

describe('addStroke', () => {
  it('generates ids ink_1, ink_2 in order', () => {
    const layer0 = emptyInk()
    const layer1 = addStroke(layer0, [0, 0, 10, 10])
    const layer2 = addStroke(layer1, [5, 5, 15, 15])
    expect(layer1.strokes[0]!.id).toBe('ink_1')
    expect(layer2.strokes[1]!.id).toBe('ink_2')
  })

  it('increments nextStrokeId with each stroke', () => {
    const layer = addStroke(addStroke(emptyInk(), [0, 0, 1, 1]), [2, 2, 3, 3])
    expect(layer.nextStrokeId).toBe(3)
  })

  it('with fewer than 2 points (length < 4) returns the same layer unchanged', () => {
    const layer = emptyInk()
    const result = addStroke(layer, [0, 0])
    expect(result).toBe(layer)
  })

  it('with an empty array returns the same layer unchanged', () => {
    const layer = emptyInk()
    const result = addStroke(layer, [])
    expect(result).toBe(layer)
  })

  it('stores the exact points of the stroke', () => {
    const pts = [10, 20, 30, 40, 50, 60]
    const layer = addStroke(emptyInk(), pts)
    expect(layer.strokes[0]!.points).toEqual(pts)
  })
})

// ── removeStroke ──────────────────────────────────────────────────────────────
describe('removeStroke', () => {
  it('removes the stroke with the given id', () => {
    const layer = addStroke(addStroke(emptyInk(), [0, 0, 1, 1]), [2, 2, 3, 3])
    const result = removeStroke(layer, 'ink_1')
    expect(result.strokes).toHaveLength(1)
    expect(result.strokes[0]!.id).toBe('ink_2')
  })

  it('with a nonexistent id returns the same object unchanged', () => {
    const layer = addStroke(emptyInk(), [0, 0, 1, 1])
    const result = removeStroke(layer, 'ink_99')
    expect(result).toBe(layer)
  })
})

// ── addStroke with color ──────────────────────────────────────────────────────

describe('addStroke — color', () => {
  it('with a color stores the color on the new stroke', () => {
    const layer = addStroke(emptyInk(), [0, 0, 10, 10], 'rojo')
    expect(layer.strokes[0]!.color).toBe('rojo')
  })

  it('without a color leaves color undefined (does not pollute colorless strokes)', () => {
    const layer = addStroke(emptyInk(), [0, 0, 10, 10])
    expect(layer.strokes[0]!.color).toBeUndefined()
    // The field must not exist on the object
    expect('color' in layer.strokes[0]!).toBe(false)
  })

  it('a stroke keeps its color after addStroke of another stroke', () => {
    const layer0 = addStroke(emptyInk(), [0, 0, 10, 10], 'azul')
    const layer1 = addStroke(layer0, [20, 20, 30, 30], 'verde')
    // The first stroke does not lose its color
    expect(layer1.strokes[0]!.color).toBe('azul')
    expect(layer1.strokes[1]!.color).toBe('verde')
  })

})

// ── strokeAtBoxPoint ──────────────────────────────────────────────────────────

describe('strokeAtBoxPoint', () => {
  it('does not detect a point outside the box and beyond the pad', () => {
    // Stroke from (0,0) to (100,100): bbox [0..100] x [0..100].
    // The point (120,50) is 20px to the right of the box; pad=10 → still outside.
    const layer = addStroke(emptyInk(), [0, 0, 100, 100])
    const hit = strokeAtBoxPoint(layer, 120, 50, 10)
    expect(hit).toBeUndefined()
  })

  it('the pad expands the box: a point just outside the bbox but within the margin is detected', () => {
    // Stroke from (10,10) to (50,50): bbox [10..50] x [10..50].
    // The point (55,30) is 5px right of the edge; pad=10 → inside the expanded box.
    const layer = addStroke(emptyInk(), [10, 10, 50, 50])
    const hit = strokeAtBoxPoint(layer, 55, 30, 10)
    expect(hit).toBeDefined()
    // Without pad it would not reach
    const hitNoPad = strokeAtBoxPoint(layer, 55, 30, 0)
    expect(hitNoPad).toBeUndefined()
  })

  it('on an empty layer returns undefined', () => {
    const hit = strokeAtBoxPoint(emptyInk(), 50, 50, 20)
    expect(hit).toBeUndefined()
  })

  it('with two strokes whose boxes overlap at the point, returns the LAST one (the one on top)', () => {
    // ink_1: diagonal (0,0)-(100,100); ink_2: (10,10)-(90,90). Their boxes overlap.
    // The point (50,50) falls in both boxes: ink_2 (the most recent) must win.
    const layer0 = addStroke(emptyInk(), [0, 0, 100, 100])   // ink_1
    const layer1 = addStroke(layer0,     [10, 10, 90, 90])    // ink_2
    const hit = strokeAtBoxPoint(layer1, 50, 50, 0)
    expect(hit).toBeDefined()
    expect(hit!.id).toBe('ink_2')
  })
})

// ── translateStroke ───────────────────────────────────────────────────────────

describe('translateStroke', () => {
  it('translates all points of the stroke by (dx, dy)', () => {
    // Stroke from (10,20) to (30,40)
    const layer = addStroke(emptyInk(), [10, 20, 30, 40])
    const result = translateStroke(layer, 'ink_1', 5, -10)
    expect(result.strokes[0]!.points).toEqual([15, 10, 35, 30])
  })

  it('nonexistent id → returns the same object unchanged', () => {
    const layer = addStroke(emptyInk(), [0, 0, 10, 10])
    const result = translateStroke(layer, 'ink_99', 5, 5)
    expect(result).toBe(layer)
  })

  it('only translates the indicated stroke; the others do not change', () => {
    const layer0 = addStroke(emptyInk(), [0, 0, 10, 10])  // ink_1
    const layer1 = addStroke(layer0, [100, 100, 200, 200]) // ink_2
    const result = translateStroke(layer1, 'ink_1', 5, 5)

    // ink_1 translated
    expect(result.strokes[0]!.points).toEqual([5, 5, 15, 15])
    // ink_2 unchanged
    expect(result.strokes[1]!.points).toEqual([100, 100, 200, 200])
  })

  it('nextStrokeId does not change when translating', () => {
    const layer = addStroke(emptyInk(), [0, 0, 10, 10])
    const result = translateStroke(layer, 'ink_1', 1, 1)
    expect(result.nextStrokeId).toBe(layer.nextStrokeId)
  })

  it('translating by (0,0) returns equal points', () => {
    const pts = [5, 10, 15, 20]
    const layer = addStroke(emptyInk(), pts)
    const result = translateStroke(layer, 'ink_1', 0, 0)
    expect(result.strokes[0]!.points).toEqual(pts)
  })
})

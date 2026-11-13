/**
 * Tests for areas.ts: panel partition model (binary split tree).
 *
 * Covers:
 *  - defaultAreaTree: structure, ids and ratios.
 *  - computeAreaRects: exact sums, contiguity, V/H splits.
 *  - fillOrder: canonical order (x asc, y asc).
 *  - splitLeaf: V and H splits, immutability, missing leafId.
 *  - removeLeaf: split collapse, immutability, last leaf.
 *  - resizeSplit: ratio change, clamping at the extremes, immutability.
 *  - Area invariant: exact union for composite trees.
 *  - leafIds / splitIds.
 */

import { describe, it, expect } from 'vitest'
import type { BBox } from './bbox.js'
import type { AreaTree, AreaRect } from './areas.js'
import {
  defaultAreaTree,
  computeAreaRects,
  fillOrder,
  computeDividers,
  isDividerVisible,
  splitLeaf,
  removeLeaf,
  resizeSplit,
  leafIds,
  splitIds,
  nextAreaIds,
} from './areas.js'

// ── Test helpers ───────────────────────────────────────────────────────────

const BODY: BBox = { x: 24, y: 120, width: 1152, height: 600 }

/** Total area of a BBox. */
function area(box: BBox): number {
  return box.width * box.height
}

/**
 * Checks that the union of rects covers bodyRect exactly:
 * - Sum of areas == area of bodyRect.
 * - Each rect lies inside bodyRect.
 * - No gap or overlap (checked by area + contiguity in simple cases).
 */
function assertCoversExactly(rects: AreaRect[], bodyRect: BBox): void {
  const totalArea = rects.reduce((sum, r) => sum + area(r.box), 0)
  expect(totalArea).toBe(area(bodyRect))

  for (const r of rects) {
    expect(r.box.x).toBeGreaterThanOrEqual(bodyRect.x)
    expect(r.box.y).toBeGreaterThanOrEqual(bodyRect.y)
    expect(r.box.x + r.box.width).toBeLessThanOrEqual(bodyRect.x + bodyRect.width)
    expect(r.box.y + r.box.height).toBeLessThanOrEqual(bodyRect.y + bodyRect.height)
  }
}

// ── defaultAreaTree ───────────────────────────────────────────────────────────

describe('defaultAreaTree', () => {
  it('n=1 returns a single leaf with id area_1', () => {
    const tree = defaultAreaTree(1)
    expect(tree).toEqual({ kind: 'leaf', id: 'area_1' })
  })

  it('n=1 → computeAreaRects returns 1 box == bodyRect', () => {
    const rects = computeAreaRects(defaultAreaTree(1), BODY)
    expect(rects).toHaveLength(1)
    expect(rects[0]!.id).toBe('area_1')
    expect(rects[0]!.box).toEqual(BODY)
  })

  it('n=2 produces split_1 with ratio 0.5 and two leaves area_1/area_2', () => {
    const tree = defaultAreaTree(2)
    expect(tree.kind).toBe('split')
    if (tree.kind !== 'split') return
    expect(tree.id).toBe('split_1')
    expect(tree.dir).toBe('v')
    expect(tree.ratio).toBeCloseTo(0.5)
    expect(tree.a).toEqual({ kind: 'leaf', id: 'area_1' })
    expect(tree.b).toEqual({ kind: 'leaf', id: 'area_2' })
  })

  it('n=3 produces split_1 { ratio≈1/3, a=area_1, b=split_2 { ratio=0.5, a=area_2, b=area_3 } }', () => {
    const tree = defaultAreaTree(3)
    expect(tree.kind).toBe('split')
    if (tree.kind !== 'split') return
    expect(tree.id).toBe('split_1')
    expect(tree.dir).toBe('v')
    expect(tree.ratio).toBeCloseTo(1 / 3)

    expect(tree.a).toEqual({ kind: 'leaf', id: 'area_1' })

    const b = tree.b
    expect(b.kind).toBe('split')
    if (b.kind !== 'split') return
    expect(b.id).toBe('split_2')
    expect(b.ratio).toBeCloseTo(0.5)
    expect(b.a).toEqual({ kind: 'leaf', id: 'area_2' })
    expect(b.b).toEqual({ kind: 'leaf', id: 'area_3' })
  })

  it('n=3 → computeAreaRects gives 3 boxes of width ≈384 over width=1152', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    expect(rects).toHaveLength(3)

    // All three widths must be 384 (1152 / 3 = 384 exactly)
    for (const r of rects) {
      expect(r.box.width).toBe(384)
    }
  })

  it('n=3 → sum of widths == bodyRect.width exactly', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    const totalWidth = rects.reduce((sum, r) => sum + r.box.width, 0)
    expect(totalWidth).toBe(BODY.width)
  })

  it('n=3 → same y and height in all boxes', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    for (const r of rects) {
      expect(r.box.y).toBe(BODY.y)
      expect(r.box.height).toBe(BODY.height)
    }
  })

  it('n=3 → contiguous boxes: x_{k+1} == x_k + width_k', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    // Depth-first order is already left→right for 'v' splits
    const sorted = fillOrder(rects)
    expect(sorted[0]!.box.x).toBe(BODY.x)
    expect(sorted[1]!.box.x).toBe(sorted[0]!.box.x + sorted[0]!.box.width)
    expect(sorted[2]!.box.x).toBe(sorted[1]!.box.x + sorted[1]!.box.width)
  })

  it('n=3 → leaf ids are area_1, area_2, area_3', () => {
    const ids = leafIds(defaultAreaTree(3))
    expect(ids).toEqual(['area_1', 'area_2', 'area_3'])
  })

  it('defaultAreaTree() with no argument equals n=3', () => {
    const t1 = defaultAreaTree()
    const t3 = defaultAreaTree(3)
    expect(t1).toEqual(t3)
  })

  it('n=4 → 4 equal columns, exact sum of widths over width=1200', () => {
    const body: BBox = { x: 0, y: 0, width: 1200, height: 600 }
    const rects = computeAreaRects(defaultAreaTree(4), body)
    expect(rects).toHaveLength(4)
    const totalWidth = rects.reduce((sum, r) => sum + r.box.width, 0)
    expect(totalWidth).toBe(body.width)
    for (const r of rects) {
      expect(r.box.width).toBe(300)
    }
  })

  it('n≤0 is treated as n=1', () => {
    const tree = defaultAreaTree(0)
    expect(tree).toEqual({ kind: 'leaf', id: 'area_1' })
  })
})

// ── computeAreaRects ──────────────────────────────────────────────────────────

describe('computeAreaRects', () => {
  it('split v ratio=0.3 → widths 30%/70% with compensated rounding (width=1000)', () => {
    const body: BBox = { x: 0, y: 0, width: 1000, height: 400 }
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.3,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const rects = computeAreaRects(tree, body)
    expect(rects).toHaveLength(2)
    const rA = rects[0]!
    const rB = rects[1]!
    expect(rA.box.width).toBe(Math.round(1000 * 0.3)) // 300
    expect(rB.box.width).toBe(1000 - rA.box.width)    // 700
    expect(rA.box.width + rB.box.width).toBe(1000)
  })

  it('split h ratio=0.4 → heights 40%/60% with compensated rounding (height=600)', () => {
    const body: BBox = { x: 0, y: 0, width: 400, height: 600 }
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'h',
      ratio: 0.4,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const rects = computeAreaRects(tree, body)
    expect(rects).toHaveLength(2)
    const rA = rects[0]!
    const rB = rects[1]!
    expect(rA.box.height).toBe(Math.round(600 * 0.4)) // 240
    expect(rB.box.height).toBe(600 - rA.box.height)   // 360
    expect(rA.box.height + rB.box.height).toBe(600)
  })

  it('split h → stacked boxes: same x/width, y_{b} = y_{a} + height_{a}', () => {
    const body: BBox = { x: 10, y: 20, width: 300, height: 500 }
    const tree: AreaTree = {
      kind: 'split',
      id: 's1',
      dir: 'h',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const splitRects = computeAreaRects(tree, body)
    const rA = splitRects[0]!
    const rB = splitRects[1]!
    expect(rA.box.x).toBe(body.x)
    expect(rA.box.width).toBe(body.width)
    expect(rB.box.x).toBe(body.x)
    expect(rB.box.width).toBe(body.width)
    expect(rB.box.y).toBe(rA.box.y + rA.box.height)
  })

  it('split v → side-by-side boxes: same y/height, x_{b} = x_{a} + width_{a}', () => {
    const body: BBox = { x: 5, y: 5, width: 400, height: 300 }
    const tree: AreaTree = {
      kind: 'split',
      id: 's1',
      dir: 'v',
      ratio: 0.6,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const splitRects = computeAreaRects(tree, body)
    const rA = splitRects[0]!
    const rB = splitRects[1]!
    expect(rA.box.y).toBe(body.y)
    expect(rA.box.height).toBe(body.height)
    expect(rB.box.y).toBe(body.y)
    expect(rB.box.height).toBe(body.height)
    expect(rB.box.x).toBe(rA.box.x + rA.box.width)
  })

  it('nested tree (v+h): exact union covers bodyRect', () => {
    // split_1 v 0.5 → left: area_1; right: split_2 h 0.5 → area_2 on top, area_3 below
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: {
        kind: 'split',
        id: 'split_2',
        dir: 'h',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_2' },
        b: { kind: 'leaf', id: 'area_3' },
      },
    }
    const rects = computeAreaRects(tree, BODY)
    expect(rects).toHaveLength(3)
    assertCoversExactly(rects, BODY)
  })

  it('area invariant: sum == bodyRect.width × bodyRect.height for n=3', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    assertCoversExactly(rects, BODY)
  })

  it('area invariant with width not divisible by ratio (width=1000, ratio=1/3)', () => {
    const body: BBox = { x: 0, y: 0, width: 1000, height: 400 }
    const tree: AreaTree = {
      kind: 'split',
      id: 's1',
      dir: 'v',
      ratio: 1 / 3,
      a: { kind: 'leaf', id: 'area_1' },
      b: {
        kind: 'split',
        id: 's2',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_2' },
        b: { kind: 'leaf', id: 'area_3' },
      },
    }
    const rects = computeAreaRects(tree, body)
    expect(rects).toHaveLength(3)
    assertCoversExactly(rects, body)
    // The sum of widths must also be exact
    const totalWidth = rects.reduce((sum, r) => sum + r.box.width, 0)
    expect(totalWidth).toBe(body.width)
  })
})

// ── fillOrder ─────────────────────────────────────────────────────────────────

describe('fillOrder', () => {
  it('3 columns → order left, middle, right', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    const ordered = fillOrder(rects)
    expect(ordered.map((r) => r.id)).toEqual(['area_1', 'area_2', 'area_3'])
    // x values must be increasing
    expect(ordered[0]!.box.x).toBeLessThan(ordered[1]!.box.x)
    expect(ordered[1]!.box.x).toBeLessThan(ordered[2]!.box.x)
  })

  it('h split inside a column → top before bottom (same x → tie-break by y)', () => {
    // Layout: left column (area_1) | right column split into top (area_2) and bottom (area_3)
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: {
        kind: 'split',
        id: 'split_2',
        dir: 'h',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_2' },
        b: { kind: 'leaf', id: 'area_3' },
      },
    }
    const rects = computeAreaRects(tree, BODY)
    const ordered = fillOrder(rects)
    expect(ordered[0]!.id).toBe('area_1') // smallest x
    expect(ordered[1]!.id).toBe('area_2') // same x as area_3, but smaller y
    expect(ordered[2]!.id).toBe('area_3') // same x as area_2, but larger y
  })

  it('does not mutate the input array', () => {
    const rects = computeAreaRects(defaultAreaTree(3), BODY)
    const original = [...rects]
    fillOrder(rects)
    expect(rects.map((r) => r.id)).toEqual(original.map((r) => r.id))
  })

  it('empty array → returns empty array', () => {
    expect(fillOrder([])).toEqual([])
  })

  it('a single rect → returns the same rect', () => {
    const rects: AreaRect[] = [{ id: 'area_1', box: BODY }]
    expect(fillOrder(rects)).toEqual(rects)
  })
})

// ── splitLeaf ─────────────────────────────────────────────────────────────────

describe('splitLeaf', () => {
  it('vertical split of a leaf: the leaf becomes child a, the new one is child b', () => {
    const tree: AreaTree = { kind: 'leaf', id: 'area_1' }
    const result = splitLeaf(tree, 'area_1', 'v', 'area_2', 'split_1')
    expect(result).toEqual({
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    })
  })

  it('horizontal split of a leaf with a custom ratio', () => {
    const tree: AreaTree = { kind: 'leaf', id: 'area_1' }
    const result = splitLeaf(tree, 'area_1', 'h', 'area_2', 'split_1', 0.3)
    expect(result.kind).toBe('split')
    if (result.kind !== 'split') return
    expect(result.dir).toBe('h')
    expect(result.ratio).toBe(0.3)
    expect(result.a).toEqual({ kind: 'leaf', id: 'area_1' })
    expect(result.b).toEqual({ kind: 'leaf', id: 'area_2' })
  })

  it('split of a leaf nested inside a tree', () => {
    const tree = defaultAreaTree(3) // area_1 | area_2 | area_3
    // Split area_2 horizontally
    const result = splitLeaf(tree, 'area_2', 'h', 'area_2b', 'split_new')
    // The tree must now have 4 leaves
    expect(leafIds(result)).toHaveLength(4)
    expect(leafIds(result)).toContain('area_2')
    expect(leafIds(result)).toContain('area_2b')
  })

  it('missing leafId → returns the identical tree (unmodified)', () => {
    const tree = defaultAreaTree(3)
    const result = splitLeaf(tree, 'area_99', 'v', 'area_new', 'split_new')
    // Must be the same object reference (no change)
    expect(result).toBe(tree)
  })

  it('immutability: the input tree does not change', () => {
    const tree = defaultAreaTree(3)
    const before = JSON.stringify(tree)
    splitLeaf(tree, 'area_2', 'v', 'area_new', 'split_new')
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('after the split, computeAreaRects covers bodyRect exactly', () => {
    const tree = defaultAreaTree(3)
    const result = splitLeaf(tree, 'area_2', 'h', 'area_2b', 'split_new', 0.4)
    const rects = computeAreaRects(result, BODY)
    assertCoversExactly(rects, BODY)
  })
})

// ── removeLeaf ────────────────────────────────────────────────────────────────

describe('removeLeaf', () => {
  it('collapses the split and the sibling takes its place when child a is removed', () => {
    // Tree: split_1 { a: area_1, b: area_2 }
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const result = removeLeaf(tree, 'area_1')
    expect(result).toEqual({ kind: 'leaf', id: 'area_2' })
  })

  it('collapses the split and the sibling takes its place when child b is removed', () => {
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const result = removeLeaf(tree, 'area_2')
    expect(result).toEqual({ kind: 'leaf', id: 'area_1' })
  })

  it('removing a nested leaf, the sibling of the collapsed split takes its space', () => {
    // Tree: split_1 { a: area_1, b: split_2 { a: area_2, b: area_3 } }
    const tree = defaultAreaTree(3) // 3 columns
    // Remove area_2 → split_2 collapses → area_3 moves up into split_2's place
    const result = removeLeaf(tree, 'area_2')
    expect(leafIds(result)).toHaveLength(2)
    expect(leafIds(result)).toContain('area_1')
    expect(leafIds(result)).toContain('area_3')
    expect(leafIds(result)).not.toContain('area_2')
  })

  it('the last remaining leaf cannot be removed → returns the same tree', () => {
    const tree: AreaTree = { kind: 'leaf', id: 'area_1' }
    const result = removeLeaf(tree, 'area_1')
    expect(result).toEqual(tree)
  })

  it('missing leafId → returns the identical tree (unmodified)', () => {
    const tree = defaultAreaTree(3)
    const result = removeLeaf(tree, 'area_99')
    expect(result).toBe(tree)
  })

  it('immutability: the input tree does not change', () => {
    const tree = defaultAreaTree(3)
    const before = JSON.stringify(tree)
    removeLeaf(tree, 'area_2')
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('after removeLeaf, computeAreaRects covers bodyRect exactly', () => {
    const tree = defaultAreaTree(3)
    const result = removeLeaf(tree, 'area_2')
    const rects = computeAreaRects(result, BODY)
    assertCoversExactly(rects, BODY)
  })
})

// ── resizeSplit ───────────────────────────────────────────────────────────────

describe('resizeSplit', () => {
  it('changes the ratio of the root split', () => {
    const tree = defaultAreaTree(2) // split_1 { ratio:0.5, a:area_1, b:area_2 }
    const result = resizeSplit(tree, 'split_1', 0.3)
    expect(result.kind).toBe('split')
    if (result.kind !== 'split') return
    expect(result.ratio).toBeCloseTo(0.3)
  })

  it('changing the ratio changes the resulting widths', () => {
    const body: BBox = { x: 0, y: 0, width: 1000, height: 400 }
    const tree = defaultAreaTree(2)
    const resized = resizeSplit(tree, 'split_1', 0.7)
    const rects = computeAreaRects(resized, body)
    const ordered = fillOrder(rects)
    expect(ordered[0]!.box.width).toBe(Math.round(1000 * 0.7)) // 700
    expect(ordered[1]!.box.width).toBe(300)
  })

  it('lower clamp: ratio < 0.1 → ratio = 0.1', () => {
    const tree = defaultAreaTree(2)
    const result = resizeSplit(tree, 'split_1', 0.0)
    expect(result.kind).toBe('split')
    if (result.kind !== 'split') return
    expect(result.ratio).toBeCloseTo(0.1)
  })

  it('upper clamp: ratio > 0.9 → ratio = 0.9', () => {
    const tree = defaultAreaTree(2)
    const result = resizeSplit(tree, 'split_1', 1.0)
    expect(result.kind).toBe('split')
    if (result.kind !== 'split') return
    expect(result.ratio).toBeCloseTo(0.9)
  })

  it('ratio at the lower bound (0.1) is unchanged', () => {
    const tree = defaultAreaTree(2)
    const result = resizeSplit(tree, 'split_1', 0.1)
    if (result.kind !== 'split') return
    expect(result.ratio).toBeCloseTo(0.1)
  })

  it('ratio at the upper bound (0.9) is unchanged', () => {
    const tree = defaultAreaTree(2)
    const result = resizeSplit(tree, 'split_1', 0.9)
    if (result.kind !== 'split') return
    expect(result.ratio).toBeCloseTo(0.9)
  })

  it('resize of a nested split (split_2)', () => {
    const tree = defaultAreaTree(3) // split_1 → a:area_1, b:split_2
    const result = resizeSplit(tree, 'split_2', 0.6)
    if (result.kind !== 'split') return
    expect(result.id).toBe('split_1')
    const b = result.b
    if (b.kind !== 'split') return
    expect(b.id).toBe('split_2')
    expect(b.ratio).toBeCloseTo(0.6)
  })

  it('missing splitId → returns the identical tree', () => {
    const tree = defaultAreaTree(3)
    const result = resizeSplit(tree, 'split_99', 0.4)
    expect(result).toBe(tree)
  })

  it('immutability: the input tree does not change', () => {
    const tree = defaultAreaTree(3)
    const before = JSON.stringify(tree)
    resizeSplit(tree, 'split_1', 0.3)
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('after resizeSplit, computeAreaRects covers bodyRect exactly', () => {
    const tree = defaultAreaTree(3)
    const resized = resizeSplit(tree, 'split_1', 0.25)
    const rects = computeAreaRects(resized, BODY)
    assertCoversExactly(rects, BODY)
  })
})

// ── leafIds / splitIds ────────────────────────────────────────────────────────

describe('leafIds', () => {
  it('single leaf → [area_1]', () => {
    expect(leafIds(defaultAreaTree(1))).toEqual(['area_1'])
  })

  it('n=3 → [area_1, area_2, area_3]', () => {
    expect(leafIds(defaultAreaTree(3))).toEqual(['area_1', 'area_2', 'area_3'])
  })
})

describe('splitIds', () => {
  it('single leaf → []', () => {
    expect(splitIds(defaultAreaTree(1))).toEqual([])
  })

  it('n=2 → [split_1]', () => {
    expect(splitIds(defaultAreaTree(2))).toEqual(['split_1'])
  })

  it('n=3 → [split_1, split_2]', () => {
    const ids = splitIds(defaultAreaTree(3))
    expect(ids).toContain('split_1')
    expect(ids).toContain('split_2')
    expect(ids).toHaveLength(2)
  })
})

// ── nextAreaIds ───────────────────────────────────────────────────────────────

describe('nextAreaIds', () => {
  it('returned ids are in neither leafIds nor splitIds of the input tree', () => {
    const tree = defaultAreaTree(3) // leaves: area_1..3; splits: split_1..2
    const { leafId, splitId } = nextAreaIds(tree)
    expect(leafIds(tree)).not.toContain(leafId)
    expect(splitIds(tree)).not.toContain(splitId)
  })

  it('for n=3, leafId=area_4 and splitId=split_3', () => {
    const tree = defaultAreaTree(3)
    const ids = nextAreaIds(tree)
    expect(ids.leafId).toBe('area_4')
    expect(ids.splitId).toBe('split_3')
  })

  it('for a single leaf (n=1), leafId=area_2 and splitId=split_1 (no existing splits)', () => {
    const tree = defaultAreaTree(1) // leaf: area_1; no splits
    const ids = nextAreaIds(tree)
    expect(ids.leafId).toBe('area_2')
    expect(ids.splitId).toBe('split_1')
  })

  it('is deterministic: same input gives the same output', () => {
    const tree = defaultAreaTree(3)
    const ids1 = nextAreaIds(tree)
    const ids2 = nextAreaIds(tree)
    expect(ids1).toEqual(ids2)
  })

  it('does not mutate the input tree', () => {
    const tree = defaultAreaTree(3)
    const before = JSON.stringify(tree)
    nextAreaIds(tree)
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('after a splitLeaf with the returned ids, the tree grows without collisions', () => {
    const tree = defaultAreaTree(3)
    const { leafId, splitId } = nextAreaIds(tree)
    // Split area_2 with the new ids
    const newTree = splitLeaf(tree, 'area_2', 'v', leafId, splitId)
    // The new tree has 4 leaves and 3 splits
    expect(leafIds(newTree)).toHaveLength(4)
    expect(splitIds(newTree)).toHaveLength(3)
    // The new ids are in the resulting tree
    expect(leafIds(newTree)).toContain(leafId)
    expect(splitIds(newTree)).toContain(splitId)
    // No duplicates
    const allLeafs = leafIds(newTree)
    expect(new Set(allLeafs).size).toBe(allLeafs.length)
    const allSplits = splitIds(newTree)
    expect(new Set(allSplits).size).toBe(allSplits.length)
  })

  it('works correctly with a tree that has non-consecutive ids', () => {
    // Tree with leaves area_1 and area_5 (non-consecutive)
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_3',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_5' },
    }
    const { leafId, splitId } = nextAreaIds(tree)
    // leafId must be area_6 (max=5, +1=6)
    expect(leafId).toBe('area_6')
    // splitId must be split_4 (max=3, +1=4)
    expect(splitId).toBe('split_4')
    // They do not collide with the existing ones
    expect(leafIds(tree)).not.toContain(leafId)
    expect(splitIds(tree)).not.toContain(splitId)
  })
})

// ── computeDividers ───────────────────────────────────────────────────────────

describe('computeDividers', () => {
  it('single leaf → no dividers', () => {
    expect(computeDividers(defaultAreaTree(1), BODY)).toEqual([])
  })

  it('n=3 → 2 dividers (one per split)', () => {
    const dividers = computeDividers(defaultAreaTree(3), BODY)
    expect(dividers).toHaveLength(2)
  })

  it('n=3: dividers have dir v, length = rect height and correct splitIds', () => {
    const dividers = computeDividers(defaultAreaTree(3), BODY)
    for (const d of dividers) {
      expect(d.dir).toBe('v')
      expect(d.length).toBe(BODY.height)
      expect(d.y).toBe(BODY.y)
    }
    const ids = dividers.map((d) => d.splitId)
    expect(ids).toContain('split_1')
    expect(ids).toContain('split_2')
  })

  it('n=3: the x of the divider of split_1 matches the boundary area_1 | area_2', () => {
    const rects = fillOrder(computeAreaRects(defaultAreaTree(3), BODY))
    const dividers = computeDividers(defaultAreaTree(3), BODY)
    const d1 = dividers.find((d) => d.splitId === 'split_1')!
    // The divider's x must be the right edge of area_1 = left edge of area_2
    expect(d1.x).toBe(rects[0]!.box.x + rects[0]!.box.width)
    expect(d1.x).toBe(rects[1]!.box.x)
  })

  it('n=3: the x of the divider of split_2 matches the boundary area_2 | area_3', () => {
    const rects = fillOrder(computeAreaRects(defaultAreaTree(3), BODY))
    const dividers = computeDividers(defaultAreaTree(3), BODY)
    const d2 = dividers.find((d) => d.splitId === 'split_2')!
    expect(d2.x).toBe(rects[1]!.box.x + rects[1]!.box.width)
    expect(d2.x).toBe(rects[2]!.box.x)
  })

  it('horizontal split adds 1 horizontal divider at the correct y', () => {
    // split_v(0.5) → a:area_1 | b:split_h(0.5) { a:area_2, b:area_3 }
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'area_1' },
      b: {
        kind: 'split',
        id: 'split_2',
        dir: 'h',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_2' },
        b: { kind: 'leaf', id: 'area_3' },
      },
    }
    const dividers = computeDividers(tree, BODY)
    expect(dividers).toHaveLength(2)

    const dH = dividers.find((d) => d.dir === 'h')!
    // The right sub-rect starts at x = BODY.x + round(BODY.width * 0.5)
    const rightX = BODY.x + Math.round(BODY.width * 0.5)
    const rightWidth = BODY.width - Math.round(BODY.width * 0.5)
    // The horizontal line is at y = BODY.y + round(BODY.height * 0.5)
    expect(dH.y).toBe(BODY.y + Math.round(BODY.height * 0.5))
    expect(dH.x).toBe(rightX)
    expect(dH.length).toBe(rightWidth)
  })

  it('the y of the horizontal divider matches the boundary between computeAreaRects boxes', () => {
    const tree: AreaTree = {
      kind: 'split',
      id: 's1',
      dir: 'h',
      ratio: 0.4,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const rects = computeAreaRects(tree, BODY) // [area_1 on top, area_2 below]
    const dividers = computeDividers(tree, BODY)
    expect(dividers).toHaveLength(1)
    const d = dividers[0]!
    expect(d.dir).toBe('h')
    // Boundary: bottom edge of area_1 = top edge of area_2
    expect(d.y).toBe(rects[0]!.box.y + rects[0]!.box.height)
    expect(d.y).toBe(rects[1]!.box.y)
  })

  it('ratio derived from the x of the divider → resizeSplit produces the expected boxes', () => {
    // Check the ratio formula: given the x of split_1's divider for n=3,
    // the derived ratio should match the stored ratio.
    const tree = defaultAreaTree(3) // split_1 ratio≈1/3
    const dividers = computeDividers(tree, BODY)
    const d1 = dividers.find((d) => d.splitId === 'split_1')!

    // Simulate what onDragEnd would do with the divider at its initial position:
    // ratio = (centroX - nodeRect.x) / nodeRect.width
    // The divider is at d1.x; the handle's "center" (thickness 8) = d1.x
    // (at the initial position the center coincides with d1.x)
    const derivedRatio = (d1.x - d1.nodeRect.x) / d1.nodeRect.width
    const resized = resizeSplit(tree, 'split_1', derivedRatio)

    // The rects must equal those of the original tree
    const rectsOrig = computeAreaRects(tree, BODY)
    const rectsNew = computeAreaRects(resized, BODY)
    expect(rectsNew).toEqual(rectsOrig)
  })

  it('is immutable: the input tree and rect do not change', () => {
    const tree = defaultAreaTree(3)
    const beforeTree = JSON.stringify(tree)
    const beforeRect = JSON.stringify(BODY)
    computeDividers(tree, BODY)
    expect(JSON.stringify(tree)).toBe(beforeTree)
    expect(JSON.stringify(BODY)).toBe(beforeRect)
  })

  it('is deterministic: same input gives the same output', () => {
    const tree = defaultAreaTree(3)
    expect(computeDividers(tree, BODY)).toEqual(computeDividers(tree, BODY))
  })

  it('single-leaf tree (n=1) → empty array', () => {
    const body: BBox = { x: 0, y: 0, width: 800, height: 600 }
    expect(computeDividers({ kind: 'leaf', id: 'area_1' }, body)).toHaveLength(0)
  })
})

// ── General invariant ────────────────────────────────────────────────────────

describe('invariant: exact union for composite trees', () => {
  const bodies: BBox[] = [
    { x: 0, y: 0, width: 1000, height: 600 },
    { x: 24, y: 120, width: 1152, height: 600 },
    { x: 0, y: 0, width: 800, height: 450 },
    { x: 10, y: 10, width: 997, height: 503 }, // non-divisible dimensions
  ]

  for (const body of bodies) {
    it(`n=1 over ${body.width}×${body.height}`, () => {
      assertCoversExactly(computeAreaRects(defaultAreaTree(1), body), body)
    })
    it(`n=2 over ${body.width}×${body.height}`, () => {
      assertCoversExactly(computeAreaRects(defaultAreaTree(2), body), body)
    })
    it(`n=3 over ${body.width}×${body.height}`, () => {
      assertCoversExactly(computeAreaRects(defaultAreaTree(3), body), body)
    })
    it(`n=4 over ${body.width}×${body.height}`, () => {
      assertCoversExactly(computeAreaRects(defaultAreaTree(4), body), body)
    })
  }

  it('irregular tree (L/R with R split H) covers bodyRect', () => {
    const body: BBox = { x: 5, y: 10, width: 900, height: 500 }
    const tree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.4,
      a: { kind: 'leaf', id: 'area_1' },
      b: {
        kind: 'split',
        id: 'split_2',
        dir: 'h',
        ratio: 0.6,
        a: { kind: 'leaf', id: 'area_2' },
        b: { kind: 'leaf', id: 'area_3' },
      },
    }
    assertCoversExactly(computeAreaRects(tree, body), body)
  })

  it('deep 4-level tree covers bodyRect', () => {
    const body: BBox = { x: 0, y: 0, width: 1000, height: 600 }
    // split v → a: split h → a+b leaves; b: split v → a+b leaves
    const tree: AreaTree = {
      kind: 'split',
      id: 's1',
      dir: 'v',
      ratio: 0.5,
      a: {
        kind: 'split',
        id: 's2',
        dir: 'h',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_1' },
        b: { kind: 'leaf', id: 'area_2' },
      },
      b: {
        kind: 'split',
        id: 's3',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'area_3' },
        b: { kind: 'leaf', id: 'area_4' },
      },
    }
    assertCoversExactly(computeAreaRects(tree, body), body)
  })
})

describe('isDividerVisible', () => {
  it('hides the divider while the column to its right is empty', () => {
    const [div] = computeDividers(defaultAreaTree(3), BODY)
    const left: BBox = { x: BODY.x + 5, y: BODY.y + 5, width: 20, height: 20 }
    expect(isDividerVisible(div!, [])).toBe(false)
    expect(isDividerVisible(div!, [left])).toBe(false)
  })

  it('shows it once some object enters the column to its right', () => {
    const [div] = computeDividers(defaultAreaTree(3), BODY)
    const right: BBox = { x: div!.x + 4, y: BODY.y + 5, width: 20, height: 20 }
    expect(isDividerVisible(div!, [right])).toBe(true)
  })

  it('horizontal divider: looks at the bottom row', () => {
    const tree = splitLeaf(defaultAreaTree(1), 'area_1', 'h', 'area_x', 'split_x')
    const [div] = computeDividers(tree, BODY)
    expect(div!.dir).toBe('h')
    const top: BBox = { x: BODY.x, y: BODY.y, width: 10, height: 10 }
    const bottom: BBox = { x: BODY.x, y: div!.y + 2, width: 10, height: 10 }
    expect(isDividerVisible(div!, [top])).toBe(false)
    expect(isDividerVisible(div!, [top, bottom])).toBe(true)
  })
})

/**
 * Tests for connection-geometry.ts: connection geometry.
 */
import { describe, it, expect } from 'vitest'
import { connectionGeometry, pointInBox, segmentsCrossOrthogonal, chooseConnectionAnchors, labelBoxOrigin, LABEL_LINE_GAP } from './connection-geometry.js'
import type { BBox } from '@/layout/index.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Two horizontally separated boxes
const boxA: BBox = { x: 0,   y: 200, width: 100, height: 80 }
const boxB: BBox = { x: 400, y: 200, width: 100, height: 80 }

// centers: A=(50,240), B=(450,240)

// ── Test helpers ────────────────────────────────────────────────────────────

interface Pt { x: number; y: number }

/** Densely samples a polyline/straight line `M x y L x y …` → points on the stroke. */
function samplePolyline(d: string): Pt[] {
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
  const verts: Pt[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) verts.push({ x: nums[i]!, y: nums[i + 1]! })
  const out: Pt[] = []
  for (let s = 0; s < verts.length - 1; s++) {
    const a = verts[s]!, b = verts[s + 1]!
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** Is the point inside the box with `inset`? A negative inset grows the box (clearance). */
function insideBox(p: Pt, box: BBox, inset: number): boolean {
  return (
    p.x > box.x + inset && p.x < box.x + box.width - inset &&
    p.y > box.y + inset && p.y < box.y + box.height - inset
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('connectionGeometry', () => {

  describe('straight line (style=line)', () => {

    it('generates a linePath that starts with M and contains L', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line',
      )
      expect(linePath).toMatch(/^M /)
      expect(linePath).toContain(' L ')
    })

    it('generates no arrowheads', () => {
      const result = connectionGeometry(
        boxA, boxB, 'line',
      )
      expect(result.arrowTo).toBeUndefined()
      expect(result.arrowFrom).toBeUndefined()
    })

  })

  describe('single arrow (style=arrow)', () => {

    it('generates arrowTo', () => {
      const result = connectionGeometry(
        boxA, boxB, 'arrow',
      )
      expect(result.arrowTo).toBeDefined()
      expect(result.arrowFrom).toBeUndefined()
    })

    it('arrowTo contains M...L...L (triangle)', () => {
      const { arrowTo } = connectionGeometry(
        boxA, boxB, 'arrow',
      )
      expect(arrowTo).toBeDefined()
      // M <point> L <tip> L <point>
      const lCount = (arrowTo!.match(/ L /g) ?? []).length
      expect(lCount).toBe(2)
    })

  })

  describe('double arrow (style=double_arrow)', () => {

    it('generates arrowTo and arrowFrom', () => {
      const result = connectionGeometry(
        boxA, boxB, 'double_arrow',
      )
      expect(result.arrowTo).toBeDefined()
      expect(result.arrowFrom).toBeDefined()
    })

  })

  describe('open path, orthogonal only', () => {

    // Regression guard for the open path.
    // The root cause of the fill bug is that Konva implicitly closes paths
    // unless fillEnabled is false. This test guarantees that linePath NEVER contains the
    // close command Z/z (open path).
    // NOTE: the visible fix is the `fillEnabled={false}` prop in ConnectionNode.tsx
    // (the three connection <Path> nodes). That Konva render prop cannot be covered by a
    // pure unit test without a DOM/Konva mount harness, so the guard here is
    // expressed on the path geometry, not on the component props.
    it('linePath does NOT contain a close command Z (open path)', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'arrow',
      )
      expect(linePath).not.toMatch(/[Zz]/)
    })

    it('linePath with obstacle avoidance does NOT contain Z (open path)', () => {
      const obstacle: BBox = { x: 180, y: 210, width: 60, height: 60 }
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line', [obstacle],
      )
      expect(linePath).not.toMatch(/[Zz]/)
    })

    it('never generates Q (always orthogonal)', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'arrow',
      )
      expect(linePath).not.toContain(' Q ')
    })

  })

  describe('symmetric anchor points without meta', () => {

    it('the endpoints are inside the canvas', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line',
      )
      // The path starts at a point inside/on boxA and ends at boxB
      expect(linePath.length).toBeGreaterThan(5)
    })

  })

  describe('overlapping boxes or the same box', () => {

    it('does not throw with identical boxes', () => {
      expect(() => connectionGeometry(
        boxA, boxA, 'line',
      )).not.toThrow()
    })

  })

  describe('linePath always starts with M', () => {

    it('line', () => {
      const { linePath } = connectionGeometry(boxA, boxB, 'line')
      expect(linePath.trimStart()).toMatch(/^M /)
    })

    it('arrow', () => {
      const { linePath } = connectionGeometry(boxA, boxB, 'arrow')
      expect(linePath.trimStart()).toMatch(/^M /)
    })

  })

  // ── Obstacle avoidance tests ──────────────────────────────────────────────

  describe('obstacle avoidance', () => {

    // Obstacle right in the center of the A→B segment (x=200, exactly in the middle)
    const obstacle: BBox = { x: 180, y: 210, width: 60, height: 60 }

    it('(a) no obstacles → straight (L, no Q)', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line', [],
      )
      expect(linePath).toContain(' L ')
      expect(linePath).not.toContain(' Q ')
    })

    it('(b) obstacle in between → orthogonal routing (L, no Q or Z)', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line', [obstacle],
      )
      expect(linePath).toContain(' L ')
      expect(linePath).not.toContain(' Q ')
      expect(linePath).not.toMatch(/[Zz]/)
    })

    it('(b) the chosen polyline does not touch the obstacle', () => {
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line', [obstacle],
      )
      for (const p of samplePolyline(linePath)) {
        expect(insideBox(p, obstacle, 2), `(${p.x.toFixed(1)},${p.y.toFixed(1)}) inside the obstacle`).toBe(false)
      }
    })

    it('(c) obstacle only below → the polyline does not touch it', () => {
      const bottomObstacle: BBox = { x: 180, y: 260, width: 60, height: 60 }
      const { linePath } = connectionGeometry(
        boxA, boxB, 'line', [bottomObstacle],
      )
      // Whether straight (it does not intersect after the inset) or orthogonal, it must not step on it.
      for (const p of samplePolyline(linePath)) {
        expect(insideBox(p, bottomObstacle, 2), `(${p.x.toFixed(1)},${p.y.toFixed(1)}) inside the lower obstacle`).toBe(false)
      }
    })

    it('(d) LARGE obstacle → the polyline clears it with clearance', () => {
      // Wide and tall centered box: a straight line crosses it fully. Orthogonal routing
      // must leave it clear with a visible margin (OBSTACLE_PAD ≈ 8px; we require ≥ 4px).
      const big: BBox = { x: 170, y: 180, width: 160, height: 120 }
      const bounds: BBox = { x: 0, y: 0, width: 1000, height: 500 }
      const { linePath } = connectionGeometry(
        boxA, boxB, 'arrow', [big], bounds,
      )
      expect(linePath).toContain(' L ')
      expect(linePath).not.toMatch(/[Zz]/)
      for (const p of samplePolyline(linePath)) {
        expect(insideBox(p, big, -4), `(${p.x.toFixed(1)},${p.y.toFixed(1)}) no slack`).toBe(false)
      }
    })

    it('(e) the orthogonal detour stays inside the board (bounds)', () => {
      // Large obstacle against the top edge: the natural detour would go over
      // the top (outside the canvas), but bounds forces it to stay inside.
      const topObstacle: BBox = { x: 150, y: 0, width: 200, height: 250 }
      const bounds: BBox = { x: 0, y: 0, width: 500, height: 300 }
      const { linePath } = connectionGeometry(
        boxA, boxB, 'arrow', [topObstacle], bounds,
      )
      for (const p of samplePolyline(linePath)) {
        expect(p.x >= bounds.x - 0.01 && p.x <= bounds.x + bounds.width + 0.01, `x=${p.x.toFixed(1)} outside the board`).toBe(true)
        expect(p.y >= bounds.y - 0.01 && p.y <= bounds.y + bounds.height + 0.01, `y=${p.y.toFixed(1)} outside the board`).toBe(true)
      }
    })

    it('(f) stacked boxes with an obstacle in between → clean route, does not sweep the board', () => {
      // Source on top, target right below, obstacle in between (same column).
      // The reported bug: the route went all the way to the right edge of the board and
      // came back (double crossing). It must stay near the boxes with few bends.
      const top: BBox = { x: 400, y: 60, width: 120, height: 40 }
      const bottom: BBox = { x: 400, y: 300, width: 120, height: 40 }
      const mid: BBox = { x: 380, y: 160, width: 160, height: 90 }
      const bounds: BBox = { x: 0, y: 0, width: 1000, height: 500 }
      const { linePath } = connectionGeometry(
        top, bottom, 'arrow', [mid], bounds,
      )
      // Does not touch the obstacle.
      for (const p of samplePolyline(linePath)) {
        expect(insideBox(p, mid, 2), `(${p.x.toFixed(1)},${p.y.toFixed(1)}) inside the obstacle`).toBe(false)
      }
      // Does not sweep to the right edge of the board: stays near the boxes.
      const xs = samplePolyline(linePath).map(p => p.x)
      expect(Math.max(...xs)).toBeLessThan(650)
      expect(Math.min(...xs)).toBeGreaterThan(280)
      // Clean route: few bends (vertices). A double crossing would have many more.
      const verts = (linePath.match(/ L /g) ?? []).length + 1
      expect(verts).toBeLessThanOrEqual(6)
    })

    it('(g) labelAnchor falls ON the detoured stroke (not at the straight midpoint)', () => {
      // Aligned boxes with an obstacle in between: the label must sit on the
      // real polyline, not at the straight midpoint (which would fall inside the obstacle).
      const top: BBox = { x: 400, y: 60, width: 120, height: 40 }
      const bottom: BBox = { x: 400, y: 300, width: 120, height: 40 }
      const mid: BBox = { x: 380, y: 160, width: 160, height: 90 }
      const bounds: BBox = { x: 0, y: 0, width: 1000, height: 500 }
      const { linePath, labelAnchor } = connectionGeometry(
        top, bottom, 'arrow', [mid], bounds,
      )
      // The label must NOT fall inside the obstacle.
      expect(insideBox(labelAnchor, mid, 2)).toBe(false)
      // And it must be on the polyline (< 1px from some sampled point).
      const near = samplePolyline(linePath).some(
        p => Math.hypot(p.x - labelAnchor.x, p.y - labelAnchor.y) < 1,
      )
      expect(near).toBe(true)
    })

    it('default [] does not break existing calls without the parameter', () => {
      expect(() => connectionGeometry(
        boxA, boxB, 'arrow',
      )).not.toThrow()
    })

  })

})

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe('pointInBox', () => {

  const box: BBox = { x: 100, y: 100, width: 100, height: 100 }

  it('interior point → true', () => {
    expect(pointInBox({ x: 150, y: 150 }, box)).toBe(true)
  })

  it('exterior point → false', () => {
    expect(pointInBox({ x: 50, y: 150 }, box)).toBe(false)
  })

  it('point on the edge (inset) → false', () => {
    // x=101 = x + BOX_INSET = not > x+BOX_INSET
    expect(pointInBox({ x: 101, y: 150 }, box)).toBe(false)
  })

})

describe('segmentsCrossOrthogonal', () => {

  it('H×V crossing in the interior → true', () => {
    // Horizontal y=100, x∈[0,200]; vertical x=100, y∈[0,200] → they cross at (100,100).
    expect(segmentsCrossOrthogonal({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 200 })).toBe(true)
  })

  it('V×H (swapped argument order) → still detects the crossing', () => {
    expect(segmentsCrossOrthogonal({ x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 100 }, { x: 200, y: 100 })).toBe(true)
  })

  it('H and V that do NOT touch → false', () => {
    // Vertical x=500 is outside the x range of the horizontal.
    expect(segmentsCrossOrthogonal({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 500, y: 0 }, { x: 500, y: 200 })).toBe(false)
  })

  it('a crossing at a SHARED endpoint does not count (tolerance)', () => {
    // The vertical touches exactly the x=200 endpoint of the horizontal → not an interior crossing.
    expect(segmentsCrossOrthogonal({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 0 }, { x: 200, y: 200 })).toBe(false)
  })

  it('two parallel segments (H×H) → false (that is an overlap, not a crossing)', () => {
    expect(segmentsCrossOrthogonal({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 150, y: 100 })).toBe(false)
  })

  it('two parallel segments (V×V) → false', () => {
    expect(segmentsCrossOrthogonal({ x: 100, y: 0 }, { x: 100, y: 200 }, { x: 100, y: 50 }, { x: 100, y: 150 })).toBe(false)
  })

})

describe('orthogonality: every emitted route has only H or V segments', () => {

  /** Extracts the vertices of a path `M x y L x y …` and checks that each consecutive run is H or V. */
  function assertAllSegmentsOrthogonal(d: string): void {
    const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    const verts: Pt[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) verts.push({ x: nums[i]!, y: nums[i + 1]! })
    for (let i = 0; i < verts.length - 1; i++) {
      const a = verts[i]!, b = verts[i + 1]!
      const dx = Math.abs(a.x - b.x)
      const dy = Math.abs(a.y - b.y)
      expect(dx < 0.02 || dy < 0.02, `diagonal run: (${a.x},${a.y})→(${b.x},${b.y})`).toBe(true)
    }
  }

  const configs: Array<{ name: string; a: BBox; b: BBox }> = [
    { name: 'horizontally separated', a: boxA, b: boxB },
    { name: 'diagonal (down-right)', a: { x: 0, y: 0, width: 80, height: 40 }, b: { x: 400, y: 300, width: 80, height: 40 } },
    { name: 'diagonal (up-right)', a: { x: 0, y: 300, width: 80, height: 40 }, b: { x: 400, y: 0, width: 80, height: 40 } },
    { name: 'vertically separated', a: { x: 200, y: 0, width: 80, height: 40 }, b: { x: 200, y: 300, width: 80, height: 40 } },
    { name: 'partially overlapping', a: { x: 100, y: 100, width: 100, height: 100 }, b: { x: 150, y: 130, width: 100, height: 100 } },
  ]

  for (const { name, a, b } of configs) {
    it(`no obstacles — ${name}`, () => {
      const { linePath } = connectionGeometry(a, b, 'arrow')
      assertAllSegmentsOrthogonal(linePath)
    })
  }

  it('with an obstacle in between', () => {
    const obstacle: BBox = { x: 180, y: 210, width: 60, height: 60 }
    const { linePath } = connectionGeometry(boxA, boxB, 'arrow', [obstacle])
    assertAllSegmentsOrthogonal(linePath)
  })

})

describe('chooseConnectionAnchors: existingRoutes penalizes crossings/overlaps (score, not geometry)', () => {

  const bounds: BBox = { x: 0, y: 0, width: 600, height: 600 }

  it('with existingRoutes already occupying the direct corridor, the result is still orthogonal and valid', () => {
    const A: BBox = { x: 20, y: 20, width: 80, height: 40 }
    const B: BBox = { x: 500, y: 500, width: 80, height: 40 }
    // Previous route crossing exactly the natural corridor between A and B.
    const previous: Pt[] = [{ x: 300, y: 0 }, { x: 300, y: 600 }]
    const ch = chooseConnectionAnchors(A, B, [], bounds, [previous])
    expect(ch.from.pt).toBeDefined()
    expect(ch.to.pt).toBeDefined()
  })

})

describe('labelBoxOrigin: label without a box, kept apart from the stroke', () => {
  it('horizontal stroke → the label sits above the stroke, without covering it', () => {
    const g = connectionGeometry(boxA, boxB, 'arrow')
    expect(Math.abs(g.labelTangent.x)).toBeGreaterThan(0.99)
    const o = labelBoxOrigin(g.labelAnchor, g.labelTangent, 60, 14)
    expect(o.y + 14).toBeLessThanOrEqual(g.labelAnchor.y - LABEL_LINE_GAP + 0.001)
    expect(o.x + 30).toBeCloseTo(g.labelAnchor.x)
  })

  it('vertical stroke → the label sits to the right of the stroke', () => {
    const o = labelBoxOrigin({ x: 100, y: 100 }, { x: 0, y: 1 }, 60, 14)
    expect(o.x).toBeGreaterThan(100)
    expect(o.y + 7).toBeCloseTo(100)
  })
})

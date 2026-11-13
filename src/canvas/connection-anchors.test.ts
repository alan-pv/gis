/**
 * Tests for connection-anchors.ts: spreading connection anchors.
 */
import { describe, it, expect } from 'vitest'
import { assignConnectionAnchors } from './connection-anchors.js'
import { segmentsCrossOrthogonal } from './connection-geometry.js'
import type { Scene, SceneObject, SceneConnection } from '@/scene/index.js'
import type { BBox } from '@/layout/index.js'
import type { Point } from './anchors.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function obj(id: string, box: BBox): SceneObject {
  return { id, object: 'texto', label: null, text: 'x', role: 'cuerpo', box }
}

function conn(id: string, from: string, to: string): SceneConnection {
  return { id, from, to, style: 'arrow', label: null }
}

function scene(objects: SceneObject[], connections: SceneConnection[]): Scene {
  return {
    objects: new Map(objects.map(o => [o.id, o])),
    connections: new Map(connections.map(c => [c.id, c])),
    groups: new Map(),
    highlights: new Map(),
  }
}

const bounds: BBox = { x: 0, y: 0, width: 1000, height: 500 }

/** Do two (already orthogonal) polylines cross at some point interior to both? */
function routesCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCrossOrthogonal(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true
    }
  }
  return false
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assignConnectionAnchors', () => {

  it('a single connection → anchor at the midpoint of the side (no spreading)', () => {
    const target: BBox = { x: 400, y: 200, width: 120, height: 60 }
    const s = scene(
      [obj('a_1', { x: 100, y: 200, width: 100, height: 40 }), obj('t_1', target)],
      [conn('c1', 'a_1', 't_1')],
    )
    const out = assignConnectionAnchors(s, bounds)
    const c1 = out.get('c1')!
    // The target faces left → left side, midpoint (y center).
    expect(c1.to.pt.x).toBe(400)
    expect(c1.to.pt.y).toBeCloseTo(230) // 200 + 60/2
  })

  it('two arrows to the SAME side of the same object → distinct anchor points', () => {
    const target: BBox = { x: 400, y: 200, width: 120, height: 60 }
    const s = scene(
      [
        obj('a_1', { x: 100, y: 160, width: 100, height: 40 }),
        obj('b_1', { x: 100, y: 260, width: 100, height: 40 }),
        obj('t_1', target),
      ],
      [conn('c1', 'a_1', 't_1'), conn('c2', 'b_1', 't_1')],
    )
    const out = assignConnectionAnchors(s, bounds)
    const c1 = out.get('c1')!
    const c2 = out.get('c2')!
    // Both enter through the left side of the target…
    expect(c1.to.pt.x).toBe(400)
    expect(c2.to.pt.x).toBe(400)
    // …but at a DIFFERENT height (spread along the side).
    expect(c1.to.pt.y).not.toBeCloseTo(c2.to.pt.y)
    // Both within the vertical range of the target.
    for (const y of [c1.to.pt.y, c2.to.pt.y]) {
      expect(y).toBeGreaterThan(target.y)
      expect(y).toBeLessThan(target.y + target.height)
    }
  })

  it('connection with a nonexistent object → skipped', () => {
    const s = scene(
      [obj('a_1', { x: 0, y: 0, width: 50, height: 50 })],
      [conn('c1', 'a_1', 'fantasma')],
    )
    expect(assignConnectionAnchors(s, bounds).size).toBe(0)
  })

  it('every connection carries an orthogonal route (route) after spreading', () => {
    const s = scene(
      [obj('a_1', { x: 100, y: 200, width: 100, height: 40 }), obj('t_1', { x: 400, y: 200, width: 120, height: 60 })],
      [conn('c1', 'a_1', 't_1')],
    )
    const out = assignConnectionAnchors(s, bounds)
    const route = out.get('c1')!.route
    expect(route).toBeDefined()
    expect(route!.length).toBeGreaterThanOrEqual(2)
    // Each run of the route is purely H or V.
    for (let i = 0; i < route!.length - 1; i++) {
      const a = route![i]!, b = route![i + 1]!
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
      expect(dx < 0.02 || dy < 0.02).toBe(true)
    }
  })

  it('four boxes in the corners: A→D and B→C do not cross after sequential routing', () => {
    // Naive routing would cross at the center (one ↘ diagonal and one ↗). With crossing
    // avoidance the second routed (B→C) must detour to avoid the first (A→D).
    const A: BBox = { x: 20, y: 20, width: 80, height: 40 }
    const B: BBox = { x: 500, y: 20, width: 80, height: 40 }
    const C: BBox = { x: 500, y: 500, width: 80, height: 40 }
    const D: BBox = { x: 20, y: 500, width: 80, height: 40 }
    const bigBounds: BBox = { x: 0, y: 0, width: 620, height: 580 }

    const s = scene(
      [obj('a_1', A), obj('b_1', B), obj('c_1', C), obj('d_1', D)],
      [conn('c1', 'a_1', 'd_1'), conn('c2', 'b_1', 'c_1')],
    )
    const out = assignConnectionAnchors(s, bigBounds)
    const routeAD = out.get('c1')!.route!
    const routeBC = out.get('c2')!.route!
    expect(routesCross(routeAD, routeBC)).toBe(false)
  })

  it('determinism: two calls with the same scene produce the same routes', () => {
    const A: BBox = { x: 20, y: 20, width: 80, height: 40 }
    const B: BBox = { x: 500, y: 20, width: 80, height: 40 }
    const C: BBox = { x: 500, y: 500, width: 80, height: 40 }
    const D: BBox = { x: 20, y: 500, width: 80, height: 40 }
    const s = scene(
      [obj('a_1', A), obj('b_1', B), obj('c_1', C), obj('d_1', D)],
      [conn('c1', 'a_1', 'd_1'), conn('c2', 'b_1', 'c_1')],
    )
    const out1 = assignConnectionAnchors(s, bounds)
    const out2 = assignConnectionAnchors(s, bounds)
    expect(out1.get('c1')!.route).toEqual(out2.get('c1')!.route)
    expect(out1.get('c2')!.route).toEqual(out2.get('c2')!.route)
  })

})

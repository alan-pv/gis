import { describe, it, expect } from 'vitest'
import { highlightPath, ELLIPSE_PAD, BOUNDS_INSET } from './highlight-geometry.js'
import { EMPHASIS_COLOR } from './board-colors.js'
import { HIGHLIGHT_COLOR } from './highlight-geometry.js'

/** Extremes (bbox) of the points of an ellipse path `M/C … Z`. */
function extents(d: string) {
  const n = d.replace(/[MCZ]/g, ' ').trim().split(/\s+/).map(Number)
  const xs: number[] = [], ys: number[] = []
  for (let i = 0; i < n.length; i += 2) { xs.push(n[i]!); ys.push(n[i + 1]!) }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

describe('highlight-geometry: contained ellipse', () => {
  const box = { x: 100, y: 100, width: 200, height: 80 }

  it('without bounds: fits the box with a fixed margin', () => {
    const e = extents(highlightPath(box, 'ellipse'))
    expect(e.x0).toBeCloseTo(box.x - ELLIPSE_PAD)
    expect(e.x1).toBeCloseTo(box.x + box.width + ELLIPSE_PAD)
    expect(e.y0).toBeCloseTo(box.y - ELLIPSE_PAD)
    expect(e.y1).toBeCloseTo(box.y + box.height + ELLIPSE_PAD)
  })

  it('box against the edge: the ellipse shifts inwards and does not overflow the board', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    const edge = { x: 0, y: 0, width: 800, height: 600 }
    const e = extents(highlightPath(edge, 'ellipse', undefined, bounds))
    expect(e.x0).toBeGreaterThanOrEqual(BOUNDS_INSET - 0.001)
    expect(e.y0).toBeGreaterThanOrEqual(BOUNDS_INSET - 0.001)
    expect(e.x1).toBeLessThanOrEqual(800 - BOUNDS_INSET + 0.001)
    expect(e.y1).toBeLessThanOrEqual(600 - BOUNDS_INSET + 0.001)
  })

  it('box near the corner: shifts without changing size when it fits', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    const near = { x: 2, y: 2, width: 100, height: 40 }
    const e = extents(highlightPath(near, 'ellipse', undefined, bounds))
    expect(e.x0).toBeGreaterThanOrEqual(BOUNDS_INSET - 0.001)
    expect(e.x1 - e.x0).toBeCloseTo(100 + 2 * ELLIPSE_PAD)
  })

  it('the highlight stroke is the emphasis red', () => {
    expect(HIGHLIGHT_COLOR).toBe(EMPHASIS_COLOR)
  })
})

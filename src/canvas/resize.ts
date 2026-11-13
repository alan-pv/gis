/**
 * Resize handles (pure module, no Konva or DOM).
 *
 * Continuous float scale (no snapping to small/medium/large).
 * Canvas-only: the values never reach the agent or the schema.
 */
import type { BBox } from '@/layout/index.js'

// ── Types ──────────────────────────────────────────────────────────────────────

/** The 8 possible handles: 4 corners + 4 sides. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Minimum floor (px) of width/height: keeps a handle from inverting the box. */
export const MIN_OBJECT_SIZE = 12

// ── Functions ──────────────────────────────────────────────────────────────────

/**
 * Computes the new box when dragging `handle` to the point (px, py).
 * Continuous float scale (no snapping). The edge opposite to the handle stays
 * fixed; the edge(s) the handle controls follow the pointer, with a floor of
 * `minSize` in each dimension.
 *
 *   - 'w' moves the left edge; 'e' the right one.
 *   - 'n' moves the top edge; 's' the bottom one.
 *   - Corners combine two edges.
 */
export function resizeBox(
  box: BBox,
  handle: ResizeHandle,
  px: number,
  py: number,
  minSize = MIN_OBJECT_SIZE,
): BBox {
  let left   = box.x
  let top    = box.y
  let right  = box.x + box.width
  let bottom = box.y + box.height

  if (handle.includes('w')) left   = Math.min(px, right  - minSize)
  if (handle.includes('e')) right  = Math.max(px, left   + minSize)
  if (handle.includes('n')) top    = Math.min(py, bottom - minSize)
  if (handle.includes('s')) bottom = Math.max(py, top    + minSize)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Position (center) of each handle on the box, for rendering them.
 *
 * Order: nw, n, ne, e, se, s, sw, w (same as RESIZE_HANDLES).
 */
export function resizeHandles(
  box: BBox,
): { handle: ResizeHandle; x: number; y: number }[] {
  const cx = box.x + box.width  / 2
  const cy = box.y + box.height / 2
  const r  = box.x + box.width
  const b  = box.y + box.height

  return [
    { handle: 'nw', x: box.x, y: box.y },
    { handle: 'n',  x: cx,    y: box.y },
    { handle: 'ne', x: r,     y: box.y },
    { handle: 'e',  x: r,     y: cy    },
    { handle: 'se', x: r,     y: b     },
    { handle: 's',  x: cx,    y: b     },
    { handle: 'sw', x: box.x, y: b     },
    { handle: 'w',  x: box.x, y: cy    },
  ]
}

/**
 * Hit-test: returns the handle under (px, py) within `hitRadius`, or null.
 *
 * Priority: corners before sides. Chebyshev (square) distance:
 * `Math.abs(dx) <= hitRadius && Math.abs(dy) <= hitRadius`.
 */
export function handleAtPoint(
  box: BBox,
  px: number,
  py: number,
  hitRadius: number,
): ResizeHandle | null {
  const corners: ResizeHandle[] = ['nw', 'ne', 'se', 'sw']
  const sides:   ResizeHandle[] = ['n', 'e', 's', 'w']
  const pts = resizeHandles(box)
  const byHandle = new Map(pts.map(p => [p.handle, p]))

  // Check corners first (higher priority)
  for (const h of corners) {
    const pt = byHandle.get(h)!
    if (Math.abs(px - pt.x) <= hitRadius && Math.abs(py - pt.y) <= hitRadius) {
      return h
    }
  }
  // Then the sides
  for (const h of sides) {
    const pt = byHandle.get(h)!
    if (Math.abs(px - pt.x) <= hitRadius && Math.abs(py - pt.y) <= hitRadius) {
      return h
    }
  }
  return null
}

/**
 * Appropriate CSS cursor for each handle.
 */
export function cursorFor(handle: ResizeHandle): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize'
    case 'ne': case 'sw': return 'nesw-resize'
    case 'n':  case 's':  return 'ns-resize'
    case 'e':  case 'w':  return 'ew-resize'
  }
}

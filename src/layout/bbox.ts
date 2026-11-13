/**
 * Bounding box types and geometry helpers.
 *
 * A BBox is a rectangle defined by its top-left corner (x, y) and its size.
 * Coordinates are logical canvas pixels.
 */

// ── Base types ────────────────────────────────────────────────────────────────

/** Rectangle with top-left corner (x, y) and size (width, height). */
export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

/** Size without a position. */
export interface Size {
  width: number
  height: number
}

/** Logical canvas space. */
export interface Canvas {
  width: number
  height: number
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Clamps a BBox so it lies fully inside the canvas.
 * The top-left corner cannot be negative; the bottom-right corner cannot
 * leave the canvas.
 */
export function clampToCanvas(box: BBox, canvas: Canvas): BBox {
  // Clamp right/bottom first, then left/top, so boxes larger than the
  // canvas end up at (0,0).
  const x = Math.max(0, Math.min(box.x, canvas.width - box.width))
  const y = Math.max(0, Math.min(box.y, canvas.height - box.height))
  return { x, y, width: box.width, height: box.height }
}

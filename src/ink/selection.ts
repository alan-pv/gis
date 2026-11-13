/**
 * Selection of ink strokes by marquee.
 *
 * Pure module: no DOM, Konva or React.
 */
import type { InkStroke } from './model.js'

// ── Public types ──────────────────────────────────────────────────────────────

/** Selection rectangle in canvas coordinates (width/height may be negative before normalizing). */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Normalizes a rect so width and height are always positive. */
function normalizeRect(rect: SelectionRect): SelectionRect {
  const x = rect.width >= 0 ? rect.x : rect.x + rect.width
  const y = rect.height >= 0 ? rect.y : rect.y + rect.height
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

/** Computes the bounding box of a stroke. Returns null if the stroke has < 4 points. */
function strokeBbox(stroke: InkStroke): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts = stroke.points
  if (pts.length < 4) return null

  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (let i = 0; i < pts.length - 1; i += 2) {
    const x = pts[i]!
    const y = pts[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  return { minX, minY, maxX, maxY }
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Returns the ids of the strokes whose bounding box is COMPLETELY contained in the
 * selection rect. Normalizes the rect before comparing (negative width/height are
 * valid: the user dragged upwards or to the left).
 *
 * @param strokes  Strokes of the active page.
 * @param rect     Selection rectangle (may have negative dimensions).
 */
export function strokesInRect(strokes: InkStroke[], rect: SelectionRect): string[] {
  const norm = normalizeRect(rect)
  const selected: string[] = []

  for (const stroke of strokes) {
    const bbox = strokeBbox(stroke)
    if (!bbox) continue

    // COMPLETELY contained: all the corners of the stroke bbox must be inside the rect
    if (
      bbox.minX >= norm.x &&
      bbox.minY >= norm.y &&
      bbox.maxX <= norm.x + norm.width &&
      bbox.maxY <= norm.y + norm.height
    ) {
      selected.push(stroke.id)
    }
  }

  return selected
}

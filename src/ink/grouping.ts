/**
 * Grouping of ink strokes for the recognizer.
 *
 * Strategy: a "final group" is the most recent strokes whose bounding boxes
 * overlap (with a margin). This allows recognizing figures made of several
 * strokes (a sun = circle + rays) without mixing different figures drawn in
 * distant areas of the canvas.
 *
 * Pure module: no DOM, Konva or React.
 */
import type { InkStroke } from './model.js'

// ── Internal types ────────────────────────────────────────────────────────────

interface Bbox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Computes the bounding box of a stroke. Returns null if the stroke has < 4 points. */
function strokeBbox(stroke: InkStroke): Bbox | null {
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

/** Expands a bbox by `margin` px on each side. */
function expandBbox(b: Bbox, margin: number): Bbox {
  return {
    minX: b.minX - margin,
    minY: b.minY - margin,
    maxX: b.maxX + margin,
    maxY: b.maxY + margin,
  }
}

/** Returns true if the two bboxes intersect (raw coordinates, not expanded). */
function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY
}

/** Union of two bboxes. */
function unionBbox(a: Bbox, b: Bbox): Bbox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Returns the group of FINAL strokes that form one contiguous figure.
 *
 * Algorithm:
 *   1. Start from the last stroke.
 *   2. Walk backwards; accumulate the stroke whose bbox (expanded by margin px)
 *      intersects the accumulated bbox of the group.
 *   3. Stop at the first stroke that does NOT intersect.
 *   4. Return the list in drawing order (not reversed).
 *
 * @param strokes  Strokes of the page, in drawing order.
 * @param margin   Expansion of the accumulated bbox in pixels (default 24).
 */
export function trailingGroup(strokes: InkStroke[], margin = 24): InkStroke[] {
  if (strokes.length === 0) return []

  // Compute the bboxes of all the strokes at once
  const bboxes: (Bbox | null)[] = strokes.map(strokeBbox)

  // Start from the last stroke
  const lastIdx = strokes.length - 1
  const lastBbox = bboxes[lastIdx]

  // If the last stroke is too short (null bbox), return only that stroke
  if (!lastBbox) return [strokes[lastIdx]!]

  // Initialize the group with the last stroke
  const groupIndices: number[] = [lastIdx]
  let accumulated = lastBbox

  // Walk backwards (second to last → first)
  for (let i = lastIdx - 1; i >= 0; i--) {
    const b = bboxes[i]
    // Very short strokes are ignored (not included, but they do not stop the walk either)
    if (!b) continue

    // Check whether the stroke intersects the expanded accumulated bbox
    const expanded = expandBbox(accumulated, margin)
    if (bboxesIntersect(b, expanded)) {
      groupIndices.push(i)
      accumulated = unionBbox(accumulated, b)
    } else {
      // First stroke that does not intersect: stop
      break
    }
  }

  // Reverse to get drawing order (oldest → newest)
  groupIndices.reverse()

  return groupIndices.map(i => strokes[i]!)
}

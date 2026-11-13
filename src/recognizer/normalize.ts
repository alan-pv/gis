/**
 * Canonical $P normalization for point clouds.
 *
 * Pipeline: resample → scale → translateToOrigin.
 * Normalization makes the recognizer invariant to translation and scale.
 *
 * Pure module: no DOM, Konva or React.
 */
import type { CloudPoint } from './types.js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of points of the normalized cloud. */
export const N_POINTS = 32

// ── Internal utilities ────────────────────────────────────────────────────────

function dist2d(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  return Math.sqrt(dx * dx + dy * dy)
}

// ── Resample ──────────────────────────────────────────────────────────────────

/**
 * Redistributes a point cloud into exactly n equidistant points.
 *
 * Important: interpolation happens ONLY between points of the same strokeId.
 * Gaps between different strokes are not interpolated (native $P behavior).
 * If n-1 points remain after the loop (rounding accumulation), the last one is duplicated.
 */
export function resample(points: CloudPoint[], n: number): CloudPoint[] {
  if (points.length === 0) return []
  if (points.length === 1) {
    // Degenerate case: a single point → repeat it n times
    const p = points[0]!
    return Array.from({ length: n }, () => ({ ...p }))
  }

  // Compute the total path length, respecting the gaps between strokes
  let pathLen = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    // Only accumulate length within the same stroke
    if (prev.strokeId === curr.strokeId) {
      pathLen += dist2d(prev.x, prev.y, curr.x, curr.y)
    }
  }

  if (pathLen === 0) {
    // All points are equal or it is a single one-point stroke
    const p = points[0]!
    return Array.from({ length: n }, () => ({ ...p }))
  }

  // Interval between resample points
  const interval = pathLen / (n - 1)

  const resampled: CloudPoint[] = [{ ...points[0]! }]
  // D is the distance accumulated since the last inserted resample point
  let D = 0

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!

    // Do not interpolate between different strokes; reset the accumulator
    if (prev.strokeId !== curr.strokeId) {
      D = 0
      continue
    }

    const segLen = dist2d(prev.x, prev.y, curr.x, curr.y)

    // px, py: "cursor" advancing along the prev→curr segment
    let px = prev.x
    let py = prev.y

    // Distance available in this segment (including what was accumulated before)
    let remaining = D + segLen

    while (remaining >= interval && resampled.length < n) {
      // How far we advance from the current cursor (px, py)
      const advance = interval - D
      const t = advance / dist2d(px, py, curr.x, curr.y)

      const qx = px + t * (curr.x - px)
      const qy = py + t * (curr.y - py)
      const q: CloudPoint = { x: qx, y: qy, strokeId: curr.strokeId }
      resampled.push(q)

      // The new cursor is q; reset D
      px = qx
      py = qy
      remaining -= interval
      D = 0
    }

    D = remaining
  }

  // Guarantee exactly n points (if rounding left n-1, duplicate the last one)
  while (resampled.length < n) {
    resampled.push({ ...resampled[resampled.length - 1]! })
  }

  // Truncate if there were any excess (protect the invariant)
  return resampled.slice(0, n)
}

// ── Scale ─────────────────────────────────────────────────────────────────────

/**
 * UNIFORM scale: divides the coordinates by max(width, height) of the bounding box.
 * If the bounding box has max = 0 (all points equal), returns without scaling.
 */
export function scale(points: CloudPoint[]): CloudPoint[] {
  if (points.length === 0) return []

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const W = maxX - minX
  const H = maxY - minY
  const maxDim = Math.max(W, H)

  // Avoid division by zero when all the points are equal
  if (maxDim === 0) return points.map(p => ({ ...p }))

  return points.map(p => ({
    x: (p.x - minX) / maxDim,
    y: (p.y - minY) / maxDim,
    strokeId: p.strokeId,
  }))
}

// ── Translate to Origin ───────────────────────────────────────────────────────

/**
 * Shifts the cloud so its centroid ends up at (0, 0).
 */
export function translateToOrigin(points: CloudPoint[]): CloudPoint[] {
  if (points.length === 0) return []

  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= points.length
  cy /= points.length

  return points.map(p => ({
    x: p.x - cx,
    y: p.y - cy,
    strokeId: p.strokeId,
  }))
}

// ── Normalize ─────────────────────────────────────────────────────────────────

/**
 * Full $P normalization pipeline:
 *   resample(n=N_POINTS) → scale → translateToOrigin
 */
export function normalize(points: CloudPoint[]): CloudPoint[] {
  return translateToOrigin(scale(resample(points, N_POINTS)))
}

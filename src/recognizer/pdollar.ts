/**
 * Implementation of the $P algorithm (point-cloud recognizer).
 *
 * Reference: Vatavu, Anthony & Wobbrock (2012) "Gestures as Point Clouds".
 * Natively multistroke: the whole gesture is treated as a point cloud,
 * ignoring the number, order and direction of strokes (an advantage over $1/$N).
 *
 * Pure module: no DOM, Konva or React.
 */
import type { CloudPoint, RecognizerTemplate, RecognizerCandidate } from './types.js'
import type { InkStroke } from '../ink/index.js'
import { normalize } from './normalize.js'

// ── Confidence threshold ──────────────────────────────────────────────────────

/**
 * Minimum score for a candidate to be included in the result.
 * Value 0.3: in synthetic tests it filters clearly random scribbles
 * without sacrificing basic geometric figures with some noise (~0.4–0.8).
 * Raise it if false positives show up in production with very short
 * or very irregular strokes.
 */
export const DEFAULT_THRESHOLD = 0.3

// ── Greedy cloud distance ─────────────────────────────────────────────────────

/**
 * Computes the greedy cloud distance between pts1 and pts2 starting from
 * index `start` in pts1 (circular walk).
 *
 * Each point of pts1 (in circular order from start) is matched with the
 * closest UNUSED point of pts2. The weight w decreases linearly with the
 * position in the circular order: w = 1 − ((i−start+n) % n) / n.
 * This makes the first points of the walk weigh more.
 */
export function cloudDistance(
  pts1: CloudPoint[],
  pts2: CloudPoint[],
  start: number,
): number {
  const n = pts1.length
  const used = new Uint8Array(n) // marker of already used points of pts2

  let sum = 0

  for (let i = 0; i < n; i++) {
    // Circular index into pts1
    const idx1 = (start + i) % n
    const p1 = pts1[idx1]!

    // Weight: the first point is worth 1, the last ≈ 0
    const w = 1 - i / n

    // Find the closest unused point of pts2
    let minDist = Infinity
    let minJ = -1

    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      const p2 = pts2[j]!
      const dx = p1.x - p2.x
      const dy = p1.y - p2.y
      const d = dx * dx + dy * dy // compare squares to avoid sqrt
      if (d < minDist) {
        minDist = d
        minJ = j
      }
    }

    if (minJ >= 0) {
      used[minJ] = 1
      sum += w * Math.sqrt(minDist)
    }
  }

  return sum
}

// ── Greedy cloud match ────────────────────────────────────────────────────────

/**
 * Compares a point cloud `points` against a template using greedy
 * matching with sampled start indices.
 *
 * ε = 0.5, step = floor(n^(1-ε)) = floor(sqrt(n)).
 * Start indices i = 0, step, 2·step, … are tried.
 * At each start the distance is computed in both directions (bidirectional)
 * and the minimum is taken.
 */
export function greedyCloudMatch(points: CloudPoint[], template: RecognizerTemplate): number {
  const n = points.length
  const step = Math.floor(Math.sqrt(n)) // n^(1-0.5) = sqrt(n)
  let minDist = Infinity

  for (let i = 0; i < n; i += step) {
    const d1 = cloudDistance(points, template.points, i)
    const d2 = cloudDistance(template.points, points, i)
    const d = Math.min(d1, d2)
    if (d < minDist) minDist = d
  }

  return minDist
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Recognizes the gesture formed by `strokes` against the given templates.
 *
 * Process:
 * 1. Converts each InkStroke to CloudPoints with strokeId = stroke index.
 * 2. Normalizes the whole cloud once.
 * 3. For each template computes the greedy distance and the score.
 * 4. Returns the candidates with score >= threshold, sorted by score descending.
 *
 * Never throws; on invalid input it returns [].
 *
 * @param strokes    Strokes captured by the ink layer.
 * @param templates  Normalized templates (from buildTemplatesFromLibrary).
 * @param options    threshold: minimum score (default DEFAULT_THRESHOLD).
 */
export function recognize(
  strokes: InkStroke[],
  templates: RecognizerTemplate[],
  options?: { threshold?: number },
): RecognizerCandidate[] {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD

  // Input guards
  if (strokes.length === 0) return []
  if (templates.length === 0) return []

  // Build the cloud: flattened x,y pairs → CloudPoints with strokeId = index
  const cloud: CloudPoint[] = []
  for (let si = 0; si < strokes.length; si++) {
    const { points } = strokes[si]!
    for (let k = 0; k + 1 < points.length; k += 2) {
      cloud.push({ x: points[k]!, y: points[k + 1]!, strokeId: si })
    }
  }

  // Guard: fewer than 2 points in total → no recognizable gesture
  if (cloud.length < 2) return []

  // Normalize the gesture once
  const normalized = normalize(cloud)

  // Compare against each template
  const candidates: RecognizerCandidate[] = []

  for (const template of templates) {
    const d = greedyCloudMatch(normalized, template)
    // Score in [0,1]: distance 0 → score 1; distance 2 → score 0; clamped to ≥0
    const score = Math.max(1 - d / 2, 0)
    if (score >= threshold) {
      candidates.push({ name: template.name, score })
    }
  }

  // Sort by descending score
  candidates.sort((a, b) => b.score - a.score)

  return candidates
}

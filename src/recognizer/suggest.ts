/**
 * Ink promotion suggestion.
 *
 * Given the ink strokes of the active page and the recognizer templates,
 * determines whether the last group of contiguous strokes corresponds to a
 * recognizable figure and provides the candidates for the UI chip.
 *
 * `suggestForSelection` obtains the suggestion directly from an explicit set
 * of selected strokes (without going through trailingGroup).
 *
 * Pure module: no DOM, Konva or React.
 */
import type { InkStroke } from '../ink/model.js'
import { trailingGroup } from '../ink/grouping.js'
import type { RecognizerTemplate, RecognizerCandidate } from './types.js'
import { recognize, DEFAULT_THRESHOLD } from './pdollar.js'

// ── Public types ───────────────────────────────────────────────────────────────

export interface PromotionSuggestion {
  /** Ids of the strokes of the final group. */
  strokeIds: string[]
  /** Absolute bounding box of the group (page coordinates). */
  box: { x: number; y: number; width: number; height: number }
  /** Candidates sorted by descending score (top-1 ≥ DEFAULT_THRESHOLD). */
  candidates: RecognizerCandidate[]
}

// ── Secondary threshold for alternative candidates ────────────────────────────

/** Minimum score for a candidate to appear as an alternative in the chip. */
const ALT_THRESHOLD = 0.15

/** Maximum number of candidates returned (top-1 + up to 2 alternatives). */
const MAX_CANDIDATES = 3

// ── Internal pure helper ──────────────────────────────────────────────────────

/**
 * Shared recognition core: receives an already resolved group of strokes
 * and returns the promotion suggestion, or null if it does not pass the thresholds.
 * It does not apply trailingGroup; the caller decides which strokes to pass.
 */
function suggestForGroup(
  group: InkStroke[],
  templates: RecognizerTemplate[],
): PromotionSuggestion | null {
  // Run the recognizer with the secondary threshold to get alternative candidates
  const allCandidates = recognize(group, templates, { threshold: ALT_THRESHOLD })

  // No candidates → a scribble under the secondary threshold; stay silent
  if (allCandidates.length === 0) return null

  // The top-1 must pass the main threshold (DEFAULT_THRESHOLD)
  const top1 = allCandidates[0]!
  if (top1.score < DEFAULT_THRESHOLD) return null

  // Limit to MAX_CANDIDATES candidates (top-1 always included)
  const candidates = allCandidates.slice(0, MAX_CANDIDATES)

  // Compute the absolute bounding box of the group
  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const stroke of group) {
    const pts = stroke.points
    for (let i = 0; i < pts.length - 1; i += 2) {
      const x = pts[i]!
      const y = pts[i + 1]!
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  // Guard in case the group had invalid points (should not happen)
  if (!isFinite(minX)) return null

  return {
    strokeIds: group.map(s => s.id),
    box: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    },
    candidates,
  }
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Computes the promotion suggestion for the last group of strokes.
 *
 * @param strokes    All the strokes of the active page.
 * @param templates  Normalized recognizer templates.
 * @returns PromotionSuggestion if there is a top-1 candidate ≥ DEFAULT_THRESHOLD; null otherwise.
 */
export function suggestForInk(
  strokes: InkStroke[],
  templates: RecognizerTemplate[],
): PromotionSuggestion | null {
  if (strokes.length === 0) return null
  const group = trailingGroup(strokes)
  return suggestForGroup(group, templates)
}

/**
 * Promotion suggestion for an EXPLICIT set of selected strokes.
 * Unlike suggestForInk, it does NOT apply trailingGroup: it recognizes
 * exactly the given strokes (the selection may be non-contiguous).
 * Returns null if there are no strokes or no candidate passes the threshold.
 */
export function suggestForSelection(
  strokes: InkStroke[],
  templates: RecognizerTemplate[],
): PromotionSuggestion | null {
  if (strokes.length === 0) return null
  return suggestForGroup(strokes, templates)
}

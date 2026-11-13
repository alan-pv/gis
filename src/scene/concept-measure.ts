/**
 * Measurement of a CONCEPT: a circle with its free-form name inside.
 *
 * Pure module (no Konva, no DOM), usable in vitest like `estimateTextSize`. The
 * name wraps into at most `CONCEPT_MAX_LINES` lines; the circle must contain the
 * text block (circle circumscribing the rectangle) plus a margin. If it still does
 * not fit, the font shrinks down to `CONCEPT_FONT_MIN`.
 *
 * The circle stroke is drawn like the library's `circulo.svg` (from 5 to 95 of the
 * 100-unit viewBox) so that `connect` anchors, which still use the `circulo` meta,
 * land exactly on the stroke. That is why the box is larger than the drawn circle by
 * `1 / CONCEPT_DRAWN_RATIO`.
 */
import { layoutRuns } from './text-runs.js'
import type { SegmentMeasure, TextLine } from './text-runs.js'
import { estimateSegmentMeasure, TEXT_LINE_HEIGHT } from './text-measure.js'

/**
 * FIXED box diameter for ALL concepts (logical px).
 *
 * 120: the drawn circle measures 0.9 × 120 = 108 px; after the text margin, the text block's
 * diagonal can be at most 92 px, enough for "Precipitation" (a long word; in Kalam 400 it
 * measures 83 px at 16 px and 93 px at 18 px, in 700 90 px at 16 px) on one line at 14-16 px.
 * It fits in a figure slot (2 of 6 units, about 149 px in a 3-area column on a 1440 canvas), and
 * two concepts plus the arrow gap (`CONCEPT_ARROW_GAP`) fit in the content width of a
 * 6-unit block (about 416).
 */
export const CONCEPT_DIAMETER = 120
/** Maximum lines of the name inside the circle. */
export const CONCEPT_MAX_LINES = 3
/** Space (px) between the text block and the circle stroke, per side. */
export const CONCEPT_TEXT_MARGIN = 8
export const CONCEPT_FONT_MIN = 12
/** Fraction of the box taken by the drawn circle (`circulo.svg` spans 5 to 95 of 100). */
export const CONCEPT_DRAWN_RATIO = 0.9

/** Steps of the wrap-width sweep (from the longest word to a single line). */
const WRAP_STEPS = 12
/** Font sizes tried, largest first. */
const FONT_SIZES = [18, 16, 14, 12] as const

export interface ConceptLayout {
  /** Side of the square box (stroke diameter / `CONCEPT_DRAWN_RATIO`), integer. */
  diameter: number
  /** Font size at which the name fits. */
  fontSize: number
  /** Already-wrapped lines of the name (runs with bold). */
  lines: TextLine[]
  /** Displayed plain text (without `**`); `LineSegment.start` indexes into it. */
  plain: string
  /** Width and height of the text block. */
  textWidth: number
  textHeight: number
}

/** Factory of measurers per font size (pure estimator or browser ctx). */
export type ConceptMeasureFor = (fontSize: number) => SegmentMeasure

/**
 * Computes a concept's circle.
 *
 * @param label       Concept name (supports `**bold**`).
 * @param _cap        Ignored (the diameter is fixed); kept in the signature.
 * @param measureFor  Segment measurer per font size.
 */
export function layoutConcept(label: string, _cap: number, measureFor: ConceptMeasureFor): ConceptLayout {
  const text = label.split('\n').join(' ')
  const diameter = CONCEPT_DIAMETER
  // Maximum diagonal of the text block that fits in the drawn circle.
  const maxDiag = diameter * CONCEPT_DRAWN_RATIO - 2 * CONCEPT_TEXT_MARGIN

  let leastBad: ConceptLayout | null = null

  for (const fontSize of FONT_SIZES) {
    const measure = measureFor(fontSize)
    const lineH = fontSize * TEXT_LINE_HEIGHT
    // Width range: from the longest word (each word on its own line) to everything on one line.
    const lo = Math.ceil(layoutRuns(text, null, 0, measure).maxLineWidth)
    const hi = Math.ceil(layoutRuns(text, null, Infinity, measure).maxLineWidth)

    let best: ConceptLayout | null = null
    let bestDiag = Infinity
    for (let k = 0; k <= WRAP_STEPS; k++) {
      const w = Math.ceil(lo + ((hi - lo) * k) / WRAP_STEPS)
      const layout = layoutRuns(text, null, w, measure)
      if (layout.lines.length > CONCEPT_MAX_LINES) continue
      const textWidth = layout.maxLineWidth
      const textHeight = layout.lines.length * lineH
      const diag = Math.hypot(textWidth, textHeight)
      if (diag < bestDiag) {
        bestDiag = diag
        best = { diameter, fontSize, lines: layout.lines, plain: layout.plain, textWidth, textHeight }
      }
    }

    if (best !== null) {
      if (bestDiag <= maxDiag) return best
      leastBad = best // at the minimum font this one stays: fixed box, the text may touch the stroke
    }
  }

  if (leastBad !== null) return leastBad
  // Even at the minimum font it does not fit in 3 lines: a single overflowing line, fixed box.
  const measure = measureFor(CONCEPT_FONT_MIN)
  const layout = layoutRuns(text, null, Infinity, measure)
  return {
    diameter,
    fontSize: CONCEPT_FONT_MIN,
    lines: layout.lines,
    plain: layout.plain,
    textWidth: layout.maxLineWidth,
    textHeight: layout.lines.length * CONCEPT_FONT_MIN * TEXT_LINE_HEIGHT,
  }
}

/** Segment measurer of the pure estimator for a font size (concept = normal weight). */
export const estimateConceptMeasureFor: ConceptMeasureFor = (fontSize) => estimateSegmentMeasure(fontSize, false)

/** Concept layout using the pure estimator (no DOM). */
export function estimateConceptLayout(label: string, cap: number): ConceptLayout {
  return layoutConcept(label, cap, estimateConceptMeasureFor)
}

/** Measurer injectable into the scene environment (`SceneEnv.measureConcept`). */
export type ConceptMeasurer = (label: string, cap: number) => ConceptLayout


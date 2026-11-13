/**
 * Layout and animation helpers for text with runs: node attributes, lines fitted with
 * the browser ctx, and the stroke of a concept circle. Kept apart from the component
 * (`RunsText.tsx`) so that file only exports components.
 */
import type Konva from 'konva'
import { TEXT_PADDING, TEXT_WRAP_SLACK, ROLE_STYLE, estimateSegmentMeasure } from '@/scene/text-measure.js'
import { layoutRuns, stripBold } from '@/scene/text-runs.js'
import type { RunsLayout } from '@/scene/text-runs.js'
import { layoutConcept, estimateConceptLayout } from '@/scene/concept-measure.js'
import type { ConceptLayout } from '@/scene/concept-measure.js'
import type { Role } from '@/contract/index.js'
import { getMeasureCtx, domSegmentMeasure } from './measure-text.js'

/** Attribute of the Shape with the revealed characters (undefined = all visible). */
export const REVEAL_ATTR = 'revealChars'
/** Marker so the player tells this node apart from a `Konva.Text`. */
export const RUNS_ATTR = 'runsText'

/** Is `node` a RunsText? (the player animates it by index, not with `.text()`). */
export function isRunsNode(node: Konva.Node): boolean {
  return node.getAttr(RUNS_ATTR) === true
}

/**
 * Lines of a text object at the width of its box, with the browser ctx.
 * Title: a single line with no wrapping and no marks. Everything else: the same wrapping
 * as the measurement (with TEXT_WRAP_SLACK in case the measurer and the render differ by a sub-pixel).
 */
export function layoutTextForRender(
  text: string,
  role: Role | null | undefined,
  boxWidth: number,
  fontSize: number,
  listStart?: number,
): RunsLayout {
  const ctx = getMeasureCtx()
  const style = ROLE_STYLE[role ?? 'cuerpo']
  // Without a DOM (tests) it falls back to the pure estimator, like domMeasureText.
  const measure = ctx === null
    ? estimateSegmentMeasure(fontSize, style.fontStyle === 'bold')
    : domSegmentMeasure(ctx, fontSize, style.fontStyle)
  if (role === 'titulo') {
    return layoutRuns(stripBold(text).split('\n').join(' '), role, Infinity, measure)
  }
  return layoutRuns(text, role, boxWidth - 2 * TEXT_PADDING + TEXT_WRAP_SLACK, measure, listStart)
}

const conceptCache = new Map<string, ConceptLayout>()

/** Clears the concept layout cache (metrics change when the webfont loads). */
export function clearConceptCache(): void {
  conceptCache.clear()
}

// If the font finishes loading after a measurement (startup wait cap), the layouts
// cached with the fallback font are stale: they are discarded.
if (typeof document !== 'undefined' && typeof document.fonts?.addEventListener === 'function') {
  document.fonts.addEventListener('loadingdone', clearConceptCache)
}

/** Layout (diameter, font and lines) of a concept at the width of its box, with the browser ctx. */
export function layoutConceptForRender(label: string, boxWidth: number): ConceptLayout {
  const key = `${boxWidth}|${label}`
  const hit = conceptCache.get(key)
  if (hit !== undefined) return hit
  const ctx = getMeasureCtx()
  const layout = ctx === null
    ? estimateConceptLayout(label, boxWidth)
    : layoutConcept(label, boxWidth, (fs) => domSegmentMeasure(ctx, fs, 'normal'))
  if (conceptCache.size > 300) conceptCache.clear()
  conceptCache.set(key, layout)
  return layout
}

/** Path of a concept circle in its box coords: the same stroke as `circulo.svg` (5–95 of 100). */
export function conceptCirclePath(w: number, h: number): string {
  const cx = w / 2
  const cy = h / 2
  const rx = w * 0.45
  const ry = h * 0.45
  const k = 0.5523
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry}`,
    'Z',
  ].join(' ')
}


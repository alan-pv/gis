/**
 * DOM text measurer for the layout engine.
 *
 * Creates an offscreen 2D canvas (lazy singleton) and measures the width of each
 * line with ctx.measureText, using the same font family as SceneCanvas.
 * The word-wrap algorithm is the same as estimateTextSize but with real metrics
 * instead of the fixed-character-width estimate.
 *
 * Falls back to estimateTextSize if the DOM is unavailable (test env / SSR).
 *
 * Only for use in src/canvas/: it accesses the DOM. Do not import from
 * src/scene/ or src/layout/ (pure modules without DOM).
 */
import {
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  ROLE_STYLE,
  estimateTextSize,
  fitTitleFontSize,
} from '@/scene/text-measure.js'
import type { TextMeasurer } from '@/scene/text-measure.js'
import type { Role } from '@/contract/index.js'
import { layoutRuns, stripBold } from '@/scene/text-runs.js'
import type { SegmentMeasure } from '@/scene/text-runs.js'
import { layoutConcept, estimateConceptLayout } from '@/scene/concept-measure.js'
import type { ConceptMeasurer } from '@/scene/concept-measure.js'

import { FONT_FAMILY } from './font.js'

/**
 * Gets a 2D context with the font configured for the given role.
 * Returns null if the DOM is unavailable.
 */
function getCtxForRole(role: Role): CanvasRenderingContext2D | null {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const style = ROLE_STYLE[role]
    // fontStyle bold/normal + fontSize + fontFamily (role-aware)
    ctx.font = `${style.fontStyle} ${style.fontSize}px ${FONT_FAMILY}`
    return ctx
  } catch {
    return null
  }
}

/**
 * DOM measurer: uses ctx.measureText for real widths with the canvas font.
 *
 * Same algorithm as estimateTextSize but measuring with ctx.measureText instead
 * of the fixed-width-per-character estimator.
 *
 * @param text            Text to measure (may contain '\n').
 * @param maxContentWidth Maximum content width (excluding padding).
 * @param role            Semantic role; 'cuerpo' if omitted.
 * @returns               Dimensions of the whole box { width, height } in whole px.
 */
export const domMeasureText: TextMeasurer = (text, maxContentWidth, role, listStart) => {
  const effectiveRole: Role = role ?? 'cuerpo'

  // Title on the left, natural width: a single line, no word-wrap. The
  // fontSize is adjusted with fitTitleFontSize; the box WIDTH is the natural
  // width measured with ctx.measureText at that fontSize, capped at
  // maxContentWidth. Same criterion as estimateTextSize, with real metrics.
  if (effectiveRole === 'titulo') {
    const fittedFontSize = fitTitleFontSize(text, maxContentWidth)
    const height = Math.ceil(fittedFontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
    const singleLine = stripBold(text).split('\n').join(' ')
    const ctx = getCtxForRole('titulo')
    let naturalWidth: number
    if (ctx) {
      ctx.font = `${ROLE_STYLE.titulo.fontStyle} ${fittedFontSize}px ${FONT_FAMILY}`
      naturalWidth = ctx.measureText(singleLine).width
    } else {
      // No DOM: delegate to the pure estimate (same fixed-character model).
      naturalWidth = singleLine.length * fittedFontSize * 0.55
    }
    const contentWidth = Math.min(naturalWidth, maxContentWidth)
    const width = Math.ceil(contentWidth) + 2 * TEXT_PADDING
    return { width, height }
  }

  const style = ROLE_STYLE[effectiveRole]
  const fontSize = style.fontSize

  const ctx = getCtxForRole(effectiveRole)
  if (!ctx) {
    // No DOM: delegate to the pure estimate.
    return estimateTextSize(text, maxContentWidth, effectiveRole, listStart)
  }

  // Same line wrapping as estimateTextSize (layoutRuns, single source), measuring each
  // segment at its real weight: inline `**` bold uses the real 700 weight of Kalam.
  const { lines, maxLineWidth } = layoutRuns(
    text,
    effectiveRole,
    maxContentWidth,
    domSegmentMeasure(ctx, fontSize, style.fontStyle),
    listStart,
  )

  const contentWidth = maxLineWidth === 0 ? 0 : Math.min(maxContentWidth, maxLineWidth)

  const height = Math.ceil(lines.length * fontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
  const width = Math.max(40, Math.ceil(contentWidth) + 2 * TEXT_PADDING)

  return { width, height }
}

/**
 * Segment measurer over a 2D ctx: applies the font of the segment weight
 * (inline bold or bold role) and measures with ctx.measureText.
 */
export function domSegmentMeasure(
  ctx: CanvasRenderingContext2D,
  fontSize: number,
  roleFontStyle: 'normal' | 'bold',
): SegmentMeasure {
  // No cache of the current font: the measuring ctx is SHARED and another measurer may
  // have changed `ctx.font` between two calls; it is always set (the browser caches the parsing).
  return (text, bold) => {
    ctx.font = `${bold || roleFontStyle === 'bold' ? 'bold' : 'normal'} ${fontSize}px ${FONT_FAMILY}`
    return ctx.measureText(text).width
  }
}

let sharedCtx: CanvasRenderingContext2D | null | undefined

/** Shared offscreen 2D ctx for measuring and fitting lines (null without a DOM). */
export function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx !== undefined) return sharedCtx
  try {
    sharedCtx = document.createElement('canvas').getContext('2d')
  } catch {
    sharedCtx = null
  }
  return sharedCtx
}

/**
 * DOM measurer for concepts: a circle with its name inside, with real widths.
 * Without a DOM it falls back to the pure estimate.
 */
export const domMeasureConcept: ConceptMeasurer = (label, cap) => {
  const ctx = getMeasureCtx()
  if (!ctx) return estimateConceptLayout(label, cap)
  return layoutConcept(label, cap, (fontSize) => domSegmentMeasure(ctx, fontSize, 'normal'))
}

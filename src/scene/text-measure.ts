/**
 * Pure text measurement for the scene engine.
 *
 * Pure module: no Konva, no React, no DOM. Deterministic geometric estimate
 * based on fixed character widths.
 *
 * The real DOM measurer (src/canvas/measure-text.ts) uses the same word-wrap
 * algorithm but measures with ctx.measureText for typographic accuracy.
 */
import type { Role } from '@/contract/index.js'
import { layoutRuns, stripBold } from './text-runs.js'
import type { SegmentMeasure } from './text-runs.js'

/**
 * Minimum font size for title auto-fit.
 * If the text does not fit on one line even at 14 px, overflow is accepted; the box
 * is full-width so this almost never happens in real lessons.
 */
export const TITLE_FONT_SIZE_MIN = 14

/**
 * Computes the largest integer fontSize in [TITLE_FONT_SIZE_MIN, 28] such that
 * the title text fits on a single line within maxContentWidth.
 *
 * Algorithm:
 * - Collapses line breaks to spaces to treat the text as a single line.
 * - Uses the same per-character width model as estimateTextSize
 *   (chars * fontSize * 0.55).
 * - Closed-form derivation, then clamp+floor to an integer.
 * - Empty text → returns the maximum fontSize of the titulo role (28).
 * - If it does not fit even at TITLE_FONT_SIZE_MIN, returns 14 (overflow accepted).
 *
 * @param text             Text to measure ('\n' is collapsed to a space).
 * @param maxContentWidth  Maximum content width (excluding padding).
 * @returns                Integer fontSize in [TITLE_FONT_SIZE_MIN, 28].
 */
export function fitTitleFontSize(text: string, maxContentWidth: number): number {
  const singleLine = stripBold(text).split('\n').join(' ')
  if (singleLine.length === 0) return ROLE_STYLE.titulo.fontSize  // 28

  const chars = singleLine.length
  // Largest fontSize such that chars * fontSize * 0.55 <= maxContentWidth
  // => fontSize <= maxContentWidth / (chars * 0.55)
  const raw = maxContentWidth / (chars * CHAR_WIDTH_FACTOR)
  const clamped = Math.min(ROLE_STYLE.titulo.fontSize, raw)
  return Math.max(TITLE_FONT_SIZE_MIN, Math.floor(clamped))
}

/** Relative line spacing (line-height). */
export const TEXT_LINE_HEIGHT = 1.3

/**
 * Slack (px) the renderer adds to Konva's line-wrap width. The box measures
 * `ceil(widest line) + 2*padding`, i.e. exactly the widest line: any sub-pixel
 * difference between `ctx.measureText` and Konva's measurer pushed a word to the
 * next line, and that extra line did not fit in the box height.
 */
export const TEXT_WRAP_SLACK = 4

/** Inner padding of the text box on all sides (logical px). */
export const TEXT_PADDING = 8

/**
 * Style table per role. Single source of truth for fontSize, fontStyle, marker and
 * background eligibility; used both to measure and to render.
 *
 * Field `hasBackground`: if true, the role gets a marker-style background rect behind
 * the text. The concrete color does NOT live here (see `TEXT_BG_COLOR`). Only title
 * and subtitle get a background: body, lists and notes have none.
 */
export const ROLE_STYLE: Record<Role, {
  fontSize: number
  fontStyle: 'normal' | 'bold'
  marker: 'none' | 'bullet' | 'number'
  hasBackground: boolean
}> = {
  titulo:      { fontSize: 28, fontStyle: 'bold',   marker: 'none',   hasBackground: true  },
  subtitulo:   { fontSize: 22, fontStyle: 'bold',   marker: 'none',   hasBackground: true  },
  cuerpo:      { fontSize: 18, fontStyle: 'normal', marker: 'none',   hasBackground: false },
  lista:       { fontSize: 18, fontStyle: 'normal', marker: 'bullet', hasBackground: false },
  enumeracion: { fontSize: 18, fontStyle: 'normal', marker: 'number', hasBackground: false },
}

/**
 * Background color of title/subtitle: a single light, semi-transparent yellow (a varied
 * palette did not blend well). Same muted register as the area backgrounds; moderate
 * opacity so dark text stays legible on top. TUNABLE.
 */
export const TEXT_BG_COLOR = 'rgba(254, 240, 138, 0.55)'

/**
 * Applies list/numbered-list markers to the text according to its role.
 *
 * SINGLE source of marker prefixing: used by both the measurers
 * (estimateTextSize / domMeasureText) and the renderer (SceneCanvas), so that
 * measurement and drawing match exactly.
 *
 * - role 'lista'       → each non-empty line is prefixed with "• ".
 * - role 'enumeracion' → each non-empty line is prefixed with "N. " (1-indexed).
 * - other roles        → text unchanged.
 *
 * Empty lines (paragraph breaks) are kept without a marker.
 */
export function markerizeText(text: string, role: Role | null | undefined, listStart = 1): string {
  const marker = ROLE_STYLE[role ?? 'cuerpo'].marker
  if (marker === 'none') return text
  // `listStart === 0`: a run of a single item → no marker (any marker the model wrote
  // is stripped and the text stays as body).
  const unmarked = listStart === 0
  // Item number (enumeracion role): `listStart` + position of the non-empty line within the
  // object. `listStart` is computed by the app (position among the group's consecutive items);
  // without it, 1.
  let n = listStart
  return text
    .split('\n')
    .map((line) => {
      if (line.length === 0) return line
      // If the model already wrote the marker ("2. ", "- ", "• "), strip it: the app adds its own.
      const bare = marker === 'bullet'
        ? line.replace(/^\s*(?:[-•*]\s+)/, '')
        : line.replace(/^\s*\d+[.)]\s+/, '')
      if (unmarked) return bare
      return marker === 'bullet' ? `• ${bare}` : `${n++}. ${bare}`
    })
    .join('\n')
}

/**
 * Function that measures text and returns the dimensions of the full box
 * (content + 2*TEXT_PADDING), as integers.
 *
 * @param text            Text to measure (may contain '\n').
 * @param maxContentWidth Maximum content width (excluding padding).
 * @param role            Semantic role; 'cuerpo' if omitted.
 * @returns               Dimensions of the full box { width, height } in integer px.
 */
export type TextMeasurer = (text: string, maxContentWidth: number, role?: Role, listStart?: number) => { width: number; height: number }

/** Per-character width factor (× fontSize) of the fixed-width estimator. */
export const CHAR_WIDTH_FACTOR = 0.55
/**
 * Width factor of inline bold (× fontSize). Kalam 700 is about 6 % wider than 400
 * (measured in the .woff: 0.452 vs 0.426 em/char; 0.59/0.55 = 7 % keeps a margin).
 */
export const BOLD_CHAR_WIDTH_FACTOR = 0.59

/**
 * Segment measurer of the pure estimator: fixed width per character, wider for inline
 * bold. If the role is already bold (title/subtitle) everything weighs the same.
 */
export function estimateSegmentMeasure(fontSize: number, roleIsBold: boolean): SegmentMeasure {
  // Width per character first, then × length: keeps rounding stable.
  const normal = fontSize * CHAR_WIDTH_FACTOR
  const heavy = roleIsBold ? normal : fontSize * BOLD_CHAR_WIDTH_FACTOR
  return (text, bold) => text.length * (bold ? heavy : normal)
}

/**
 * Pure estimate of text dimensions (greedy word-wrap, fixed width per character).
 *
 * Algorithm:
 * - Splits on '\n' (explicit line breaks).
 * - For each paragraph: greedy word-wrap estimating width = fontSize * 0.55 per character.
 *   If the role has a marker (list/numbered list), prefixes "• " or "N. " to each line.
 * - contentWidth = min(maxContentWidth, widest line in the content).
 * - height = ceil(lines.length * fontSize * TEXT_LINE_HEIGHT) + 2*TEXT_PADDING.
 * - width = max(40, ceil(contentWidth) + 2*TEXT_PADDING).
 * - Minimums: at least 1 line; minimum width 40.
 * - Deterministic: same input → same output.
 */
export const estimateTextSize: TextMeasurer = (text, maxContentWidth, role, listStart) => {
  // Title is left-aligned at its natural width: a single line, no word-wrap. The fontSize
  // is fitted with fitTitleFontSize, but the box WIDTH is not full-width: it is the natural
  // width of the text on one line at that fontSize (same chars * fontSize * 0.55 model as
  // the rest of this function), capped at maxContentWidth so it does not overflow the band.
  if (role === 'titulo') {
    const fittedFontSize = fitTitleFontSize(text, maxContentWidth)
    const height = Math.ceil(fittedFontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
    const singleLine = stripBold(text).split('\n').join(' ')
    const naturalWidth = singleLine.length * fittedFontSize * CHAR_WIDTH_FACTOR
    const contentWidth = Math.min(naturalWidth, maxContentWidth)
    const width = Math.ceil(contentWidth) + 2 * TEXT_PADDING
    return { width, height }
  }

  const style = ROLE_STYLE[role ?? 'cuerpo']
  const fontSize = style.fontSize

  // Line wrapping with runs (inline `**` bold): the marks are not measured and bold weighs
  // more. List markers are applied inside layoutRuns.
  const { lines, maxLineWidth } = layoutRuns(text, role, maxContentWidth, estimateSegmentMeasure(fontSize, style.fontStyle === 'bold'), listStart)

  // contentWidth: the smaller of the real width and the available maximum.
  // If all lines are empty, maxLineWidth = 0 → contentWidth 0.
  const contentWidth = maxLineWidth === 0 ? 0 : Math.min(maxContentWidth, maxLineWidth)

  const height = Math.ceil(lines.length * fontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
  const width = Math.max(40, Math.ceil(contentWidth) + 2 * TEXT_PADDING)

  return { width, height }
}

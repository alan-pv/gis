/**
 * Text runs with inline bold `**word**` — pure module.
 *
 * SINGLE source of mark parsing and of line wrapping with mixed runs. It is used by
 * measurement (estimateTextSize / domMeasureText), rendering (SceneCanvas), the
 * letter-by-letter animation and the `highlight` word selector, so that what is measured
 * is exactly what is drawn and the `**` never appear on screen.
 *
 * Model: the visible ("plain") text is the text without marks. Each character carries its
 * weight (`bold`) and its index `idx` in that plain text; line breaks and the spaces where
 * a line is cut keep their index (they are not drawn, but they count), so the animation
 * reveals by index.
 *
 * Mark rules: each `**` toggles bold; an unpaired `**` leaves bold open until the end;
 * the markers are never shown.
 */
import type { Role } from '@/contract/index.js'
import { markerizeText } from './text-measure.js'

/** A character of the text stream, with its weight and its index in the plain text. */
export interface RunChar {
  ch: string
  bold: boolean
  idx: number
}

/** Segment of an already wrapped line: consecutive runs of the same weight. */
export interface LineSegment {
  text: string
  bold: boolean
  /** Index (in the plain text) of the segment's first character. */
  start: number
  /** Measured width of the segment at its weight (filled in when the line is closed). */
  width: number
}

/** Wrapped line. `width` is the sum of its segments' widths. */
export interface TextLine {
  segments: LineSegment[]
  width: number
}

/** Measures the width of a fragment at a given weight. */
export type SegmentMeasure = (text: string, bold: boolean) => number

/** Result of line wrapping. */
export interface RunsLayout {
  lines: TextLine[]
  /** Displayed plain text (with list markers, without `**`). `LineSegment.start` indices refer to it. */
  plain: string
  /** Width of the widest line (0 if all are empty). */
  maxLineWidth: number
}

const BOLD_MARK = '**'

/** Splits the text into characters with weight and plain index (`**` produces no characters). */
export function toRunChars(text: string): RunChar[] {
  const out: RunChar[] = []
  let bold = false
  let idx = 0
  for (let i = 0; i < text.length; ) {
    if (text.startsWith(BOLD_MARK, i)) {
      bold = !bold
      i += BOLD_MARK.length
      continue
    }
    out.push({ ch: text[i]!, bold, idx: idx++ })
    i++
  }
  return out
}

/** Text without bold marks. */
export function stripBold(text: string): string {
  return toRunChars(text).map((c) => c.ch).join('')
}

/**
 * Text shown on the board for (marked text, role): list markers applied and no `**`.
 * It is the string over which the animation counts characters.
 */
export function displayText(text: string, role: Role | null | undefined, listStart?: number): string {
  return stripBold(markerizeText(text, role, listStart))
}

/** Segments (runs with a start index) of a line of characters. */
function lineSegments(chars: readonly RunChar[]): LineSegment[] {
  const segs: LineSegment[] = []
  for (const c of chars) {
    const last = segs[segs.length - 1]
    if (last !== undefined && last.bold === c.bold) last.text += c.ch
    else segs.push({ text: c.ch, bold: c.bold, start: c.idx, width: 0 })
  }
  return segs
}

function segmentsWidth(segs: readonly LineSegment[], measure: SegmentMeasure): number {
  let w = 0
  for (const s of segs) w += measure(s.text, s.bold)
  return w
}

/**
 * Greedy word line-wrapping over text with marks.
 *
 * Same algorithm as plain-text measurers (splits on `\n` and on spaces; a word wider than
 * the maximum is left alone on its line), but measuring each segment at its own weight.
 * For text without marks the result is identical to plain wrapping (a single segment per line).
 *
 * @param text      Text with `**` marks; the role's list markers are applied to it.
 * @param role      Role (list/numbered-list markers).
 * @param maxWidth  Maximum content width of a line.
 * @param measure   Segment measurer (per weight).
 * @param listStart Number of the first item of a numbered list; defaults to 1.
 */
export function layoutRuns(
  text: string,
  role: Role | null | undefined,
  maxWidth: number,
  measure: SegmentMeasure,
  listStart?: number,
): RunsLayout {
  const marked = text.length === 0 ? '' : markerizeText(text, role, listStart)
  const stream = toRunChars(marked)
  const plain = stream.map((c) => c.ch).join('')

  // Paragraphs: split on '\n' (the '\n' keeps its index but is not drawn).
  const paragraphs: RunChar[][] = [[]]
  for (const c of stream) {
    if (c.ch === '\n') paragraphs.push([])
    else paragraphs[paragraphs.length - 1]!.push(c)
  }

  const lines: TextLine[] = []
  let maxLineWidth = 0

  const pushLine = (chars: readonly RunChar[]): void => {
    const segments = lineSegments(chars)
    for (const seg of segments) seg.width = measure(seg.text, seg.bold)
    const width = segments.reduce((w, seg) => w + seg.width, 0)
    lines.push({ segments, width })
    if (width > maxLineWidth) maxLineWidth = width
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push({ segments: [], width: 0 })
      continue
    }

    // Words separated by ' ' (empty words included, like split(' ')).
    const words: RunChar[][] = [[]]
    const seps: Array<RunChar | null> = [null]
    for (const c of paragraph) {
      if (c.ch === ' ') {
        words.push([])
        seps.push(c)
      } else {
        words[words.length - 1]!.push(c)
      }
    }

    let current: RunChar[] = []
    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi]!
      const candidate = current.length === 0 ? word : [...current, seps[wi]!, ...word]
      const candidateWidth = segmentsWidth(lineSegments(candidate), measure)
      if (candidateWidth <= maxWidth) {
        current = candidate
      } else {
        if (current.length > 0) pushLine(current)
        current = word
      }
    }
    if (current.length > 0) pushLine(current)
  }

  if (lines.length === 0) lines.push({ segments: [], width: 0 })

  return { lines, plain, maxLineWidth }
}

/**
 * Horizontal range (relative to the start of the line's content) of `word` within the
 * plain text of a layout, measuring with each segment's real weight.
 * Returns the line where the word starts. `undefined` if it does not appear.
 * The `highlight` word selector searches the text WITHOUT marks.
 */
export function wordRangeInLayout(
  layout: RunsLayout,
  word: string,
  measure: SegmentMeasure,
): { line: number; x0: number; x1: number } | undefined {
  const at = layout.plain.indexOf(word)
  if (at < 0 || word.length === 0) return undefined
  const end = at + word.length

  for (let li = 0; li < layout.lines.length; li++) {
    const line = layout.lines[li]!
    let x = 0
    let x0: number | undefined
    let x1 = 0
    for (const seg of line.segments) {
      const segEnd = seg.start + seg.text.length
      if (segEnd > at && seg.start < end) {
        const from = Math.max(at, seg.start) - seg.start
        const to = Math.min(end, segEnd) - seg.start
        const pre = measure(seg.text.slice(0, from), seg.bold)
        const mid = measure(seg.text.slice(from, to), seg.bold)
        if (x0 === undefined) x0 = x + pre
        x1 = x + pre + mid
      }
      x += measure(seg.text, seg.bold)
    }
    if (x0 !== undefined) return { line: li, x0, x1 }
  }
  return undefined
}

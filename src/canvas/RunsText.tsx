/**
 * Text with mixed runs (inline bold `**word**`) as a single Konva node.
 *
 * RENDER DESIGN: a `Shape` with `sceneFunc` instead of several `Text` nodes:
 * - lines come from `layoutRuns` (src/scene/text-runs.ts), the SAME function the
 *   measurement uses, measured with the same 2D ctx, so what is measured is what is
 *   drawn and there is no second line wrapping (Konva.Text's) that could differ;
 * - there is no fixed `height`, so nothing is clipped: the Shape draws all lines and
 *   `box.height` only matters for layout and the background;
 * - it is ONE registrable node: the letter-by-letter animation reveals by character index
 *   of the plain text (`revealChars` attribute), so neither the `**` nor the line
 *   wrapping change while typing (with Konva.Text words jumped between lines);
 * - bold comes from `bold` (= the 700 weight of Kalam), like in titles.
 */
import { Shape } from 'react-konva'
import type Konva from 'konva'
import type { TextLine } from '@/scene/text-runs.js'
import { TEXT_LINE_HEIGHT, TEXT_PADDING } from '@/scene/text-measure.js'
import { FONT_FAMILY } from './font.js'
import { REVEAL_ATTR } from './runs-layout.js'

interface RunsTextProps {
  lines: TextLine[]
  fontSize: number
  /** If true, all the text is bold (title/subtitle role). */
  roleBold: boolean
  color: string
  /** Offset of the content within the node. */
  padX?: number
  padY?: number
  /** If given, each line is centered in this width (concepts); otherwise left-aligned. */
  centerWidth?: number
  /** Height over which the block is vertically centered (concepts). */
  centerHeight?: number
  opacity: number
  nodeRef?: (node: Konva.Shape | null) => void
}

/** Fallback value if the context gives no real metrics (e.g. jsdom): Kalam ≈ 0.74. */
const CAP_RATIO_FALLBACK = 0.74

/**
 * Capital-letter height / font size, measured with the drawing context (the font is already set on `context`; uncached, in case the font loads late).
 *
 * Vertical centering: `textBaseline='middle'` puts the baseline at (ascent-descent)/2 from the
 * center. In Kalam (ascent 1.063 em, descent 0.531 em) that is 0.266 em, while the optical
 * center of the text (capitals/ascenders) is at capHeight/2 ≈ 0.37 em above the baseline: the text
 * sat ~0.10 em (2-3 px in a title) above the center. It is drawn with an 'alphabetic' baseline
 * at `center + capHeight/2`, with the measured (not assumed) capital height.
 */
function capRatio(context: { measureText(t: string): { actualBoundingBoxAscent?: number } }, fontSize: number): number {
  const asc = context.measureText('H').actualBoundingBoxAscent
  return typeof asc === 'number' && asc > 0 && fontSize > 0 ? asc / fontSize : CAP_RATIO_FALLBACK
}

/** Text with runs: a single node, see the header comment. */
export function RunsText({
  lines, fontSize, roleBold, color, padX = TEXT_PADDING, padY = TEXT_PADDING,
  centerWidth, centerHeight, opacity, nodeRef,
}: RunsTextProps) {
  const lineH = fontSize * TEXT_LINE_HEIGHT
  return (
    <Shape
      ref={nodeRef}
      runsText={true}
      opacity={opacity}
      listening={false}
      sceneFunc={(context, shape) => {
        const reveal = (shape.getAttr(REVEAL_ATTR) as number | undefined) ?? Infinity
        context.setAttr('textBaseline', 'alphabetic')
        context.setAttr('textAlign', 'left')
        context.setAttr('fillStyle', color)
        const top = centerHeight !== undefined ? (centerHeight - lines.length * lineH) / 2 : padY
        // The x advance is measured with the drawing context itself and the segment font:
        // the render does not depend on widths measured at another time (or on a shared ctx).
        const fontOf = (bold: boolean): string => `${bold || roleBold ? 'bold' : 'normal'} ${fontSize}px ${FONT_FAMILY}`
        const widthOf = (text: string, bold: boolean): number => {
          context.setAttr('font', fontOf(bold))
          return context.measureText(text).width
        }
        context.setAttr('font', fontOf(false))
        const baselineShift = (capRatio(context, fontSize) * fontSize) / 2
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]!
          const widths = line.segments.map((seg) => widthOf(seg.text, seg.bold))
          const lineWidth = widths.reduce((a, w) => a + w, 0)
          let x = centerWidth !== undefined ? (centerWidth - lineWidth) / 2 : padX
          const y = top + li * lineH + lineH / 2 + baselineShift
          for (let si = 0; si < line.segments.length; si++) {
            const seg = line.segments[si]!
            const visible = Math.min(seg.text.length, reveal - seg.start)
            if (visible <= 0) return // indices grow: nothing else is visible
            context.setAttr('font', fontOf(seg.bold))
            context.fillText(visible >= seg.text.length ? seg.text : seg.text.slice(0, visible), x, y)
            x += widths[si]!
          }
        }
      }}
    />
  )
}

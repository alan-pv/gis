/**
 * Geometry of the highlight gesture: a pure function, no Konva or DOM.
 *
 * Generates the SVG path of the chosen gesture (underline, ellipse, arrow)
 * from the bounding box of the referent and, optionally, the horizontal
 * range of a single word (word selector).
 */
import { TEXT_PADDING } from '@/scene/text-measure.js'
import { EMPHASIS_COLOR } from './board-colors.js'

/** Stroke color of the highlight: the board's emphasis red. */
export const HIGHLIGHT_COLOR = EMPHASIS_COLOR

/** Stroke width of the highlight in logical pixels. */
export const HIGHLIGHT_STROKE_WIDTH = 2.5

/** Control factor of the bezier approximation of the ellipse. */
const BEZIER_K = 0.5523

/** FIXED margin of the ellipse around the referent bbox (px). */
export const ELLIPSE_PAD = 10

/** Minimum gap (px) between the ellipse and the board edge when it is clamped. */
export const BOUNDS_INSET = 4

interface Rect { x: number; y: number; width: number; height: number }

/**
 * Computes the SVG path of the highlight gesture.
 *
 * @param box        Bounding box of the referent in page space (logical px).
 * @param gesture    Gesture type chosen by the app.
 * @param wordRange  Optional horizontal range for the word selector (x0, x1).
 *                   If omitted, the full bbox width is used.
 * @param bounds     Board limits (optional): the ellipse never exceeds them
 *                   (it is shortened and/or shifted inwards).
 * @returns          SVG path string ready to render or to pass to roughenPath.
 */
export function highlightPath(
  box: { x: number; y: number; width: number; height: number },
  gesture: 'underline' | 'ellipse' | 'arrow',
  wordRange?: { x0: number; x1: number },
  bounds?: Rect,
): string {
  // Horizontal range: the word or the whole bbox
  const x0 = wordRange?.x0 ?? box.x
  const x1 = wordRange?.x1 ?? (box.x + box.width)

  switch (gesture) {
    case 'underline': {
      // box.height includes TEXT_PADDING (8px) below the glyph + line spacing.
      // TEXT_PADDING is subtracted and only 2px added so the line sits
      // right under the glyph instead of floating ~12-16px below it.
      const y = box.y + box.height - TEXT_PADDING + 2
      return `M ${x0} ${y} L ${x1} ${y}`
    }

    case 'ellipse': {
      // Enclosing ellipse slightly larger than the horizontal range,
      // fitted to the bbox with a fixed margin; with `bounds`, kept inside the board.
      let cx = (x0 + x1) / 2
      let cy = box.y + box.height / 2
      let rx = (x1 - x0) / 2 + ELLIPSE_PAD
      let ry = box.height / 2 + ELLIPSE_PAD
      if (bounds) {
        rx = Math.max(1, Math.min(rx, bounds.width / 2 - BOUNDS_INSET))
        ry = Math.max(1, Math.min(ry, bounds.height / 2 - BOUNDS_INSET))
        cx = Math.min(Math.max(cx, bounds.x + BOUNDS_INSET + rx), bounds.x + bounds.width - BOUNDS_INSET - rx)
        cy = Math.min(Math.max(cy, bounds.y + BOUNDS_INSET + ry), bounds.y + bounds.height - BOUNDS_INSET - ry)
      }
      const kx = rx * BEZIER_K
      const ky = ry * BEZIER_K
      return [
        `M ${cx} ${cy - ry}`,
        `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
        `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
        `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
        `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
        'Z',
      ].join(' ')
    }

    case 'arrow': {
      // Short arrow pointing at the object from the upper-left side.
      // The tip lands ~8px outside the top edge of the horizontal range.
      const tipX = x0 - 8
      const tipY = box.y - 8
      const wordWidth = x1 - x0
      const tailLen = Math.min(40, Math.max(20, wordWidth * 0.25))
      const tailX = tipX - tailLen * 0.7
      const tailY = tipY - tailLen * 0.7
      // Arrowhead (two ~10px strokes at ±45° from the tip)
      const hw = 10
      const arrowL1x = tipX + hw * Math.cos(Math.PI * 0.25)   // +45°
      const arrowL1y = tipY + hw * Math.sin(Math.PI * 0.25)
      const arrowL2x = tipX + hw * Math.cos(Math.PI * 0.75)   // +135°
      const arrowL2y = tipY + hw * Math.sin(Math.PI * 0.75)
      return [
        // Arrow shaft
        `M ${tailX} ${tailY} L ${tipX} ${tipY}`,
        // Left head
        `M ${tipX} ${tipY} L ${arrowL1x} ${arrowL1y}`,
        // Right head
        `M ${tipX} ${tipY} L ${arrowL2x} ${arrowL2y}`,
      ].join(' ')
    }
  }
}

/**
 * Size of library figures: each figure is fitted into one standard square box
 * so that figures drawn next to each other look equally sized.
 */
import type { ObjectMeta } from './meta.js'

/**
 * Side (logical px) of the standard fitting box. The LONGER side of a figure
 * becomes exactly this long; the shorter side scales by the same factor, so a
 * figure is never distorted.
 */
export const STANDARD_FIGURE_BOX = 120

/** Fits a figure's `default_size` into the standard box, preserving its proportion. */
export function normalizedFigureSize(
  meta: ObjectMeta,
): { width: number; height: number } {
  const { width, height } = meta.default_size
  const factor = STANDARD_FIGURE_BOX / Math.max(width, height)
  return {
    width:  Math.round(width  * factor),
    height: Math.round(height * factor),
  }
}

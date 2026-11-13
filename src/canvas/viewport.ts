/**
 * viewport.ts — pure math of the canvas viewport.
 *
 * The board is FIXED: there is no manual pan or zoom. The view is always derived
 * from the window size with `fitViewport` (scale to fit + centering).
 * No Konva or React imports. The Viewport is derived UI state: it never enters
 * the reducer or the document.
 */

/** 2D point (logical canvas or screen coords, depending on context). */
export interface Point { x: number; y: number }

/** View state of the Stage: scale and offset in screen px. */
export interface Viewport { scale: number; x: number; y: number }

/** Identity view: no scale or offset. */
export const IDENTITY_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 }

/** Minimum margin (screen px) between the board and the edge of the available area. */
export const FIT_MARGIN = 24

/**
 * Fits the logical canvas (`canvas`) into the available area (`area`) keeping its
 * aspect ratio, centered: equal left/right and top/bottom margins, and at least
 * `margin` px on each side. If the area is degenerate it returns the identity.
 */
export function fitViewport(
  area: { width: number; height: number },
  canvas: { width: number; height: number },
  margin: number = FIT_MARGIN,
): Viewport {
  if (area.width <= 0 || area.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return { ...IDENTITY_VIEWPORT }
  }
  const availW = Math.max(1, area.width - 2 * margin)
  const availH = Math.max(1, area.height - 2 * margin)
  const scale = Math.min(availW / canvas.width, availH / canvas.height)
  return {
    scale,
    x: (area.width - canvas.width * scale) / 2,
    y: (area.height - canvas.height * scale) / 2,
  }
}

/** Converts a logical canvas point to screen coordinates (absolute px). */
export function canvasToScreen(p: Point, vp: Viewport): Point {
  return { x: p.x * vp.scale + vp.x, y: p.y * vp.scale + vp.y }
}

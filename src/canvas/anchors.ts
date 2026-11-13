/**
 * Shared geometry types for connection anchors (pure module, no Konva or DOM).
 */

/** Side of a box a connection can attach to. */
export type Anchor = 'top' | 'bottom' | 'left' | 'right'

export interface Point {
  x: number
  y: number
}

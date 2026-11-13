/** Visual constants shared by the Konva board components. */
import { ROLE_STYLE } from '@/scene/text-measure.js'
import { INK_COLOR } from './board-colors.js'

// ── Style constants ───────────────────────────────────────────────────────────

export const STROKE_COLOR = INK_COLOR
export const STROKE_WIDTH = 3
export const LABEL_FONT_SIZE = 14
export const LABEL_OFFSET = 6

// ── Automatic date constants ────────────────────────────────────────────────
//
// The date is NOT a contract or scene object: it is app chrome, painted in the
// title band, on the right, with the same yellow background as the title
// (TEXT_BG_COLOR) so they read as siblings.

/** fontSize of the date (logical px): same as 'subtitulo', legible and proportional to the title. */
export const DATE_FONT_SIZE = ROLE_STYLE.subtitulo.fontSize

/** Width (px) of the captured Stage thumbnail (2x the 132 px card). */
export const SNAPSHOT_WIDTH = 264
/** Quiet time without changes before capturing the thumbnail (effectively a throttle). */
export const SNAPSHOT_DEBOUNCE_MS = 800

// ── Area divider constants ───────────────────────────────────────────────────

/**
 * Thickness of the draggable divider handle (px, in logical canvas coords).
 * The handle is a Rect centered on the dividing line: total thickness = 8 px.
 */
export const DIVIDER_HANDLE_THICKNESS = 10
/** Handle at rest: invisible (the dotted line marks the divider) but draggable. */
export const DIVIDER_HANDLE_COLOR = 'transparent'
/** Handle on hover: a faint dark-blue accent as a drag affordance. */
export const DIVIDER_HANDLE_HOVER_COLOR = 'rgba(30, 58, 138, 0.18)'

/** Color of the visible dividing line between areas: solid, light gray. */
export const DIVIDER_LINE_COLOR = '#d1d5db'

// ── Selection constants ───────────────────────────────────────────────────────

/** Color of the outline and anchors of the selected object. */
export const SELECTION_COLOR = '#2563eb'
/** Padding of the selection rectangle around the object box (px). */
export const SELECTION_PAD = 4

// ── Double-click detection constants ──────────────────────────────────────────

/** Time window in ms for two pointerdown events to count as a double-click. */
export const DOUBLE_TAP_MS = 350
/** Spatial tolerance in px between the two pointerdown events of a double-click. */
export const DOUBLE_TAP_DIST = 8

/** Visual size and hit radius of the resize handles (px). */
export const RESIZE_HANDLE_SIZE = 8

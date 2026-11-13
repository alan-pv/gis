/**
 * Animation constants: an organic, hand-written feel.
 *
 * Pen speed, micro-pauses, letter-by-letter text.
 * All values are in milliseconds except PEN_SPEED_PX_PER_S.
 */

/** Pen speed in logical pixels per second. */
export const PEN_SPEED_PX_PER_S = 450

/** Minimum duration of a stroke (ms). */
export const STROKE_MIN_MS = 200

/** Maximum duration of a stroke (ms). */
export const STROKE_MAX_MS = 2000

/** Milliseconds per letter in type_text. */
export const LETTER_MS = 45

/** Micro-pause between paths of the same object (ms). */
export const PATH_PAUSE_MS = 80

/** Micro-pause between different objects/events (ms). */
export const MICRO_PAUSE_MS = 180

/** Duration of the highlight gesture stroke (ms). */
export const PULSE_MS = 450

/** Duration of fade_out (ms). */
export const FADE_MS = 250

/** Duration of the move animation (ms). */
export const MOVE_MS = 400

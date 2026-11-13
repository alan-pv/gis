/**
 * Public API of the $P figure recognition module.
 *
 * Re-exports the types, the recognition function, the default threshold
 * and the template-building and normalization utilities.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type { CloudPoint, RecognizerTemplate } from './types.js'

// ── Recognizer ────────────────────────────────────────────────────────────────
export { recognize, DEFAULT_THRESHOLD } from './pdollar.js'

// ── Templates ─────────────────────────────────────────────────────────────────
export { buildTemplatesFromLibrary } from './templates.js'

// ── Normalization (exposed for tests) ─────────────────────────────────────────
export { normalize, N_POINTS, resample } from './normalize.js'

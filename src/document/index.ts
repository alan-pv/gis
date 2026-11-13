/**
 * Multi-page document module: public API.
 *
 * Re-exports everything the UI and tests need to use the document model
 * without importing internal modules. No Konva, React or DOM: fully testable headless.
 */

// ── Model ──────────────────────────────────────────────────────────────────────
export type { GisDocument } from './model.js'
export {
  newDocument,
  addPage,
  removePage,
  setActivePage,
  activePage,
  activeScene,
  activeInk,
  updateActiveInk,
} from './model.js'

// ── Applier ────────────────────────────────────────────────────────────────────
export { applyToActivePage } from './apply.js'

// ── Agent state ────────────────────────────────────────────────────────────────
export { documentToAgentState } from './agent-state.js'


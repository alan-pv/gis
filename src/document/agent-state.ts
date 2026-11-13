/**
 * Agent state at document level.
 *
 * Thin layer over sceneToAgentState: hands only the active page to the agent
 * (the viewport is the agent's context; the agent never manages pages).
 */
import type { CanvasState } from '@/contract/index.js'
import { sceneToAgentState } from '@/scene/index.js'
import type { GisDocument } from './model.js'
import { activeScene } from './model.js'

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds the contract CanvasState from the active page of the document.
 *
 * @param doc                Current document.
 * @param canvas             Canvas dimensions.
 * @param recentUtterances   Sliding window of the teacher's phrases. It is global
 *                           to the document (it follows the teacher in time, not
 *                           the page) and lives in the app state; the caller
 *                           passes it in, this module does not manage it.
 * @returns                  A CanvasState that parses against CanvasStateSchema.
 */
export function documentToAgentState(
  doc: GisDocument,
  canvas: { width: number; height: number },
  recentUtterances: string[],
): CanvasState {
  // Only the active page is visible to the agent
  return sceneToAgentState(activeScene(doc), canvas, recentUtterances)
}

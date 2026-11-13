/**
 * Scene engine — public API: the scene model, the operation applier, the agent
 * state, the global reflow and the hit-test / cascade-delete helpers.
 */

// ── Model ────────────────────────────────────────────────────────────────────
export type { SceneObject, SceneConnection, Scene } from './model.js'
export { emptyScene, allIds, groupBBox } from './model.js'

// ── Applier ──────────────────────────────────────────────────────────────────
export type { SceneEnv, SceneEvent } from './apply.js'
export { applyOperations } from './apply.js'

// ── State for the agent ──────────────────────────────────────────────────────
export { sceneToAgentState } from './agent-state.js'

// ── Hit-test and cascade delete ──────────────────────────────────────────────
export { removeObjectCascade, objectAtBoxPoint } from './promoted-hit.js'

// ── Difference between scenes ────────────────────────────────────────────────
export { diffAddedObjects } from './diff.js'

// ── Global reflow ────────────────────────────────────────────────────────────
export { reflowScene } from './reflow.js'

// ── Text and concept measurement ─────────────────────────────────────────────
export type { TextMeasurer } from './text-measure.js'
export type { ConceptMeasurer } from './concept-measure.js'

/**
 * Serialization of the scene state for the interpreter agent.
 *
 * Converts an internal Scene into the contract's CanvasState:
 * - each object → id, object, label (no position: the app owns geometry).
 * - `texto` objects add `role` (effective; 'cuerpo' if none).
 * - Connections are serialized with their contract fields.
 * - Groups are included if they have at least one member.
 * - recent_utterances from the caller is added.
 *
 * The result MUST parse against CanvasStateSchema (Zod).
 */
import type { CanvasObject, CanvasState } from '@/contract/index.js'
import { SCHEMA_VERSION } from '@/contract/index.js'
import type { Scene } from './model.js'

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds the contract's CanvasState from the internal scene.
 *
 * @param scene              Current scene.
 * @param _canvas            Canvas dimensions (ignored: the state carries no position).
 * @param recentUtterances   Sliding window of the teacher's phrases.
 * @returns                  CanvasState that parses against CanvasStateSchema.
 */
export function sceneToAgentState(
  scene: Scene,
  _canvas: { width: number; height: number },
  recentUtterances: string[],
): CanvasState {
  // Objects: id + object + label.
  // For "texto" objects, label exposes the content (text ?? label) because the
  // state has no text field: the agent reads by label and writes via set.text.
  // `texto` objects expose a read-only `role` (effective role: 'cuerpo' when no
  // explicit role). Other objects carry no role.
  const objects: CanvasObject[] = Array.from(scene.objects.values()).map((obj) => {
    if (obj.object === 'texto') {
      return {
        id: obj.id,
        object: obj.object,
        label: obj.text ?? obj.label,
        role: obj.role ?? 'cuerpo',
      }
    }
    return { id: obj.id, object: obj.object, label: obj.label }
  })

  // Connections: id + from + to + style + label
  const connections = Array.from(scene.connections.values()).map((conn) => ({
    id: conn.id,
    from: conn.from,
    to: conn.to,
    style: conn.style,
    label: conn.label,
  }))

  // Groups: only those with at least 1 member (the schema requires min(1))
  const groups = Array.from(scene.groups.values())
    .filter((grp) => grp.members.length > 0)
    .map((grp) => ({
      id: grp.id,
      label: grp.label,
      members: grp.members,
    }))

  return {
    schema_version: SCHEMA_VERSION,
    objects,
    connections,
    groups,
    recent_utterances: recentUtterances,
  }
}

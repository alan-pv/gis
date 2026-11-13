/**
 * Bridge from scene to the bansho layout engine inputs.
 *
 * Extracts from an already resolved `Scene` the `BoardItem[]` (in arrival order =
 * insertion order of the `scene.objects` Map) and the dimensions by id, which are
 * the input of `planBoard` + `layoutPlan`. Scene layer: may import layout-engine types.
 *
 * Computes no geometry: it only translates. Deterministic. No Konva/React/DOM.
 */
import type { BoardItem, Size } from '@/layout/index.js'
import type { Scene } from './model.js'

/**
 * Builds the layout engine inputs from a final scene.
 *
 * - `items`: one `BoardItem` per object, in insertion order of the objects Map
 *   (= arrival order). `isText = obj.object === 'texto'`; `group` = id of the
 *   first group whose `members` include the object id, or null.
 * - `dimsById`: width/height of each object's resolved box.
 *
 * @param scene  Scene with already resolved boxes.
 * @returns      `items` (arrival order) and `dimsById`.
 */
export function boardInputsFromScene(scene: Scene): {
  items: BoardItem[]
  dimsById: Map<string, Size>
} {
  const items: BoardItem[] = []
  const dimsById = new Map<string, Size>()

  for (const [id, obj] of scene.objects) {
    let group: string | null = null
    for (const [groupId, sceneGroup] of scene.groups) {
      if (sceneGroup.members.includes(id)) {
        group = groupId
        break
      }
    }
    // Include role so planBoard can route titles.
    items.push({
      id,
      isText: obj.object === 'texto',
      group,
      role: obj.role,
      ...(obj.object === 'concepto' ? { isConcept: true } : {}),
      // Layout attachment of loose figures connected in their batch.
      ...(obj.layoutAttach !== undefined ? { attachGroup: obj.layoutAttach } : {}),
      ...(obj.layoutNear !== undefined ? { nearId: obj.layoutNear } : {}),
    })
    dimsById.set(id, { width: obj.box.width, height: obj.box.height })
  }

  return { items, dimsById }
}

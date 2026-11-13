/**
 * Hit-test and cascading-delete utilities for promoted objects.
 *
 * - objectAtBoxPoint: hit-test against object bounding boxes.
 * - removeObjectCascade: removes an object from the scene along with its
 *   connections, and takes it out of its groups (an emptied group is deleted).
 *   Reusable from apply.ts and from the ERASE_PROMOTED reducer.
 *
 * Pure functions: they do not mutate the input scene.
 */
import type { Scene, SceneObject } from './model.js'

/**
 * Removes an object from the scene with a full cascade:
 *   1. Removes connections whose from or to point at the object.
 *   2. Takes the object out of every group it belongs to;
 *      an emptied group is deleted as well.
 *   3. Removes the object itself.
 *
 * If the id is not an object in the scene, returns the scene unchanged.
 * Pure function: returns a new scene without mutating the input.
 *
 * @param scene  Current scene (not modified).
 * @param id     Id of the object to remove.
 * @returns      New scene after the removal.
 */
export function removeObjectCascade(scene: Scene, id: string): Scene {
  if (!scene.objects.has(id)) return scene

  // Clone the working Maps (same pattern as applyOperations)
  const objects = new Map(scene.objects)
  const connections = new Map(scene.connections)
  const groups = new Map(scene.groups)
  const highlights = new Map(scene.highlights)

  // 1) Cascade connections
  for (const [connId, conn] of connections) {
    if (conn.from === id || conn.to === id) {
      connections.delete(connId)
    }
  }

  // 2) Leave groups; an empty group is deleted
  for (const [groupId, grp] of groups) {
    if (grp.members.includes(id)) {
      const remaining = grp.members.filter((m) => m !== id)
      if (remaining.length === 0) {
        groups.delete(groupId)
      } else {
        groups.set(groupId, { ...grp, members: remaining })
      }
    }
  }

  // 3) Cascade highlights (deleting or erasing an object removes its highlights)
  for (const [hid, h] of highlights) {
    if (h.ref === id) {
      highlights.delete(hid)
    }
  }

  // 4) Remove the object
  objects.delete(id)

  return { objects, connections, groups, highlights }
}

// ── objectAtBoxPoint ──────────────────────────────────────────────────────────
/**
 * Hit-test against the bounding box of ALL scene objects (not only promoted
 * ones). Walks in reverse insertion order (the last inserted is "on top") and
 * returns the first object whose box contains the point. The selectable/draggable
 * area is the box, not the stroke.
 *
 * @param scene  Active scene.
 * @param x,y    Point in page space (px).
 */
export function objectAtBoxPoint(scene: Scene, x: number, y: number): SceneObject | undefined {
  const all = Array.from(scene.objects.values())
  for (let i = all.length - 1; i >= 0; i--) {
    const obj = all[i]!
    const { box } = obj
    if (
      x >= box.x && x <= box.x + box.width &&
      y >= box.y && y <= box.y + box.height
    ) {
      return obj
    }
  }
  return undefined
}

/**
 * diff.ts — scene comparison utilities.
 *
 * Pure module: no DOM, no React, no Konva.
 *
 * Used to detect objects newly created by a manual insertion (double-click →
 * text box) so they can be repositioned at the exact point the teacher
 * double-clicked, via a later `objectMoved` (like dragging the object),
 * without touching the contract.
 */
import type { Scene } from './model.js'
import type { BBox } from '@/layout/index.js'

/**
 * Returns the objects present in `next.objects` that were NOT in
 * `prev.objects`, as `{ id, box }[]`.
 *
 * Useful to detect objects inserted by a single `add` operation and
 * reposition them immediately without altering the contract (which stays pixel-free).
 */
export function diffAddedObjects(prev: Scene, next: Scene): { id: string; box: BBox }[] {
  const result: { id: string; box: BBox }[] = []
  for (const [id, obj] of next.objects) {
    if (!prev.objects.has(id)) {
      result.push({ id, box: obj.box })
    }
  }
  return result
}

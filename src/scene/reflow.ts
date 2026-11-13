/**
 * Global reflow of the board (slide mode).
 *
 * In LIVE mode the engine never moves an already placed object (stable top-pack). In
 * SLIDE mode the same stable top-down packing is used (no vertical justification nor
 * centering): the board regions are re-derived from the final scene and all boxes are
 * re-placed with the same top-pack geometry. Objects start at the top and move down as
 * they arrive; if they do not fit they wrap to the next column WITHOUT relocating what
 * is already placed.
 *
 * Scene layer: may import layout-engine types. Pure function: returns a NEW scene
 * with the boxes re-placed, without mutating the input.
 */
import { planBoard, layoutPlan } from '@/layout/index.js'
import type { Canvas, Size, AreaTree } from '@/layout/index.js'
import { defaultAreaTree } from '@/layout/index.js'
import { estimateTextSize } from './text-measure.js'
import { estimateConceptLayout } from './concept-measure.js'
import { flagOpenQuestion } from './open-question.js'
import { boardInputsFromScene } from './board-inputs.js'
import type { Scene, SceneObject } from './model.js'
import { computeListStarts } from './list-numbering.js'
import { splitLineInfo, withPlacement, withListStart } from './layout-support.js'
import type { TextFragment } from '@/layout/index.js'

/**
 * Global top-down reflow of a scene (slide mode). Returns a new scene with the
 * boxes re-placed (does not mutate).
 *
 * Uses the measurement callback `measure(id, contentWidth)` instead of precomputed
 * `dimsById`, so each text is re-measured at the real width of the area where it
 * lands (`layoutPlan` defaults to `defaultAreaTree(3)`).
 *
 * - Re-derives the board inputs (`boardInputsFromScene`) → `planBoard` →
 *   `layoutPlan(...)` with top-down packing by default (no `justify`).
 * - Keeps connections and groups intact.
 * - Each object receives its new box from the reflow; if an object does not appear
 *   in the reflow (defensive), it keeps its current `box`.
 *
 * @param scene     Scene with already resolved boxes (not mutated).
 * @param canvas    Logical canvas space.
 * @param areaTree  Partition tree of the body. If omitted, uses defaultAreaTree(3).
 * @returns         New scene with the boxes re-placed (stable top-pack).
 */
export function reflowScene(scene: Scene, canvas: Canvas, areaTree?: AreaTree): Scene {
  const { items } = boardInputsFromScene(scene)
  // The hidden open question does not enter the plan.
  const plan = planBoard(flagOpenQuestion(items, (id) => scene.objects.get(id)?.text ?? scene.objects.get(id)?.label))
  // The app numbers the numbered lists before measuring.
  const starts = computeListStarts(plan, (id) => scene.objects.get(id)?.role, (id) => scene.objects.get(id)?.text ?? scene.objects.get(id)?.label ?? '')
  const numbered = new Map<string, SceneObject>()
  for (const [id, obj] of scene.objects) numbered.set(id, withListStart(obj, starts.get(id)))

  // Measurement callback: re-measures texts at the width of the area where they land.
  // For non-text, returns the dims stored in the box (ignoring contentWidth).
  const measureFn = (id: string, contentWidth: number): Size => {
    const obj = numbered.get(id)
    if (!obj) return { width: 0, height: 0 }
    if (obj.object === 'texto') {
      return estimateTextSize(
        obj.text ?? obj.label ?? '',
        contentWidth,
        obj.role ?? 'cuerpo',
        obj.listStart,
      )
    }
    if (obj.object === 'concepto') {
      const d = estimateConceptLayout(obj.label ?? '', contentWidth).diameter
      return { width: d, height: d }
    }
    return { width: obj.box.width, height: obj.box.height }
  }

  // The received areaTree is passed through (it comes from the active page).
  // Falls back to defaultAreaTree(3) if not injected.
  // Sticky state of widened groups (kept in the returned scene).
  const wide = new Set<string>()
  for (const [gid, g] of scene.groups) if (g.wide === true) wide.add(gid)
  const fragments = new Map<string, TextFragment[]>()
  const lineInfo = (id: string) => splitLineInfo(scene.objects.get(id)?.object === 'texto', scene.objects.get(id)?.role)
  const placed = layoutPlan(plan, measureFn, canvas, areaTree ?? defaultAreaTree(3), { wideGroups: wide, lineInfo, fragments })
  const groups = new Map(scene.groups)
  for (const gid of wide) {
    const g = groups.get(gid)
    if (g !== undefined && g.wide !== true) groups.set(gid, { ...g, wide: true })
  }

  const objects = new Map<string, SceneObject>()
  for (const [id, obj] of numbered) {
    objects.set(id, withPlacement(obj, placed.get(id), fragments))
  }

  return {
    objects,
    connections: new Map(scene.connections),
    groups,
    highlights: new Map(scene.highlights),
  }
}

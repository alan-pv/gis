/**
 * Numbering of numbered lists by the app — pure.
 *
 * The model only says "this is an item" (`role: 'enumeracion'`); the app supplies the number.
 * An item's number is its position among the CONSECUTIVE `enumeracion` items of the same plan
 * block (a group, or a run of loose text), in arrival order. A run is broken by any member with
 * another role (or a figure). A multi-line object numbers its lines consecutively from its
 * position: the next item continues after the last numbered line (so numbers never repeat; with
 * one line per item it equals the position).
 *
 * Single source: measurement, rendering, animation and the highlight word selector all use it
 * through `SceneObject.listStart` (absent = 1).
 */
import type { Role } from '@/contract/index.js'
import type { BoardPlan } from '@/layout/index.js'
import { stripBold } from './text-runs.js'

/** Lines of a text that receive a number (empty lines, i.e. paragraph breaks, do not). */
export function numberedLineCount(text: string): number {
  return text.split('\n').filter((l) => stripBold(l).trim().length > 0).length
}

/** `listStart` value meaning "no marker" (a run of a single item/line). */
export const NO_MARKER = 0

/**
 * Starting number of each `enumeracion` item of the plan, plus `NO_MARKER` (0) for
 * `enumeracion`/`lista` items whose run has ONE line in total: a list is only marked when it
 * has more than one item. The run for that decision is formed by the consecutive `enumeracion`
 * or `lista` items of the same block. When the second item arrives the first goes from 0 to 1
 * (it gains its marker; its displayed text changes). `roleOf` / `textOf` query the scene (or the new op).
 */
export function computeListStarts(
  plan: BoardPlan,
  roleOf: (id: string) => Role | null | undefined,
  textOf: (id: string) => string,
): Map<string, number> {
  const starts = new Map<string, number>()
  const isItem = (id: string): boolean => {
    const r = roleOf(id)
    return r === 'enumeracion' || r === 'lista'
  }
  const run = (ids: readonly string[]): void => {
    // Run of items (enumeracion or lista) with a single line in total → no marker.
    let i = 0
    while (i < ids.length) {
      if (!isItem(ids[i]!)) { i++; continue }
      let j = i
      let lines = 0
      while (j < ids.length && isItem(ids[j]!)) {
        lines += Math.max(1, numberedLineCount(textOf(ids[j]!)))
        j++
      }
      if (lines === 1) starts.set(ids[i]!, NO_MARKER)
      i = j
    }
    let counter = 0
    for (const id of ids) {
      if (roleOf(id) === 'enumeracion') {
        if (starts.get(id) === NO_MARKER) { counter = 0; continue }
        starts.set(id, counter + 1)
        counter += Math.max(1, numberedLineCount(textOf(id)))
      } else {
        counter = 0
      }
    }
  }
  run(plan.opening)
  for (const b of plan.blocks) run(b.members)
  return starts
}

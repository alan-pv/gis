/**
 * Scene-layer support for layout: which text objects may be split by lines across columns,
 * and how the box, fragments and starting list number computed by the engine are applied to an object.
 */
import type { Role } from '@/contract/index.js'
import type { BBox, TextFragment } from '@/layout/index.js'
import type { SceneObject } from './model.js'
import { ROLE_STYLE, TEXT_LINE_HEIGHT, TEXT_PADDING } from './text-measure.js'

/**
 * Line data for an object that may be split across columns: paragraph, list or numbered-list
 * text. Titles, subtitles, figures and concepts are never split (`null`).
 */
export function splitLineInfo(
  isText: boolean,
  role: Role | null | undefined,
): { lineHeight: number; padding: number } | null {
  if (!isText) return null
  const r = role ?? 'cuerpo'
  if (r !== 'cuerpo' && r !== 'lista' && r !== 'enumeracion') return null
  return { lineHeight: ROLE_STYLE[r].fontSize * TEXT_LINE_HEIGHT, padding: TEXT_PADDING }
}

/** Object with its new box and fragments (old fragments are cleared if it is no longer split). */
export function withPlacement(
  obj: SceneObject,
  box: BBox | undefined,
  fragments: ReadonlyMap<string, TextFragment[]>,
): SceneObject {
  if (box === undefined) return obj
  const { fragments: _old, ...rest } = obj
  const frs = fragments.get(obj.id)
  return frs !== undefined ? { ...rest, box, fragments: frs } : { ...rest, box }
}

/** Object with its starting list number (absent = 1; 0 = no marker). */
export function withListStart(obj: SceneObject, start: number | undefined): SceneObject {
  const want = start !== undefined && start !== 1 ? start : undefined
  if (obj.listStart === want) return obj
  const { listStart: _old, ...rest } = obj
  return want !== undefined ? { ...rest, listStart: want } : rest
}

/**
 * Index of the fragment containing line `line` of a split paragraph. Used by a word-selector
 * highlight to cover the fragment where the word falls. The last fragment is open-ended
 * (in case rendering wraps one extra line).
 */
export function fragmentIndexForLine(fragments: readonly TextFragment[], line: number): number {
  const i = fragments.findIndex((f) => line >= f.fromLine && line < f.toLine)
  if (i >= 0) return i
  const last = fragments[fragments.length - 1]
  return last !== undefined && line >= last.fromLine ? fragments.length - 1 : 0
}

/** Pure helpers of the Konva board: selection anchors, highlight targets, word ranges, label position. */
import { LABEL_OFFSET } from './canvas-style.js'
import { groupBBox, type SceneObject } from '@/scene/index.js'
import type { BBox } from '@/layout/index.js'
import type { Point } from './anchors.js'
import { layoutTextForRender } from './runs-layout.js'
import { getMeasureCtx, domSegmentMeasure } from './measure-text.js'
import { wordRangeInLayout } from '@/scene/text-runs.js'
import { fragmentIndexForLine } from '@/scene/layout-support.js'
import { TEXT_PADDING, ROLE_STYLE } from '@/scene/text-measure.js'

/**
 * Anchor points (top/bottom/left/right) of an object in page coords,
 * for the selection overlay.
 *
 * - A concept: the circle stroke (spans 5–95 % of the box), so the anchors sit on it.
 * - A text: midpoints of the sides of its box.
 */
export function selectionAnchors(obj: SceneObject): Point[] {
  const box = obj.box
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  if (obj.object === 'concepto') {
    // Same stroke as `conceptCirclePath`: from 5 % to 95 % of the box on each axis.
    const near = 0.05
    const far = 0.95
    return [
      { x: box.x + 0.5 * box.width,  y: box.y + near * box.height }, // top
      { x: box.x + 0.5 * box.width,  y: box.y + far * box.height  }, // bottom
      { x: box.x + near * box.width, y: box.y + 0.5 * box.height  }, // left
      { x: box.x + far * box.width,  y: box.y + 0.5 * box.height  }, // right
    ]
  }

  return [
    { x: cx,              y: box.y              }, // top
    { x: cx,              y: box.y + box.height }, // bottom
    { x: box.x,           y: cy                 }, // left
    { x: box.x + box.width, y: cy               }, // right
  ]
}

// ── Helper: bounding box of a highlight referent ──────────────────────────────

/**
 * Computes the box of the referent of a highlight (object, group or connection).
 * Connections use the union of the boxes of their ends.
 * Returns undefined if no box is resolved.
 */
export function highlightTargetBox(
  scene: import('@/scene/index.js').Scene,
  ref: string,
): import('@/layout/index.js').BBox | undefined {
  const obj = scene.objects.get(ref)
  if (obj) return obj.box

  const grp = scene.groups.get(ref)
  if (grp) return groupBBox(scene, ref) ?? undefined

  const conn = scene.connections.get(ref)
  if (conn) {
    const fromObj = scene.objects.get(conn.from)
    const toObj   = scene.objects.get(conn.to)
    if (!fromObj || !toObj) return undefined
    const x0 = Math.min(fromObj.box.x, toObj.box.x)
    const y0 = Math.min(fromObj.box.y, toObj.box.y)
    const x1 = Math.max(fromObj.box.x + fromObj.box.width,  toObj.box.x + toObj.box.width)
    const y1 = Math.max(fromObj.box.y + fromObj.box.height, toObj.box.y + toObj.box.height)
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }

  return undefined
}

/**
 * Determines whether the point (x, y) falls on some highlight of the scene.
 * Expands the referent bbox by `pad` px on each side before testing.
 * Returns the id of the highlight or undefined.
 */
export function highlightAtPoint(
  scene: import('@/scene/index.js').Scene,
  x: number,
  y: number,
  pad = 12,
): string | undefined {
  for (const [hid, hl] of scene.highlights) {
    const box = highlightTargetBox(scene, hl.ref)
    if (!box) continue
    if (
      x >= box.x - pad &&
      x <= box.x + box.width + pad &&
      y >= box.y - pad &&
      y <= box.y + box.height + pad
    ) {
      return hid
    }
  }
  return undefined
}

/**
 * Measures the horizontal range of a word within a text using canvas 2D.
 * Returns {x0, x1} in absolute page coords (includes box.x + TEXT_PADDING).
 * Returns undefined if the DOM is unavailable, the word does not appear or the
 * target is not a text object.
 */
export function measureWordRange(
  scene: import('@/scene/index.js').Scene,
  ref: string,
  word: string,
): { x0: number; x1: number; box?: import('@/layout/index.js').BBox } | undefined {
  const obj = scene.objects.get(ref)
  if (!obj || obj.object !== 'texto') return undefined
  const ctx = getMeasureCtx()
  if (!ctx) return undefined
  try {
    // Use the font size of the object's role to measure correctly,
    // honoring obj.fontSize (title auto-fit) when set.
    const wRoleStyle = ROLE_STYLE[obj.role ?? 'cuerpo']
    const effectiveFontSizeW = obj.fontSize ?? wRoleStyle.fontSize
    const measure = domSegmentMeasure(ctx, effectiveFontSizeW, wRoleStyle.fontStyle)
    // The selector looks for the word in the text WITHOUT the `**` marks, over the
    // same lines that are drawn, and measures with the real weight of each segment.
    const layout = layoutTextForRender(obj.text ?? '', obj.role, obj.box.width, effectiveFontSizeW, obj.listStart)
    const range = wordRangeInLayout(layout, word, measure)
    if (range === undefined) return undefined
    // Paragraph split across columns: the highlight covers the fragment where the
    // selected word falls (without a selector, the first one: `obj.box`).
    const frags = obj.fragments
    if (frags !== undefined && frags.length > 1) {
      const fr = frags[fragmentIndexForLine(frags, range.line)]!
      const baseXf = fr.box.x + TEXT_PADDING
      return { x0: baseXf + range.x0, x1: baseXf + range.x1, box: fr.box }
    }
    const baseX = obj.box.x + TEXT_PADDING
    return { x0: baseX + range.x0, x1: baseX + range.x1 }
  } catch {
    return undefined
  }
}

// ── Helper: label position ────────────────────────────────────────────────────

export function labelPos(
  box: BBox,
): { x: number; y: number; width: number; align: 'left' | 'center' | 'right' } {
  const cx = box.x + box.width / 2
  const w = Math.max(box.width, 80)
  return { x: cx - w / 2, y: box.y + box.height + LABEL_OFFSET, width: w, align: 'center' }
}

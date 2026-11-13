/**
 * Freehand ink module: a pure data model with no Konva, React or DOM.
 *
 * A stroke is a sequence of points captured in real time while the teacher
 * draws with a finger or pen. Points are stored as flattened x,y pairs
 * [x0,y0,x1,y1,...] for direct compatibility with Konva.Line.
 *
 * Ink does NOT enter the scene engine or the agent state (it is invisible to the
 * agent). It takes no part in layout: the teacher places strokes where they want
 * and the canvas does not move them.
 */
import type { Color } from '@/library/index.js'

/** An ink stroke: flattened x,y pairs [x0,y0,x1,y1,...] (Konva.Line format). */
export interface InkStroke {
  id: string
  points: number[]
  /** Stroke color. Undefined = black by default. */
  color?: Color
}

/** Ink layer of a page: strokes in drawing order + a monotonic id counter. */
export interface InkLayer {
  strokes: InkStroke[]
  nextStrokeId: number
}

/** Returns an empty ink layer. */
export function emptyInk(): InkLayer {
  return { strokes: [], nextStrokeId: 1 }
}

/**
 * Adds a stroke to the layer. The id is generated as `ink_${nextStrokeId}` and the
 * counter is incremented. If points has fewer than 4 values (fewer than 2 points),
 * returns the layer unchanged. The color is included only if defined.
 */
export function addStroke(layer: InkLayer, points: number[], color?: Color): InkLayer {
  if (points.length < 4) return layer
  const stroke: InkStroke = {
    id: `ink_${layer.nextStrokeId}`,
    points,
    ...(color ? { color } : {}),
  }
  return {
    strokes: [...layer.strokes, stroke],
    nextStrokeId: layer.nextStrokeId + 1,
  }
}

/**
 * Removes the stroke with the given id. If the id does not exist, returns unchanged.
 */
export function removeStroke(layer: InkLayer, id: string): InkLayer {
  const filtered = layer.strokes.filter((s) => s.id !== id)
  if (filtered.length === layer.strokes.length) return layer
  return { ...layer, strokes: filtered }
}

/**
 * Translates all points of the stroke with the given id by (dx, dy).
 * If the id does not exist in the layer, returns the layer unchanged.
 */
export function translateStroke(layer: InkLayer, id: string, dx: number, dy: number): InkLayer {
  const idx = layer.strokes.findIndex((s) => s.id === id)
  if (idx === -1) return layer

  const stroke = layer.strokes[idx]!
  const newPoints: number[] = []
  for (let i = 0; i < stroke.points.length - 1; i += 2) {
    newPoints.push(stroke.points[i]! + dx)
    newPoints.push(stroke.points[i + 1]! + dy)
  }
  // If the length is odd (should not happen), keep the last value untranslated
  if (stroke.points.length % 2 !== 0) {
    newPoints.push(stroke.points[stroke.points.length - 1]!)
  }

  const newStrokes = layer.strokes.map((s, i) =>
    i === idx ? { ...s, points: newPoints } : s,
  )
  return { ...layer, strokes: newStrokes }
}

/**
 * AREA hit-test: walks the strokes from last to first (the one on top wins)
 * and returns the first whose bounding box, expanded by `pad` px, contains the
 * point. Unlike strokeAtPoint (distance to the line), touching the stroke area
 * is enough to erase it, like objectAtBoxPoint for objects.
 */
export function strokeAtBoxPoint(
  layer: InkLayer,
  x: number,
  y: number,
  pad = 0,
): InkStroke | undefined {
  for (let i = layer.strokes.length - 1; i >= 0; i--) {
    const stroke = layer.strokes[i]!
    const pts = stroke.points
    if (pts.length < 4) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let j = 0; j < pts.length - 1; j += 2) {
      const px = pts[j]!
      const py = pts[j + 1]!
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    if (x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad) {
      return stroke
    }
  }
  return undefined
}

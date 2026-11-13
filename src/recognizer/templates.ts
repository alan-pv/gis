/**
 * Generation of $P recognizer templates from the library.
 *
 * Each SVG object of the library produces a template: its paths are sampled
 * with samplePathPoints (strokeId = path index), concatenated into one cloud
 * and normalized with normalize.
 *
 * render:"text" objects are excluded automatically (svg === null).
 * A single source of truth: there are no hand-drawn templates in code.
 *
 * Pure module: no DOM, Konva or React.
 */
import type { Library } from '../library/index.js'
import type { RecognizerTemplate, CloudPoint } from './types.js'
import { parseSvgPaths } from '../canvas/svg-paths.js'
import { samplePathPoints } from './sample-path.js'
import { normalize } from './normalize.js'

/**
 * Builds the recognizer templates from the object library.
 *
 * For each object with a non-null svg:
 *   1. Extract the paths with parseSvgPaths.
 *   2. Sample each path with samplePathPoints (strokeId = path index in the SVG).
 *   3. Concatenate all points into a single cloud.
 *   4. Normalize with normalize.
 *   5. Store as a RecognizerTemplate with name = the object name.
 */
export function buildTemplatesFromLibrary(library: Library): RecognizerTemplate[] {
  const templates: RecognizerTemplate[] = []

  for (const [name, obj] of library) {
    // render:"text" objects have no SVG and are excluded
    if (obj.svg === null) continue

    const { paths } = parseSvgPaths(obj.svg)
    const cloud: CloudPoint[] = []

    for (let strokeId = 0; strokeId < paths.length; strokeId++) {
      const entry = paths[strokeId]!
      const pts = samplePathPoints(entry.d)
      for (const p of pts) {
        cloud.push({ x: p.x, y: p.y, strokeId })
      }
    }

    // If the object produced no points (empty SVG or paths without geometry), skip it
    if (cloud.length === 0) continue

    const normalized = normalize(cloud)
    templates.push({ name, points: normalized })
  }

  return templates
}

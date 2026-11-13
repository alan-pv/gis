/**
 * Promotion of ink to a typed object.
 *
 * Takes one or more ink strokes of the active page and turns them into a
 * SceneObject with inkGeometry: the teacher's original strokes are kept as
 * points relative to the origin of the bounding box.
 *
 * Pure: returns a new document without mutating the input. It generates no
 * animation and does not touch pendingSteps: the stroke is already drawn.
 */
import type { GisDocument } from './model.js'
import { activePage, documentIds } from './model.js'
import type { SceneObject } from '@/scene/model.js'
import type { BBox } from '@/layout/index.js'

// ── Public types ───────────────────────────────────────────────────────────────

export interface PromoteResult {
  /** New document with the promoted object in the active scene and without the ink strokes. */
  document: GisDocument
  /** Canonical id of the created object, or null if strokeIds was empty or no strokes matched. */
  objectId: string | null
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Promotes the given ink strokes to a typed SceneObject on the active page.
 *
 * @param doc          Current document (not mutated).
 * @param strokeIds    Ids of the strokes to promote.
 * @param objectType   Library object type (e.g. "sol", "nube").
 */
export function promoteInk(
  doc: GisDocument,
  strokeIds: string[],
  objectType: string,
): PromoteResult {
  // Trivial case: empty list
  if (strokeIds.length === 0) {
    return { document: doc, objectId: null }
  }

  const page = activePage(doc)
  const ink = page.ink

  // Collect the existing strokes (unknown ids are silently ignored)
  const strokes = ink.strokes.filter((s) => strokeIds.includes(s.id))
  if (strokes.length === 0) {
    return { document: doc, objectId: null }
  }

  // ── Exact bounding box (absolute page coordinates) ────────────────────────────

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const stroke of strokes) {
    const pts = stroke.points
    for (let i = 0; i < pts.length - 1; i += 2) {
      const x = pts[i]!
      const y = pts[i + 1]!
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  // Guard for strokes with fewer than 4 numbers (addStroke prevents it, but the
  // invariant is enforced here too)
  if (!isFinite(minX)) {
    return { document: doc, objectId: null }
  }

  const box: BBox = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }

  // ── Generate a canonical id that is free document-wide ────────────────────────

  // Ids of ALL pages of the document (none excluded: the new object goes to the
  // active page and must not collide with anything)
  const allDocIds = documentIds(doc)

  // The ids of the active scene must be included too
  const activeSceneIds = new Set<string>()
  for (const id of page.scene.objects.keys()) activeSceneIds.add(id)
  for (const id of page.scene.connections.keys()) activeSceneIds.add(id)
  for (const id of page.scene.groups.keys()) activeSceneIds.add(id)

  const pageNumber = page.number
  const objectId = nextFreeId(objectType, pageNumber, allDocIds, activeSceneIds)

  // ── Strokes relative to the box origin ───────────────────────────────────────

  const inkGeometry: number[][] = strokes.map((stroke) => {
    const pts = stroke.points
    const relative: number[] = []
    for (let i = 0; i < pts.length - 1; i += 2) {
      relative.push(pts[i]! - minX)
      relative.push(pts[i + 1]! - minY)
    }
    return relative
  })

  // ── Build the SceneObject ─────────────────────────────────────────────────────

  // The color comes from the first promoted stroke that has one.
  const inkColor = strokes.find(s => s.color)?.color

  const sceneObj: SceneObject = {
    id: objectId,
    object: objectType,
    label: null,
    text: null,
    // Objects promoted from ink have no semantic role.
    role: null,
    box,
    color: inkColor,
    inkGeometry,
  }

  // ── Update the active scene (immutably) ───────────────────────────────────────

  const oldScene = page.scene
  const newObjects = new Map(oldScene.objects)
  newObjects.set(objectId, sceneObj)
  const newScene = { ...oldScene, objects: newObjects }

  // ── Remove the promoted strokes from the ink layer ───────────────────────────

  const promotedSet = new Set(strokeIds)
  const newInkStrokes = ink.strokes.filter((s) => !promotedSet.has(s.id))
  const newInk = { ...ink, strokes: newInkStrokes }

  // ── Build the new document ────────────────────────────────────────────────────

  const newPages = doc.pages.map((p, i) => {
    if (i !== doc.activeIndex) return p
    return { ...p, scene: newScene, ink: newInk }
  })

  const newDoc: GisDocument = { ...doc, pages: newPages }

  return { document: newDoc, objectId }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Generates the smallest free id with format <type>_<page>_<n>, considering
 * every id of the document (active scene + other pages).
 */
function nextFreeId(
  type: string,
  pageNumber: number,
  allDocIds: ReadonlySet<string>,
  activeSceneIds: ReadonlySet<string>,
): string {
  let n = 1
  while (allDocIds.has(`${type}_${pageNumber}_${n}`) || activeSceneIds.has(`${type}_${pageNumber}_${n}`)) {
    n++
  }
  return `${type}_${pageNumber}_${n}`
}

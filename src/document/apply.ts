/**
 * Document-level operation applier.
 *
 * Wraps the scene engine's applyOperations so it works on the active page,
 * passing the right page number and the ids of the other pages for global id
 * collision handling.
 *
 * The input document is NOT mutated: a new one is returned with the active
 * page's scene replaced.
 */
import type { Operation } from '@/contract/index.js'
import type { Library } from '@/library/index.js'
import type { SceneEvent, TextMeasurer, ConceptMeasurer } from '@/scene/index.js'
import { applyOperations, reflowScene } from '@/scene/index.js'
import type { ValidationMode } from '@/validator/index.js'
import type { GisDocument } from './model.js'
import { activePage, activeScene, documentIds } from './model.js'

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * Result of applyToActivePage.
 */
export interface DocumentApplyResult {
  /** New document with the active page's scene replaced. */
  document: GisDocument
  /** Animation script of the active page (same order as the accepted ops). */
  events: SceneEvent[]
  /** Warnings from the scene engine. */
  warnings: string[]
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Applies operations to the active page of the document.
 *
 * Builds the environment with:
 * - page: stable number of the active page (format object_page_n).
 * - externalIds: ids of all the other pages (global id collision handling).
 *
 * Live vs slide policy:
 * - `mode === 'live'` (default): the resulting scene keeps the stable top-down
 *   live packing; an object that is already placed is never moved.
 * - `mode === 'slide'`: a global stable top-down reflow of the whole page
 *   (`reflowScene`, no vertical justification) is applied before putting it in
 *   the document. It re-derives regions and re-places everything.
 *
 * @param doc   Current document (not mutated).
 * @param ops   List of validated operations.
 * @param env   Canvas and object library.
 * @param mode  Validation/placement mode (live/slide). Default 'live'.
 * @returns     New document + animation script + warnings.
 */
export function applyToActivePage(
  doc: GisDocument,
  ops: Operation[],
  env: { canvas: { width: number; height: number }; library: Library; measureText?: TextMeasurer; measureConcept?: ConceptMeasurer; attachConnectedFigure?: boolean; attachWithoutXGuard?: boolean; fallbackNearTarget?: boolean },
  mode: ValidationMode = 'live',
): DocumentApplyResult {
  const currentPage = activePage(doc)
  const scene = activeScene(doc)

  // Ids of every page except the active one (for global collision handling)
  const externalIds = documentIds(doc, doc.activeIndex)

  const result = applyOperations(scene, ops, {
    ...env,
    page: currentPage.number,
    externalIds,
    measureText: env.measureText,
    // Inject the active page's areaTree so layoutPlan uses the right tree.
    areaTree: currentPage.areaTree,
  })

  // In slide mode the whole page is reflowed (stable top-down, no vertical
  // justification) using the active page's areaTree; in live mode the live
  // packing is kept.
  const finalScene =
    mode === 'slide' ? reflowScene(result.scene, env.canvas, currentPage.areaTree) : result.scene

  // Replace the active page's scene in the document (without mutating)
  const newPages = doc.pages.map((page, i) =>
    i === doc.activeIndex ? { ...page, scene: finalScene } : page,
  )

  const newDoc: GisDocument = {
    ...doc,
    pages: newPages,
  }

  return {
    document: newDoc,
    events: result.events,
    warnings: result.warnings,
  }
}

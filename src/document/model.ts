/**
 * Multi-page document model.
 *
 * A GisDocument is an ordered list of pages, each with its own Scene, plus the
 * index of the active page and a monotonic page-number counter.
 *
 * Invariant: pages.length >= 1 (there is always at least one page).
 * Page numbers are stable: deleting pages does not renumber the others.
 *
 * All functions are pure: they return new documents without mutating the input,
 * like the scene engine (src/scene/).
 */
import type { Scene } from '@/scene/index.js'
import { emptyScene, allIds } from '@/scene/index.js'
import type { InkLayer } from '@/ink/index.js'
import { emptyInk } from '@/ink/index.js'
import type { AreaTree } from '@/layout/index.js'
import { defaultAreaTree } from '@/layout/index.js'

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * A page within the document.
 * The number is stable: it is assigned on creation and does not change when
 * other pages are deleted. It is the "page" component of the canonical id
 * object_page_n.
 */
export interface Page {
  /** Stable number assigned on creation (monotonic counter); NOT the index. */
  number: number
  scene: Scene
  /** Freehand ink of the page; invisible to the agent (not part of the canvas state). */
  ink: InkLayer
  /**
   * Partition tree of the body areas. The agent never sees it: geometry belongs
   * to the app. Three equal columns by default; changeable per page with SET_AREA_TREE.
   */
  areaTree: AreaTree
}

/**
 * Whole document: list of pages + pointer to the active page.
 */
export interface GisDocument {
  /** Pages in order; always at least one. */
  pages: Page[]
  /** Index of the active page in pages. */
  activeIndex: number
  /** Next page number to assign (monotonic, never decreases). */
  nextPageNumber: number
}

// ── Constructors and pure mutations ───────────────────────────────────────────

/**
 * Creates a document with a single empty active page (number=1).
 * nextPageNumber is 2.
 */
export function newDocument(): GisDocument {
  return {
    pages: [{ number: 1, scene: emptyScene(), ink: emptyInk(), areaTree: defaultAreaTree(3) }],
    activeIndex: 0,
    nextPageNumber: 2,
  }
}

/**
 * Appends an empty page at the end of the document and makes it active.
 * The new page number is nextPageNumber, which is then incremented.
 */
export function addPage(doc: GisDocument): GisDocument {
  const newPage: Page = {
    number: doc.nextPageNumber,
    scene: emptyScene(),
    ink: emptyInk(),
    areaTree: defaultAreaTree(3),
  }
  return {
    pages: [...doc.pages, newPage],
    activeIndex: doc.pages.length, // index of the new (last) page
    nextPageNumber: doc.nextPageNumber + 1,
  }
}

/**
 * Removes the page at the given index.
 *
 * Guarantees:
 * - If index is invalid OR there is only one page → returns the doc unchanged.
 * - If the active page is removed → the previous one becomes active (or the next
 *   one if the removed page was the first).
 * - If another page is removed → the active page stays THE SAME PAGE
 *   (its new index is recomputed).
 * - The page numbers of the remaining pages do NOT change.
 */
export function removePage(doc: GisDocument, index: number): GisDocument {
  // Invariant: at least 1 page
  if (doc.pages.length <= 1) return doc
  // Invalid index
  if (index < 0 || index >= doc.pages.length) return doc

  const newPages = doc.pages.filter((_, i) => i !== index)

  let newActiveIndex: number
  if (index === doc.activeIndex) {
    // The active page is removed: the previous one becomes active, or the next if it was the first
    newActiveIndex = index === 0 ? 0 : index - 1
  } else if (index < doc.activeIndex) {
    // A page before the active one is removed: the index drops by 1
    newActiveIndex = doc.activeIndex - 1
  } else {
    // A page after the active one is removed: the index does not change
    newActiveIndex = doc.activeIndex
  }

  return {
    pages: newPages,
    activeIndex: newActiveIndex,
    nextPageNumber: doc.nextPageNumber,
  }
}

/**
 * Sets the active page to the given index.
 * If the index is invalid → returns the document unchanged.
 */
export function setActivePage(doc: GisDocument, index: number): GisDocument {
  if (index < 0 || index >= doc.pages.length) return doc
  return { ...doc, activeIndex: index }
}

// ── Accessors ─────────────────────────────────────────────────────────────────

/**
 * Returns the active page of the document.
 */
export function activePage(doc: GisDocument): Page {
  // The invariant guarantees pages.length >= 1 and 0 <= activeIndex < pages.length
  return doc.pages[doc.activeIndex]!
}

/**
 * Returns the scene of the active page.
 */
export function activeScene(doc: GisDocument): Scene {
  return activePage(doc).scene
}

/**
 * Returns the ink layer of the active page.
 */
export function activeInk(doc: GisDocument): InkLayer {
  return activePage(doc).ink
}

/**
 * Returns a new document where the ink layer of the active page is replaced by
 * ink. The rest of the document is unchanged.
 */
export function updateActiveInk(doc: GisDocument, ink: InkLayer): GisDocument {
  const newPages = doc.pages.map((page, i) =>
    i === doc.activeIndex ? { ...page, ink } : page,
  )
  return { ...doc, pages: newPages }
}

/**
 * Returns the union of all ids present in the document, optionally excluding
 * the page at the given index.
 *
 * Used to build externalIds when applying operations to the active page
 * (ids are unique across the whole document).
 *
 * @param doc           Document.
 * @param excludeIndex  Index of the page to exclude (normally activeIndex).
 */
export function documentIds(doc: GisDocument, excludeIndex?: number): ReadonlySet<string> {
  const result = new Set<string>()
  for (let i = 0; i < doc.pages.length; i++) {
    if (i === excludeIndex) continue
    for (const id of allIds(doc.pages[i]!.scene)) {
      result.add(id)
    }
  }
  return result
}

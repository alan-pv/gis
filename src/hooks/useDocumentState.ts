/**
 * Canvas state reducer for a multi-page document.
 *
 * Lifts a Scene's state into a GisDocument. The stateRef + useEffect pattern gives
 * applyEnvelope synchronous reads of the latest state.
 *
 * Actions:
 * - APPLY_RESULT    : stores the new document + steps + already computed warnings.
 * - OBJECT_MOVED    : updates the box of an object on the active page.
 * - STEPS_CONSUMED  : empties the queue of pending steps.
 * - ADD_PAGE        : appends an empty page and makes it active.
 * - REMOVE_PAGE     : removes the page at the given index.
 * - SET_ACTIVE_PAGE : switches the active page to the given index.
 * - RESET_DOCUMENT  : back to a single empty page.
 * - ADD_INK_STROKE  : adds an ink stroke to the active page (does NOT empty pendingSteps).
 * - REMOVE_INK_STROKE: removes an ink stroke by id (does NOT empty pendingSteps).
 * - PROMOTE_INK      : promotes ink strokes to a typed object (does NOT empty pendingSteps).
 * - ERASE_PROMOTED   : deletes an object with inkGeometry, cascading (does NOT empty pendingSteps).
 * - MOVE_INK_STROKE  : translates the points of an ink stroke (does NOT empty pendingSteps).
 * - REMOVE_OBJECT    : deletes any object (agent or promoted), cascading (does NOT empty pendingSteps).
 * - UNDO             : restores the latest snapshot of the stack.
 *
 * Why every page action empties pendingSteps: an animation belongs to the page that
 * generated it; when the page changes it is cancelled and the page is left fully drawn.
 *
 * ── Unified undo stack ─────────────────────────────────────────────────────────
 * Reversible actions on the active page take a snapshot BEFORE mutating and push it
 * onto undoStack:
 *   ADD_INK_STROKE, PROMOTE_INK, REMOVE_OBJECT, ERASE_PROMOTED,
 *   REMOVE_INK_STROKE, MOVE_INK_STROKE.
 *
 * No snapshot is taken for:
 *   - APPLY_RESULT   (agent drawings are not the teacher's work)
 *   - OBJECT_MOVED   (object drags)
 *   - Page actions (ADD_PAGE, REMOVE_PAGE, SET_ACTIVE_PAGE, RESET_DOCUMENT)
 *
 * UNDO restores the active page's scene + ink from the latest snapshot. With an
 * empty stack it does nothing.
 */
import { useReducer, useRef, useEffect } from 'react'
import type { Color } from '@/library/index.js'
import type { GisDocument } from '@/document/index.js'
import {
  newDocument,
  addPage,
  removePage,
  setActivePage,
  activeScene,
  activeInk,
  updateActiveInk,
} from '@/document/index.js'
import { applyToActivePage, promoteInk } from '@/document/index.js'
import { addStroke, removeStroke, translateStroke } from '@/ink/index.js'
import { domMeasureText, domMeasureConcept } from '../canvas/measure-text.js'
import type { Scene } from '@/scene/index.js'
import type { InkLayer } from '@/ink/index.js'
import type { Library } from '@/library/index.js'
import { validateAgentOutput } from '@/validator/index.js'
import type { ValidationMode } from '@/validator/index.js'
import { allIds, removeObjectCascade, diffAddedObjects, reflowScene } from '@/scene/index.js'
import { buildTimeline } from '@/animation/timeline.js'
import type { AnimationStep } from '@/animation/timeline.js'
import type { BBox, Canvas, AreaTree } from '@/layout/index.js'

// ── Public types ──────────────────────────────────────────────────────────────

/** Snapshot of the active page for the unified undo. */
export interface UndoSnapshot {
  scene: Scene
  ink: InkLayer
  /**
   * Area tree at snapshot time. Restored together with scene+ink on UNDO, so
   * splitting/removing areas is reversible with Ctrl+Z in a single step.
   */
  areaTree: AreaTree
  activeIndex: number
}

/** Maximum number of snapshots in the undo stack. */
const UNDO_STACK_MAX = 30

export interface DocumentState {
  document: GisDocument
  /** Steps pending playback on the active page (emptied once consumed). */
  pendingSteps: AnimationStep[]
  warnings: string[]
  /** Unified undo stack: snapshots of the active page taken before reversible mutations. */
  undoStack: UndoSnapshot[]
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type DocumentAction =
  | { type: 'APPLY_RESULT'; document: GisDocument; steps: AnimationStep[]; warnings: string[] }
  | { type: 'OBJECT_MOVED'; id: string; newBox: BBox }
  | { type: 'STEPS_CONSUMED' }
  | { type: 'ADD_PAGE' }
  | { type: 'REMOVE_PAGE'; index: number }
  | { type: 'SET_ACTIVE_PAGE'; index: number }
  | { type: 'RESET_DOCUMENT' }
  | { type: 'ADD_INK_STROKE'; points: number[]; color?: Color }
  | { type: 'REMOVE_INK_STROKE'; id: string }
  | { type: 'PROMOTE_INK'; strokeIds: string[]; objectType: string }
  | { type: 'ERASE_PROMOTED'; id: string }
  | { type: 'MOVE_INK_STROKE'; id: string; dx: number; dy: number }
  | { type: 'REMOVE_OBJECT'; id: string }
  /** Deletes a highlight by id, with a snapshot for UNDO (eraser on a highlight). */
  | { type: 'REMOVE_HIGHLIGHT'; id: string }
  /** Unified undo: restores the active page's scene + ink from the latest snapshot. */
  | { type: 'UNDO' }
  /**
   * Replaces the active page's AreaTree and reflows the scene.
   * Immutable: creates a new page with the tree + scene replaced; the others are untouched.
   * Takes an undo snapshot: splitting/removing areas is reversible with Ctrl+Z.
   * Does not empty pendingSteps: the tree is pure app geometry and generates no animation.
   *
   * @param canvas  Canvas dimensions for the reflow (pure: no DOM).
   */
  | { type: 'SET_AREA_TREE'; areaTree: AreaTree; canvas: Canvas; snapshot?: boolean }

// ── Initial state ─────────────────────────────────────────────────────────────

export function initialDocumentState(): DocumentState {
  return {
    document: newDocument(),
    pendingSteps: [],
    warnings: [],
    undoStack: [],
  }
}

// ── Helper: snapshot for the unified undo ─────────────────────────────────────

/**
 * Takes a snapshot of the active page and pushes it onto undoStack.
 * The stack is capped at UNDO_STACK_MAX entries (the oldest is dropped).
 * Only called before the reversible mutations (see the stack documentation above).
 */
function pushSnapshot(state: DocumentState): UndoSnapshot[] {
  const page = state.document.pages[state.document.activeIndex]!
  const snapshot: UndoSnapshot = {
    scene: page.scene,
    ink: page.ink,
    // The areaTree is captured so UNDO restores it too, which lets split/remove
    // of areas be undone in a single step.
    areaTree: page.areaTree,
    activeIndex: state.document.activeIndex,
  }
  const newStack = [...state.undoStack, snapshot]
  // Drop the oldest one if we exceed the limit
  if (newStack.length > UNDO_STACK_MAX) {
    return newStack.slice(newStack.length - UNDO_STACK_MAX)
  }
  return newStack
}

// ── Reducer (exported for tests) ───────────────────────────────────────────────

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {

    case 'APPLY_RESULT': {
      // APPLY_RESULT takes NO snapshot: agent drawings are not reversible with the
      // teacher's Ctrl+Z (see the stack documentation in the header).
      return {
        document: action.document,
        pendingSteps: action.steps,
        warnings: [...state.warnings, ...action.warnings],
        undoStack: state.undoStack,
      }
    }

    case 'OBJECT_MOVED': {
      const { id, newBox } = action
      const scene = activeScene(state.document)
      const obj = scene.objects.get(id)
      // Only acts if the object exists on the active page
      if (!obj) return state

      const updatedObjects = new Map(scene.objects)
      updatedObjects.set(id, { ...obj, box: newBox })

      const updatedScene = { ...scene, objects: updatedObjects }
      // Replace the active page scene without mutating (same pattern as applyToActivePage)
      const newPages = state.document.pages.map((page, i) =>
        i === state.document.activeIndex ? { ...page, scene: updatedScene } : page,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages }

      return { ...state, document: newDoc }
    }

    case 'STEPS_CONSUMED': {
      return { ...state, pendingSteps: [] }
    }

    // Why it empties: the animation belongs to the page that generated it; when the
    // page changes it is cancelled and the page is left fully drawn.
    case 'ADD_PAGE': {
      return {
        ...state,
        document: addPage(state.document),
        pendingSteps: [],
      }
    }

    case 'REMOVE_PAGE': {
      return {
        ...state,
        document: removePage(state.document, action.index),
        pendingSteps: [],
      }
    }

    case 'SET_ACTIVE_PAGE': {
      return {
        ...state,
        document: setActivePage(state.document, action.index),
        pendingSteps: [],
      }
    }

    case 'RESET_DOCUMENT': {
      return {
        document: newDocument(),
        pendingSteps: [],
        warnings: [],
        undoStack: [],
      }
    }

    // Ink actions do NOT empty pendingSteps: the scene animation is independent of
    // the ink layer (they are different Konva layers).
    // Snapshot BEFORE mutating → enables UNDO.
    case 'ADD_INK_STROKE': {
      const newUndoStack = pushSnapshot(state)
      const newInk = addStroke(activeInk(state.document), action.points, action.color)
      return { ...state, undoStack: newUndoStack, document: updateActiveInk(state.document, newInk) }
    }

    case 'REMOVE_INK_STROKE': {
      const newUndoStack = pushSnapshot(state)
      const newInk = removeStroke(activeInk(state.document), action.id)
      return { ...state, undoStack: newUndoStack, document: updateActiveInk(state.document, newInk) }
    }

    // Promoting ink does NOT empty pendingSteps: the stroke was already drawn and the
    // scene animation is independent of the promotion.
    // Snapshot BEFORE mutating → Ctrl+Z reverts the promotion to ink.
    case 'PROMOTE_INK': {
      const newUndoStack = pushSnapshot(state)
      const { document: newDoc } = promoteInk(
        state.document,
        action.strokeIds,
        action.objectType,
      )
      return { ...state, undoStack: newUndoStack, document: newDoc }
    }

    // Erasing promoted objects does NOT empty pendingSteps: like the ink actions,
    // the scene animation is independent.
    // Only acts if the object exists AND has inkGeometry (agent objects are not
    // deleted with the eraser).
    // Snapshot BEFORE mutating → enables UNDO.
    case 'ERASE_PROMOTED': {
      const scene = activeScene(state.document)
      const obj = scene.objects.get(action.id)
      // Ignore if the object does not exist or has no inkGeometry
      if (!obj || !obj.inkGeometry) return state

      const newUndoStack = pushSnapshot(state)
      const newScene = removeObjectCascade(scene, action.id)

      // Replace the active scene without mutating (same pattern as OBJECT_MOVED)
      const newPages = state.document.pages.map((page, i) =>
        i === state.document.activeIndex ? { ...page, scene: newScene } : page,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages }
      return { ...state, undoStack: newUndoStack, document: newDoc }
    }

    // Deleting any object does NOT empty pendingSteps: selection and manual deletion
    // are independent of the animation in progress.
    // Snapshot BEFORE mutating → enables UNDO of the deletion.
    case 'REMOVE_OBJECT': {
      const scene = activeScene(state.document)
      if (!scene.objects.has(action.id)) return state

      const newUndoStack = pushSnapshot(state)
      const newScene = removeObjectCascade(scene, action.id)
      const newPages = state.document.pages.map((page, i) =>
        i === state.document.activeIndex ? { ...page, scene: newScene } : page,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages }
      return { ...state, undoStack: newUndoStack, document: newDoc }
    }

    // Translating an ink stroke does NOT empty pendingSteps: same reason as
    // ADD_INK_STROKE / REMOVE_INK_STROKE.
    // Snapshot BEFORE mutating → enables UNDO of the ink move.
    case 'MOVE_INK_STROKE': {
      const newUndoStack = pushSnapshot(state)
      const newInk = translateStroke(activeInk(state.document), action.id, action.dx, action.dy)
      return { ...state, undoStack: newUndoStack, document: updateActiveInk(state.document, newInk) }
    }

    // Deletes a highlight by id, with a snapshot for UNDO.
    // Does not empty pendingSteps: the scene animation is independent.
    case 'REMOVE_HIGHLIGHT': {
      const scene = activeScene(state.document)
      if (!scene.highlights.has(action.id)) return state

      const newUndoStack = pushSnapshot(state)
      const newHighlights = new Map(scene.highlights)
      newHighlights.delete(action.id)
      const updatedScene = { ...scene, highlights: newHighlights }
      const newPages = state.document.pages.map((page, i) =>
        i === state.document.activeIndex ? { ...page, scene: updatedScene } : page,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages }
      return { ...state, undoStack: newUndoStack, document: newDoc }
    }

    // ── SET_AREA_TREE ────────────────────────────────────────────────────────────
    // Replaces the active page's AreaTree and reflows its scene to the new tree.
    // Takes an undo snapshot: splitting/removing an area is reversible with Ctrl+Z.
    // Does not empty pendingSteps: the tree is pure app geometry.
    case 'SET_AREA_TREE': {
      // The undo snapshot is taken once per resize gesture (on the first delta), not
      // on every live-drag movement. snapshot=false skips it (preview); by default
      // (split/remove/commit) it is taken.
      const newUndoStack = action.snapshot === false ? state.undoStack : pushSnapshot(state)
      const page = state.document.pages[state.document.activeIndex]!
      // Pure reflow: re-derives the boxes of every object from the new tree.
      const newScene = reflowScene(page.scene, action.canvas, action.areaTree)
      const newPages = state.document.pages.map((p, i) =>
        i === state.document.activeIndex
          ? { ...p, areaTree: action.areaTree, scene: newScene }
          : p,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages }
      return { ...state, undoStack: newUndoStack, document: newDoc }
    }

    // ── Unified UNDO ─────────────────────────────────────────────────────────────
    // Restores the active page's scene + ink from the latest snapshot.
    // Clears pendingSteps to avoid replaying an animation over restored state.
    // With an empty stack it does nothing.
    case 'UNDO': {
      if (state.undoStack.length === 0) return state
      const snapshot = state.undoStack[state.undoStack.length - 1]!
      const newUndoStack = state.undoStack.slice(0, -1)

      // Restore the scene, ink and areaTree of the page that holds the snapshot
      // (the snapshot's activeIndex could differ if the page was changed, but in
      // practice the debounce guarantees the snapshot is from the active page)
      const targetIndex = snapshot.activeIndex
      const newPages = state.document.pages.map((page, i) =>
        i === targetIndex
          ? { ...page, scene: snapshot.scene, ink: snapshot.ink, areaTree: snapshot.areaTree }
          : page,
      )
      const newDoc: GisDocument = { ...state.document, pages: newPages, activeIndex: targetIndex }
      return {
        ...state,
        document: newDoc,
        undoStack: newUndoStack,
        // Clear pending steps: no animation over restored state
        pendingSteps: [],
      }
    }
  }
}

// ── applyEnvelope result ───────────────────────────────────────────────────────

export interface ApplyEnvelopeResult {
  /** Number of operations accepted by the validator. */
  accepted: number
  /** Number of AnimationSteps generated for the animation. */
  steps: number
  /** Objects newly created by this envelope (present in next but not in prev). */
  created: { id: string; box: BBox }[]
}

// ── Public hook ────────────────────────────────────────────────────────────────

export interface UseDocumentStateResult {
  state: DocumentState
  /**
   * Validates and applies a raw envelope to the document state.
   * @param raw      Raw envelope from the agent (any type).
   * @param library  Installed object library.
   * @param canvas   Canvas dimensions in pixels.
   * @param mode     Validation mode: 'live' (push-to-talk/phrase, cap 20) or 'slide' (notes/JSON box, cap 200). Default: 'live'.
   */
  applyEnvelope: (raw: unknown, library: Library, canvas: { width: number; height: number }, mode?: ValidationMode) => ApplyEnvelopeResult
  objectMoved: (id: string, newBox: BBox) => void
  stepsConsumed: () => void
  addPage: () => void
  removePage: (index: number) => void
  setActivePage: (index: number) => void
  resetDocument: () => void
  /** Adds an ink stroke to the active page. Does not cancel the animation in progress. */
  addInkStroke: (points: number[], color?: Color) => void
  /** Removes the ink stroke with the given id from the active page. Does not cancel the animation in progress. */
  removeInkStroke: (id: string) => void
  /**
   * Promotes the given strokes to a typed SceneObject on the active page.
   * Does not cancel the animation in progress.
   *
   * @param strokeIds   Ids of the strokes to promote.
   * @param objectType  Object type (e.g. "sol", "nube").
   */
  promoteInkStrokes: (strokeIds: string[], objectType: string) => void
  /**
   * Deletes a promoted object (with inkGeometry), cascading to connections and groups.
   * Does not cancel the animation in progress. Ignores objects without inkGeometry.
   */
  erasePromoted: (id: string) => void
  /**
   * Translates every point of the given ink stroke by (dx, dy).
   * Does not cancel the animation in progress.
   */
  moveInkStroke: (id: string, dx: number, dy: number) => void
  /**
   * Deletes any object of the active page, cascading to connections and groups.
   * Includes agent objects and promoted objects (unlike erasePromoted, which only
   * acts on those with inkGeometry). Does not cancel the animation in progress.
   */
  removeObject: (id: string) => void
  /**
   * Deletes a highlight by id from the active page.
   * Takes a snapshot for UNDO. Does not cancel the animation in progress.
   */
  removeHighlight: (id: string) => void
  /**
   * Unified undo: restores the active page's scene + ink from the latest snapshot
   * of the stack. With an empty stack it does nothing.
   * Reverts: ink strokes, promotions, object deletion.
   */
  undo: () => void
  /** true if the undo stack holds at least one snapshot (to enable/disable the button). */
  canUndo: boolean
  /**
   * Replaces the active page's AreaTree, reflows the scene and creates an undo
   * snapshot. Immutable: the other pages are untouched.
   *
   * @param tree    New area tree (result of splitLeaf / removeLeaf / resizeSplit).
   * @param canvas  Canvas dimensions for the pure reflow (no DOM).
   */
  setAreaTree: (tree: AreaTree, canvas: Canvas, opts?: { snapshot?: boolean }) => void
}

export function useDocumentState(): UseDocumentStateResult {
  const [state, dispatch] = useReducer(documentReducer, undefined, initialDocumentState)

  // We keep a ref to the current state so applyEnvelope can read it synchronously
  // without capturing a stale closure. The sync happens in an effect (not during
  // render) to satisfy the hooks rules; since applyEnvelope is only called from
  // event handlers (never during render), the ref is always up to date.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const applyEnvelope = (
    raw: unknown,
    library: Library,
    canvas: { width: number; height: number },
    mode: ValidationMode = 'live',
  ): ApplyEnvelopeResult => {
    const currentState = stateRef.current

    const pageIds = allIds(activeScene(currentState.document))

    const ctx = {
      mode,
      pageIds,
    }

    const { accepted, rejected } = validateAgentOutput(raw, ctx)

    if (rejected.length > 0) {
      console.warn('[Gis] Rejected operations:', rejected)
    }

    if (accepted.length === 0) {
      return { accepted: 0, steps: 0, created: [] }
    }

    // Capture the previous scene BEFORE applying so the new objects can be computed
    const prevScene = activeScene(currentState.document)

    // Apply the operations to the document's active page
    const result = applyToActivePage(currentState.document, accepted, { canvas, library, measureText: domMeasureText, measureConcept: domMeasureConcept }, mode)
    const steps = buildTimeline(result.events, activeScene(result.document), library)

    // Objects added by this envelope (present in next but not in prev)
    const created = diffAddedObjects(prevScene, activeScene(result.document))

    dispatch({ type: 'APPLY_RESULT', document: result.document, steps, warnings: result.warnings })

    return { accepted: accepted.length, steps: steps.length, created }
  }

  const objectMovedFn = (id: string, newBox: BBox) => {
    dispatch({ type: 'OBJECT_MOVED', id, newBox })
  }

  const stepsConsumed = () => {
    dispatch({ type: 'STEPS_CONSUMED' })
  }

  const addPageFn = () => {
    dispatch({ type: 'ADD_PAGE' })
  }

  const removePageFn = (index: number) => {
    dispatch({ type: 'REMOVE_PAGE', index })
  }

  const setActivePageFn = (index: number) => {
    dispatch({ type: 'SET_ACTIVE_PAGE', index })
  }

  const resetDocument = () => {
    dispatch({ type: 'RESET_DOCUMENT' })
  }

  const addInkStroke = (points: number[], color?: Color) => {
    dispatch({ type: 'ADD_INK_STROKE', points, color })
  }

  const removeInkStroke = (id: string) => {
    dispatch({ type: 'REMOVE_INK_STROKE', id })
  }

  const promoteInkStrokes = (
    strokeIds: string[],
    objectType: string,
  ) => {
    dispatch({ type: 'PROMOTE_INK', strokeIds, objectType })
  }

  const erasePromoted = (id: string) => {
    dispatch({ type: 'ERASE_PROMOTED', id })
  }

  const moveInkStroke = (id: string, dx: number, dy: number) => {
    dispatch({ type: 'MOVE_INK_STROKE', id, dx, dy })
  }

  const removeObject = (id: string) => {
    dispatch({ type: 'REMOVE_OBJECT', id })
  }

  const removeHighlight = (id: string) => {
    dispatch({ type: 'REMOVE_HIGHLIGHT', id })
  }

  const undo = () => {
    dispatch({ type: 'UNDO' })
  }

  const setAreaTree = (tree: AreaTree, canvas: Canvas, opts?: { snapshot?: boolean }) => {
    dispatch({ type: 'SET_AREA_TREE', areaTree: tree, canvas, snapshot: opts?.snapshot })
  }

  return {
    state,
    applyEnvelope,
    objectMoved: objectMovedFn,
    stepsConsumed,
    addPage: addPageFn,
    removePage: removePageFn,
    setActivePage: setActivePageFn,
    resetDocument,
    addInkStroke,
    removeInkStroke,
    promoteInkStrokes,
    erasePromoted,
    moveInkStroke,
    removeObject,
    removeHighlight,
    undo,
    canUndo: state.undoStack.length > 0,
    setAreaTree,
  }
}

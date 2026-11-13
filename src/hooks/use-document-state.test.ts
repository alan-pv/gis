/**
 * Tests of the reducer and logic of useDocumentState.
 *
 * Pure logic only: no Konva, no rendering, no DOM.
 *
 * Cases covered:
 * a) ADD_PAGE / SET_ACTIVE_PAGE / REMOVE_PAGE empty pendingSteps.
 * b) RESET_DOCUMENT returns a one-empty-page document and clears steps and warnings.
 * c) OBJECT_MOVED: moves an object of the active page; with an id from another page → no change.
 * d) applyEnvelope flow (pure logic):
 *    - Create an object on page 1, add page 2, create an object with the SAME
 *      suggested id → on page 2 the id is renamed with page 2's suffix.
 *    - documentToAgentState after switching to page 2 does NOT contain page 1's objects.
 */
import { describe, it, expect } from 'vitest'
import {
  documentReducer,
  initialDocumentState,
} from './useDocumentState.js'
import type { DocumentState } from './useDocumentState.js'
import type { AnimationStep } from '@/animation/timeline.js'
import {
  newDocument,
  addPage,
  setActivePage,
  activeScene,
  activeInk,
} from '@/document/index.js'
import { applyToActivePage } from '@/document/index.js'
import { documentToAgentState } from '@/document/index.js'
import { allIds } from '@/scene/index.js'
import { defaultAreaTree, leafIds, splitLeaf } from '@/layout/index.js'

// ── Test environment ─────────────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 800 }

const ENV = { canvas: CANVAS }

// ── Helper: seed animation steps into the state ───────────────────────────

/**
 * Produces a DocumentState with animation steps in pendingSteps, using
 * APPLY_RESULT to simulate an animation in progress.
 */
function stateWithPendingSteps(): DocumentState {
  // Build a document with an object on page 1
  let doc = newDocument()
  const result = applyToActivePage(doc, [
    { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
  ], ENV)
  doc = result.document

  // Simulate pending steps (tests use a dummy step)
  const dummyStep: AnimationStep = { kind: 'pause', durationMs: 100 }
  const state = documentReducer(initialDocumentState(), {
    type: 'APPLY_RESULT',
    document: doc,
    steps: [dummyStep],
    warnings: [],
  })

  return state
}

// ── a) Page actions empty pendingSteps ─────────────────────────────────

describe('ADD_PAGE empties pendingSteps', () => {
  it('after ADD_PAGE, pendingSteps is empty', () => {
    const state = stateWithPendingSteps()
    expect(state.pendingSteps.length).toBeGreaterThan(0)

    const next = documentReducer(state, { type: 'ADD_PAGE' })
    expect(next.pendingSteps).toHaveLength(0)
  })

  it('ADD_PAGE adds a page to the document', () => {
    const state = stateWithPendingSteps()
    const before = state.document.pages.length
    const next = documentReducer(state, { type: 'ADD_PAGE' })
    expect(next.document.pages.length).toBe(before + 1)
  })
})

describe('SET_ACTIVE_PAGE empties pendingSteps', () => {
  it('after SET_ACTIVE_PAGE to another index, pendingSteps is empty', () => {
    // We need at least 2 pages
    const base = stateWithPendingSteps()
    const withTwoPages = documentReducer(base, { type: 'ADD_PAGE' })
    // Seed steps again
    const dummyStep: AnimationStep = { kind: 'pause', durationMs: 100 }
    const withSteps = documentReducer(withTwoPages, {
      type: 'APPLY_RESULT',
      document: withTwoPages.document,
      steps: [dummyStep],
      warnings: [],
    })

    expect(withSteps.pendingSteps.length).toBeGreaterThan(0)
    const next = documentReducer(withSteps, { type: 'SET_ACTIVE_PAGE', index: 0 })
    expect(next.pendingSteps).toHaveLength(0)
  })
})

describe('REMOVE_PAGE empties pendingSteps', () => {
  it('after REMOVE_PAGE, pendingSteps is empty', () => {
    const base = stateWithPendingSteps()
    // Add a second page so one can be removed
    const withTwoPages = documentReducer(base, { type: 'ADD_PAGE' })
    // Seed steps
    const dummyStep: AnimationStep = { kind: 'pause', durationMs: 100 }
    const withSteps = documentReducer(withTwoPages, {
      type: 'APPLY_RESULT',
      document: withTwoPages.document,
      steps: [dummyStep],
      warnings: [],
    })

    expect(withSteps.pendingSteps.length).toBeGreaterThan(0)
    const next = documentReducer(withSteps, { type: 'REMOVE_PAGE', index: 1 })
    expect(next.pendingSteps).toHaveLength(0)
  })
})

// ── b) RESET_DOCUMENT ─────────────────────────────────────────────────────────

describe('RESET_DOCUMENT', () => {
  it('returns a document with one empty page', () => {
    const state = stateWithPendingSteps()
    const next = documentReducer(state, { type: 'RESET_DOCUMENT' })
    expect(next.document.pages).toHaveLength(1)
    expect(next.document.activeIndex).toBe(0)
    expect(next.document.pages[0]!.number).toBe(1)
    expect(activeScene(next.document).objects.size).toBe(0)
  })

  it('clears pendingSteps', () => {
    const state = stateWithPendingSteps()
    expect(state.pendingSteps.length).toBeGreaterThan(0)
    const next = documentReducer(state, { type: 'RESET_DOCUMENT' })
    expect(next.pendingSteps).toHaveLength(0)
  })

  it('clears warnings', () => {
    // Inject warnings manually with APPLY_RESULT
    const withWarnings = documentReducer(initialDocumentState(), {
      type: 'APPLY_RESULT',
      document: newDocument(),
      steps: [],
      warnings: ['test warning'],
    })
    expect(withWarnings.warnings).toContain('test warning')
    const next = documentReducer(withWarnings, { type: 'RESET_DOCUMENT' })
    expect(next.warnings).toHaveLength(0)
  })
})

// ── c) OBJECT_MOVED ───────────────────────────────────────────────────────────

describe('OBJECT_MOVED', () => {
  it('updates the box of the object on the active page', () => {
    const base = stateWithPendingSteps()
    // Object sol_1_1 is on the active page (index 0)
    const scene = activeScene(base.document)
    expect(scene.objects.has('sol_1_1')).toBe(true)

    const newBox = { x: 500, y: 500, width: 120, height: 120 }
    const next = documentReducer(base, { type: 'OBJECT_MOVED', id: 'sol_1_1', newBox })
    const updatedScene = activeScene(next.document)
    const updatedObj = updatedScene.objects.get('sol_1_1')
    expect(updatedObj?.box).toEqual(newBox)
  })

  it('changes nothing if the id is not on the active page (even if it is on another)', () => {
    // Page 1: sol_1_1; page 2: nube_2_1 (active)
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document
    doc = addPage(doc) // active = page 2
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'nube_2_1', object: 'concepto', label: 'Cloud' },
    ], ENV)
    doc = r2.document

    const state: DocumentState = {
      document: doc,
      pendingSteps: [],
      warnings: [],
      undoStack: [],
    }

    // Try to move sol_1_1 while on page 2 → no change
    const next = documentReducer(state, {
      type: 'OBJECT_MOVED',
      id: 'sol_1_1',
      newBox: { x: 999, y: 999, width: 120, height: 120 },
    })
    expect(next).toBe(state) // same reference: no change
  })
})

// ── d) applyEnvelope flow (pure logic) ──────────────────────────────────────

describe('global id collision in applyToActivePage', () => {
  it('suggested id equal to one on another page → renamed with the page 2 suffix', () => {
    // Create sol_1_1 on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document
    expect(allIds(activeScene(doc)).has('sol_1_1')).toBe(true)

    // Add page 2 and suggest EXACTLY sol_1_1 (it already exists on page 1)
    doc = addPage(doc) // page number = 2
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)

    // The draw_object event must carry an id different from sol_1_1
    const drawEvent = r2.events.find(e => e.type === 'draw_object')
    expect(drawEvent).toBeDefined()
    expect(drawEvent!.type).toBe('draw_object')
    const assignedId = (drawEvent as { type: 'draw_object'; id: string }).id
    expect(assignedId).not.toBe('sol_1_1')
    // The assigned id is built from the kind: concepto_2_1 (first free one on page 2)
    expect(assignedId).toBe('concepto_2_1')
  })
})

describe('documentToAgentState after switching to page 2', () => {
  it('does not contain the objects of page 1', () => {
    // Sun on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document

    // Move to page 2 and add a cloud
    doc = addPage(doc) // active = page 2
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'nube_2_1', object: 'concepto', label: 'Cloud' },
    ], ENV)
    doc = r2.document

    // Now the active page is 2
    expect(doc.activeIndex).toBe(1)

    const agentState = documentToAgentState(doc, CANVAS, [])
    const objectIds = agentState.objects.map(o => o.id)
    expect(objectIds).toContain('nube_2_1')
    expect(objectIds).not.toContain('sol_1_1')
  })

  it('going back to page 1 after being on page 2 shows the objects of page 1', () => {
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document
    doc = addPage(doc) // active = page 2

    // Back to page 1
    doc = setActivePage(doc, 0)
    expect(doc.activeIndex).toBe(0)

    const agentState = documentToAgentState(doc, CANVAS, [])
    const objectIds = agentState.objects.map(o => o.id)
    expect(objectIds).toContain('sol_1_1')
  })
})

// ── e) Ink actions ────────────────────────────────────────────

describe('ADD_INK_STROKE', () => {
  it('adds a stroke to the active page', () => {
    const state = stateWithPendingSteps()
    const next = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    expect(activeInk(next.document).strokes).toHaveLength(1)
    expect(activeInk(next.document).strokes[0]!.id).toBe('ink_1')
  })

  it('does NOT empty pendingSteps (ink does not interfere with the animation)', () => {
    const state = stateWithPendingSteps()
    expect(state.pendingSteps.length).toBeGreaterThan(0)
    const next = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })

  it('does not affect the ink of other pages', () => {
    // State with two pages; the second is active
    const base = stateWithPendingSteps()
    const withTwoPages = documentReducer(base, { type: 'ADD_PAGE' }) // active = index 1

    const next = documentReducer(withTwoPages, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })

    // The active page (index 1) has the stroke
    expect(activeInk(next.document).strokes).toHaveLength(1)
    // Page 0 still has no ink
    expect(next.document.pages[0]!.ink.strokes).toHaveLength(0)
  })
})

// Note: UNDO_INK_STROKE was replaced by the unified UNDO. The UNDO-specific tests
// on strokes live in the "Unified UNDO" section.
describe('UNDO (ink stroke)', () => {
  it('removes the last stroke of the active page', () => {
    const base = initialDocumentState()
    const withStroke = documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    expect(activeInk(withStroke.document).strokes).toHaveLength(1)

    const next = documentReducer(withStroke, { type: 'UNDO' })
    expect(activeInk(next.document).strokes).toHaveLength(0)
  })

  it('clears pendingSteps (the unified undo always empties them)', () => {
    const state = stateWithPendingSteps()
    const withStroke = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    const next = documentReducer(withStroke, { type: 'UNDO' })
    // The unified undo clears pendingSteps to avoid replaying over restored state
    expect(next.pendingSteps).toHaveLength(0)
  })
})

describe('REMOVE_INK_STROKE', () => {
  it('removes the stroke with the given id', () => {
    const base = initialDocumentState()
    const withTwo = documentReducer(
      documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] }),
      { type: 'ADD_INK_STROKE', points: [5, 5, 15, 15] },
    )
    expect(activeInk(withTwo.document).strokes).toHaveLength(2)

    const next = documentReducer(withTwo, { type: 'REMOVE_INK_STROKE', id: 'ink_1' })
    expect(activeInk(next.document).strokes).toHaveLength(1)
    expect(activeInk(next.document).strokes[0]!.id).toBe('ink_2')
  })

  it('NO empties pendingSteps', () => {
    const state = stateWithPendingSteps()
    const withStroke = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    const next = documentReducer(withStroke, { type: 'REMOVE_INK_STROKE', id: 'ink_1' })
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })
})

describe('SET_ACTIVE_PAGE still empties pendingSteps', () => {
  it('SET_ACTIVE_PAGE empties pendingSteps (behavior unchanged by ink actions)', () => {
    const base = stateWithPendingSteps()
    const withTwoPages = documentReducer(base, { type: 'ADD_PAGE' })
    const dummyStep: AnimationStep = { kind: 'pause', durationMs: 100 }
    const withSteps = documentReducer(withTwoPages, {
      type: 'APPLY_RESULT',
      document: withTwoPages.document,
      steps: [dummyStep],
      warnings: [],
    })
    expect(withSteps.pendingSteps.length).toBeGreaterThan(0)

    const next = documentReducer(withSteps, { type: 'SET_ACTIVE_PAGE', index: 0 })
    expect(next.pendingSteps).toHaveLength(0)
  })
})

// ── REMOVE_OBJECT ────────────────────────────────────────────────────

describe('REMOVE_OBJECT', () => {
  it('deletes an object, cascading to connections', () => {
    // Create sol_1_1 and nube_1_1 with a connection between them
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
      { op: 'add', id: 'nube_1_1', object: 'concepto', label: 'Cloud' },
      { op: 'connect', id: 'f1', from: 'sol_1_1', to: 'nube_1_1', style: 'arrow' },
    ], ENV)
    doc = r.document

    const state: DocumentState = { document: doc, pendingSteps: [], warnings: [], undoStack: [] }

    // Check the initial state
    expect(activeScene(state.document).objects.has('sol_1_1')).toBe(true)
    expect(activeScene(state.document).connections.has('f1')).toBe(true)

    // Delete sol_1_1 → must also delete f1 by cascade
    const next = documentReducer(state, { type: 'REMOVE_OBJECT', id: 'sol_1_1' })
    expect(activeScene(next.document).objects.has('sol_1_1')).toBe(false)
    expect(activeScene(next.document).connections.has('f1')).toBe(false)
    // nube_1_1 is untouched
    expect(activeScene(next.document).objects.has('nube_1_1')).toBe(true)
  })

  it('unknown id → state unchanged (same document reference)', () => {
    const state = initialDocumentState()
    const next = documentReducer(state, { type: 'REMOVE_OBJECT', id: 'no_existe' })
    // No change: same reference
    expect(next).toBe(state)
  })

  it('NO empties pendingSteps', () => {
    // Create a state with pending steps and an object in the scene
    const base = stateWithPendingSteps()
    expect(base.pendingSteps.length).toBeGreaterThan(0)
    expect(activeScene(base.document).objects.has('sol_1_1')).toBe(true)

    const next = documentReducer(base, { type: 'REMOVE_OBJECT', id: 'sol_1_1' })
    // The object was deleted
    expect(activeScene(next.document).objects.has('sol_1_1')).toBe(false)
    // But the pending steps survive
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })

  it('deletes an object that belongs to a group: it leaves the group and the group survives with the rest', () => {
    // sol_1_1 and nube_1_1 grouped in g1
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
      { op: 'add', id: 'nube_1_1', object: 'concepto', label: 'Cloud' },
      { op: 'group', id: 'g1', label: 'ciclo', members: ['sol_1_1', 'nube_1_1'] },
    ], ENV)
    doc = r.document
    const state: DocumentState = { document: doc, pendingSteps: [], warnings: [], undoStack: [] }

    // Initial state: g1 contains both members
    const grp0 = activeScene(state.document).groups.get('g1')
    expect(grp0?.members).toContain('sol_1_1')
    expect(grp0?.members).toContain('nube_1_1')

    // Delete sol_1_1 → it leaves the group; g1 survives with nube_1_1
    const next = documentReducer(state, { type: 'REMOVE_OBJECT', id: 'sol_1_1' })
    expect(activeScene(next.document).objects.has('sol_1_1')).toBe(false)
    const grp1 = activeScene(next.document).groups.get('g1')
    expect(grp1).toBeDefined()
    expect(grp1?.members).not.toContain('sol_1_1')
    expect(grp1?.members).toContain('nube_1_1')
  })

  it('deletes the only member of a group: the empty group is removed by cascade', () => {
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
      { op: 'group', id: 'g1', label: 'solo', members: ['sol_1_1'] },
    ], ENV)
    doc = r.document
    const state: DocumentState = { document: doc, pendingSteps: [], warnings: [], undoStack: [] }
    expect(activeScene(state.document).groups.has('g1')).toBe(true)

    // Delete the only member → the empty group is deleted by cascade
    const next = documentReducer(state, { type: 'REMOVE_OBJECT', id: 'sol_1_1' })
    expect(activeScene(next.document).objects.has('sol_1_1')).toBe(false)
    expect(activeScene(next.document).groups.has('g1')).toBe(false)
  })
})

// ── MOVE_INK_STROKE ────────────────────────────────────────────────

describe('MOVE_INK_STROKE', () => {
  it('translates the points of the stroke by (dx, dy)', () => {
    const base = initialDocumentState()
    const withStroke = documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 100, 100] })
    const next = documentReducer(withStroke, { type: 'MOVE_INK_STROKE', id: 'ink_1', dx: 10, dy: -5 })

    const pts = activeInk(next.document).strokes[0]!.points
    expect(pts).toEqual([10, -5, 110, 95])
  })

  it('NO empties pendingSteps', () => {
    const state = stateWithPendingSteps()
    const withStroke = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    const next = documentReducer(withStroke, { type: 'MOVE_INK_STROKE', id: 'ink_1', dx: 5, dy: 5 })
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })

  it('unknown id → no change in the strokes', () => {
    const base = initialDocumentState()
    const withStroke = documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    const next = documentReducer(withStroke, { type: 'MOVE_INK_STROKE', id: 'ink_99', dx: 5, dy: 5 })
    // The points of the existing stroke did not change
    expect(activeInk(next.document).strokes[0]!.points).toEqual([0, 0, 10, 10])
  })
})

// ── Unified UNDO ──────────────────────

describe('UNDO — empty stack → no change', () => {
  it('with an empty stack, UNDO does nothing', () => {
    const state = initialDocumentState()
    expect(state.undoStack).toHaveLength(0)
    const next = documentReducer(state, { type: 'UNDO' })
    // Same reference: no change
    expect(next).toBe(state)
  })
})

describe('UNDO — reverts ADD_INK_STROKE', () => {
  it('UNDO removes the added stroke and restores the empty ink', () => {
    const base = initialDocumentState()
    const withStroke = documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    expect(activeInk(withStroke.document).strokes).toHaveLength(1)
    expect(withStroke.undoStack).toHaveLength(1)

    const next = documentReducer(withStroke, { type: 'UNDO' })
    expect(activeInk(next.document).strokes).toHaveLength(0)
    expect(next.undoStack).toHaveLength(0)
  })

  it('UNDO after two strokes reverts only the last one', () => {
    const base = initialDocumentState()
    const s1 = documentReducer(base, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    const s2 = documentReducer(s1, { type: 'ADD_INK_STROKE', points: [20, 20, 30, 30] })
    expect(activeInk(s2.document).strokes).toHaveLength(2)
    expect(s2.undoStack).toHaveLength(2)

    const next = documentReducer(s2, { type: 'UNDO' })
    // Only the first stroke remains
    expect(activeInk(next.document).strokes).toHaveLength(1)
    expect(activeInk(next.document).strokes[0]!.id).toBe('ink_1')
    expect(next.undoStack).toHaveLength(1)
  })
})

describe('UNDO — reverts REMOVE_OBJECT', () => {
  it('UNDO after deleting an object restores the object', () => {
    // Create an object
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r.document

    let state: DocumentState = { document: doc, pendingSteps: [], warnings: [], undoStack: [] }
    expect(activeScene(state.document).objects.has('sol_1_1')).toBe(true)

    // Delete the object (through the reducer so it takes a snapshot)
    state = documentReducer(state, { type: 'REMOVE_OBJECT', id: 'sol_1_1' })
    expect(activeScene(state.document).objects.has('sol_1_1')).toBe(false)
    expect(state.undoStack).toHaveLength(1)

    // UNDO: the object must be restored
    const next = documentReducer(state, { type: 'UNDO' })
    expect(activeScene(next.document).objects.has('sol_1_1')).toBe(true)
    expect(next.undoStack).toHaveLength(0)
  })
})

describe('UNDO — stack capped at UNDO_STACK_MAX (30)', () => {
  it('after 35 ADD_INK_STROKE, the stack has exactly 30 snapshots', () => {
    let state = initialDocumentState()
    for (let i = 0; i < 35; i++) {
      state = documentReducer(state, { type: 'ADD_INK_STROKE', points: [i, i, i + 10, i + 10] })
    }
    // The stack must not grow beyond 30
    expect(state.undoStack.length).toBe(30)
  })
})

describe('UNDO — clears pendingSteps on restore', () => {
  it('UNDO empties the pending steps to avoid replay over restored state', () => {
    const state = stateWithPendingSteps()
    // Add a stroke so the stack has something
    const withStroke = documentReducer(state, { type: 'ADD_INK_STROKE', points: [0, 0, 10, 10] })
    // stateWithPendingSteps puts steps in; ADD_INK_STROKE keeps them; check
    expect(withStroke.pendingSteps.length).toBeGreaterThan(0)

    const next = documentReducer(withStroke, { type: 'UNDO' })
    expect(next.pendingSteps).toHaveLength(0)
  })
})

// ── SET_AREA_TREE (reflow + undo) ───────────────────────────────────────

describe('SET_AREA_TREE', () => {
  it('replaces the areaTree of the active page', () => {
    // Initial state: 1 page with defaultAreaTree(3)
    const state0 = initialDocumentState()
    expect(leafIds(state0.document.pages[0]!.areaTree)).toEqual(['area_1', 'area_2', 'area_3'])

    // Apply SET_AREA_TREE with a 2-column tree
    const tree2 = defaultAreaTree(2)
    const next = documentReducer(state0, { type: 'SET_AREA_TREE', areaTree: tree2, canvas: CANVAS })

    expect(leafIds(next.document.pages[0]!.areaTree)).toEqual(['area_1', 'area_2'])
  })

  it('does not modify other pages when changing the tree of the active page', () => {
    // Document with 2 pages; active = 1 (index 1)
    let state = documentReducer(initialDocumentState(), { type: 'ADD_PAGE' })
    // Page 0 has the original tree
    const tree0Before = state.document.pages[0]!.areaTree

    // Change the tree of the active page (index 1)
    const newTree = splitLeaf(defaultAreaTree(1), 'area_1', 'h', 'area_2', 'split_1')
    state = documentReducer(state, { type: 'SET_AREA_TREE', areaTree: newTree, canvas: CANVAS })

    // Page 0 did not change (same reference)
    expect(state.document.pages[0]!.areaTree).toBe(tree0Before)
    // Page 1 (active) has the new tree
    expect(leafIds(state.document.pages[1]!.areaTree)).toContain('area_2')
  })

  it('does not empty pendingSteps (the tree is app geometry, it generates no animation)', () => {
    const state = stateWithPendingSteps()
    expect(state.pendingSteps.length).toBeGreaterThan(0)

    const next = documentReducer(state, { type: 'SET_AREA_TREE', areaTree: defaultAreaTree(2), canvas: CANVAS })
    // Animation steps in progress are not cancelled
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })

  it('is immutable: the pages reference changes but the other pages are the same', () => {
    const state0 = initialDocumentState()
    const stateWith2Pages = documentReducer(state0, { type: 'ADD_PAGE' })
    const page1Before = stateWith2Pages.document.pages[1]

    const next = documentReducer(stateWith2Pages, { type: 'SET_AREA_TREE', areaTree: defaultAreaTree(2), canvas: CANVAS })
    // pages is a new array (no mutation)
    expect(next.document.pages).not.toBe(stateWith2Pages.document.pages)
    // The active page (index 1) is a new object
    expect(next.document.pages[1]).not.toBe(page1Before)
    // Page 0 is the same reference (untouched)
    expect(next.document.pages[0]).toBe(stateWith2Pages.document.pages[0])
  })

  it('generates an undo snapshot: the stack grows by 1 after SET_AREA_TREE', () => {
    const state0 = initialDocumentState()
    expect(state0.undoStack).toHaveLength(0)

    const next = documentReducer(state0, { type: 'SET_AREA_TREE', areaTree: defaultAreaTree(2), canvas: CANVAS })
    expect(next.undoStack).toHaveLength(1)
  })

  it('UNDO after SET_AREA_TREE restores the previous tree and scene in one step', () => {
    // Initial state with a 3-column tree
    const state0 = initialDocumentState()
    const treeBefore = state0.document.pages[0]!.areaTree

    // Split → 2 columns
    const tree2 = defaultAreaTree(2)
    const afterSplit = documentReducer(state0, { type: 'SET_AREA_TREE', areaTree: tree2, canvas: CANVAS })
    expect(leafIds(afterSplit.document.pages[0]!.areaTree)).toEqual(['area_1', 'area_2'])
    expect(afterSplit.undoStack).toHaveLength(1)

    // UNDO → back to the 3-column tree
    const afterUndo = documentReducer(afterSplit, { type: 'UNDO' })
    expect(afterUndo.undoStack).toHaveLength(0)
    expect(leafIds(afterUndo.document.pages[0]!.areaTree)).toEqual(leafIds(treeBefore))
  })

  it('UNDO after SET_AREA_TREE also empties pendingSteps (standard UNDO behavior)', () => {
    const state = stateWithPendingSteps()
    const afterSplit = documentReducer(state, { type: 'SET_AREA_TREE', areaTree: defaultAreaTree(2), canvas: CANVAS })
    // ADD_INK_STROKE does NOT empty pendingSteps; but UNDO always empties them
    const next = documentReducer(afterSplit, { type: 'UNDO' })
    expect(next.pendingSteps).toHaveLength(0)
  })

  it('the reflow with the new tree changes the scene (object boxes are recomputed)', () => {
    // Create a state with at least one object on the active page
    const baseState = stateWithPendingSteps() // has sol_1_1
    const scene0 = activeScene(baseState.document)
    // The boxes of every object before the reflow
    const boxes0 = Array.from(scene0.objects.values()).map((o) => o.box)
    expect(boxes0.length).toBeGreaterThan(0)

    // Switch to a very different tree (a single column)
    const next = documentReducer(baseState, {
      type: 'SET_AREA_TREE',
      areaTree: defaultAreaTree(1),
      canvas: CANVAS,
    })
    // The page's areaTree changed
    expect(leafIds(next.document.pages[0]!.areaTree)).toEqual(['area_1'])
    // The scene was replaced by a new one (reflow): the reference changes
    expect(activeScene(next.document)).not.toBe(scene0)
  })
})

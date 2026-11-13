/**
 * Tests for promoting ink to a typed object.
 *
 * a) Promotion creates an object with correct geometry: bbox, relative points,
 *    strokes removed from the ink.
 * b) Canonical id type_page_n and renaming on global collision.
 * c) sceneToAgentState exposes the promoted object correctly.
 * d) An agent op references the promoted object (connect, highlight, update).
 * e) Cascading delete removes the promoted object's connections.
 * g) Nonexistent strokeIds → no-op with null objectId.
 * h) The PROMOTE_INK reducer does not clear pendingSteps.
 */
import { describe, it, expect } from 'vitest'
import { promoteInk } from './promote.js'
import {
  newDocument,
  addPage,
  activeScene,
  activeInk,
  updateActiveInk,
  documentIds,
} from './model.js'
import { applyToActivePage } from './apply.js'
import { documentToAgentState } from './agent-state.js'
import { addStroke } from '@/ink/index.js'
import { documentReducer, initialDocumentState } from '@/hooks/useDocumentState.js'
import type { DocumentState } from '@/hooks/useDocumentState.js'
import type { AnimationStep } from '@/animation/timeline.js'
import type { SceneEnv } from '@/scene/index.js'
import { CanvasStateSchema } from '@/contract/index.js'

// ── Test environment ─────────────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 800 }

function makeMockLibrary(): SceneEnv['library'] {
  const makeMeta = (name: string, width: number, height: number, render?: 'text') => ({
    name,
    format_version: 1 as const,
    default_size: { width, height },
    anchors: {
      top: { x: width / 2, y: 0 },
      bottom: { x: width / 2, y: height },
      left: { x: 0, y: height / 2 },
      right: { x: width, y: height / 2 },
    },
    ...(render === 'text' ? { render: 'text' as const } : { stroke_order: ['cuerpo'] }),
  })

  const lib = new Map()

  const objects = [
    { name: 'sol', w: 120, h: 120 },
    { name: 'nube', w: 160, h: 100 },
    { name: 'mar', w: 200, h: 80 },
  ]

  for (const { name, w, h } of objects) {
    lib.set(name, {
      name,
      meta: makeMeta(name, w, h),
      svg: `<svg><path id="cuerpo" d="M 0 0 L ${w} ${h}"/></svg>`,
    })
  }

  lib.set('texto', {
    name: 'texto',
    meta: makeMeta('texto', 200, 40, 'text'),
    svg: null,
  })

  return lib
}

const LIBRARY = makeMockLibrary()
const ENV = { canvas: CANVAS, library: LIBRARY }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a document with one ink stroke on the active page. */
function docWithStroke(points: number[]) {
  let doc = newDocument()
  const ink = addStroke(activeInk(doc), points)
  doc = updateActiveInk(doc, ink)
  return doc
}

/** State with pending animation steps (to test that PROMOTE_INK does not clear them). */
function stateWithPendingSteps(): DocumentState {
  let doc = newDocument()
  const result = applyToActivePage(doc, [
    { op: 'add', id: 'sol_1_1', object: 'sol' },
  ], ENV)
  doc = result.document

  const dummyStep: AnimationStep = { kind: 'pause', durationMs: 100 }
  return documentReducer(initialDocumentState(), {
    type: 'APPLY_RESULT',
    document: doc,
    steps: [dummyStep],
    warnings: [],
  })
}

// ── a) Correct geometry ─────────────────────────────────────────────────────

describe('promoteInk — correct geometry', () => {
  it('creates the object with the exact bbox of the stroke', () => {
    // Stroke from (100,200) to (300,400)
    const doc = docWithStroke([100, 200, 300, 400])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(doc, [strokeId], 'sol')

    expect(objectId).not.toBeNull()
    const obj = activeScene(newDoc).objects.get(objectId!)
    expect(obj).toBeDefined()
    expect(obj!.box).toEqual({ x: 100, y: 200, width: 200, height: 200 })
  })

  it('inkGeometry points are relative to the bbox origin', () => {
    // Stroke from (100,200) to (300,400)
    const doc = docWithStroke([100, 200, 300, 400])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(doc, [strokeId], 'sol')

    const obj = activeScene(newDoc).objects.get(objectId!)
    expect(obj!.inkGeometry).toBeDefined()
    expect(obj!.inkGeometry).toHaveLength(1)
    // The origin is (100,200); the relative points must be (0,0) and (200,200)
    expect(obj!.inkGeometry![0]).toEqual([0, 0, 200, 200])
  })

  it('removes the promoted strokes from the ink', () => {
    const doc = docWithStroke([100, 200, 300, 400])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc } = promoteInk(doc, [strokeId], 'sol')

    expect(activeInk(newDoc).strokes).toHaveLength(0)
  })

  it('preserves non-promoted strokes in the ink', () => {
    // Two strokes; only the first is promoted
    let doc = newDocument()
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [0, 0, 10, 10]))
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [50, 50, 60, 60]))

    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc } = promoteInk(doc, [strokeId], 'sol')

    // Only the second stroke is left
    expect(activeInk(newDoc).strokes).toHaveLength(1)
    expect(activeInk(newDoc).strokes[0]!.id).toBe('ink_2')
  })

  it('multiple strokes → unified bbox and correct points', () => {
    let doc = newDocument()
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [0, 0, 50, 50]))
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [100, 100, 150, 150]))

    const ids = activeInk(doc).strokes.map((s) => s.id)

    const { document: newDoc, objectId } = promoteInk(doc, ids, 'sol')

    const obj = activeScene(newDoc).objects.get(objectId!)!
    // Total bbox from (0,0) to (150,150)
    expect(obj.box).toEqual({ x: 0, y: 0, width: 150, height: 150 })

    // Two entries in inkGeometry
    expect(obj.inkGeometry).toHaveLength(2)
    // First stroke: (0,0)→(50,50), relative → (0,0)→(50,50)
    expect(obj.inkGeometry![0]).toEqual([0, 0, 50, 50])
    // Second stroke: (100,100)→(150,150), relative to origin (0,0) → (100,100)→(150,150)
    expect(obj.inkGeometry![1]).toEqual([100, 100, 150, 150])
  })

  it('does not mutate the input document', () => {
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id
    const inkAntes = activeInk(doc).strokes.length

    promoteInk(doc, [strokeId], 'sol')

    expect(activeInk(doc).strokes).toHaveLength(inkAntes)
  })
})

// ── b) Canonical id and global collision ──────────────────────────────────────────

describe('promoteInk — canonical id and global collision', () => {
  it('the id has the format type_page_n', () => {
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { objectId } = promoteInk(doc, [strokeId], 'sol')

    // Page 1 (the first page of the document has number=1)
    expect(objectId).toBe('sol_1_1')
  })

  it('if sol_1_1 already exists on another page, the promoted one is sol_1_2', () => {
    // Create sol_1_1 on page 1
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'sol' },
    ], ENV)
    doc = r.document

    // Add a stroke on the same page
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [0, 0, 50, 50]))
    const strokeId = activeInk(doc).strokes[0]!.id

    const { objectId } = promoteInk(doc, [strokeId], 'sol')

    expect(objectId).toBe('sol_1_2')
  })

  it('collision with an id from ANOTHER page → renamed correctly', () => {
    // Create sol_1_1 on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'sol' },
    ], ENV)
    doc = r1.document

    // Go to page 2 (number=2), which also has ink
    doc = addPage(doc) // active = index 1, number=2

    // Add a stroke on page 2
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [10, 10, 50, 50]))
    const strokeId = activeInk(doc).strokes[0]!.id

    // sol_2_1 does not exist → first free is sol_2_1
    const { objectId } = promoteInk(doc, [strokeId], 'sol')

    expect(objectId).toBe('sol_2_1')
  })

  it('sol_1_1 exists on page 1; promoting on the active page 1: the new one is sol_1_2', () => {
    // Page 1 with an existing sol_1_1; add ink and promote
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'sol' },
    ], ENV)
    doc = r.document
    // Add page 2 and go back to page 1
    doc = addPage(doc)
    doc = { ...doc, activeIndex: 0 }

    // Add a stroke on page 1 (active)
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [200, 200, 300, 300]))
    const strokeId = activeInk(doc).strokes[0]!.id

    const { objectId } = promoteInk(doc, [strokeId], 'sol')

    // sol_1_1 exists → next free is sol_1_2
    expect(objectId).toBe('sol_1_2')
  })
})

// ── c) Agent state (sceneToAgentState) ─────────────────────────────────────────

describe('promoteInk — agent state', () => {
  it('sceneToAgentState includes the promoted object with correct id and object (no zone)', () => {
    const doc = docWithStroke([100, 100, 300, 300])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(doc, [strokeId], 'sol')

    const state = documentToAgentState(newDoc, CANVAS, [])
    const found = state.objects.find((o) => o.id === objectId)

    expect(found).toBeDefined()
    expect(found!.object).toBe('sol')
    expect(found!.label).toBeNull()
    // The agent state carries no zone
    expect((found as Record<string, unknown>)['zone']).toBeUndefined()
  })

  it('the agent state parses against CanvasStateSchema after promotion', () => {
    const doc = docWithStroke([50, 50, 200, 200])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc } = promoteInk(doc, [strokeId], 'nube')

    const state = documentToAgentState(newDoc, CANVAS, [])
    expect(() => CanvasStateSchema.parse(state)).not.toThrow()
  })
})

// ── d) Agent operations on the promoted object ───────────────────────

describe('promoteInk — agent operations on the promoted object', () => {
  it('connect from a promoted object to another object works', () => {
    // Create a sea in the scene
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'mar_1_1', object: 'mar' },
    ], ENV)
    doc = r.document

    // Add a stroke and promote
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [50, 50, 150, 150]))
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: withObj, objectId } = promoteInk(doc, [strokeId], 'nube')
    expect(objectId).not.toBeNull()

    // Connect the promoted object to the sea
    const r2 = applyToActivePage(withObj, [
      { op: 'connect', id: 'flecha_1_1', from: objectId!, to: 'mar_1_1', style: 'arrow' },
    ], ENV)

    expect(r2.warnings).toHaveLength(0)
    const conn = activeScene(r2.document).connections.get('flecha_1_1')
    expect(conn).toBeDefined()
    expect(conn!.from).toBe(objectId)
    expect(conn!.to).toBe('mar_1_1')
  })

  it('highlight on the promoted object emits the event', () => {
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: withObj, objectId } = promoteInk(doc, [strokeId], 'sol')

    const r = applyToActivePage(withObj, [
      { op: 'highlight', refs: [objectId!] },
    ], ENV)

    expect(r.warnings).toHaveLength(0)
    const evt = r.events.find((e) => e.type === 'highlight')
    expect(evt).toBeDefined()
  })

  it('update label on the promoted object works', () => {
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: withObj, objectId } = promoteInk(doc, [strokeId], 'sol')

    const r = applyToActivePage(withObj, [
      { op: 'update', ref: objectId!, set: { label: 'mi sol' } },
    ], ENV)

    expect(r.warnings).toHaveLength(0)
    const obj = activeScene(r.document).objects.get(objectId!)
    expect(obj!.label).toBe('mi sol')
  })
})

// ── e) cascading delete ──────────────────────────────────────────────────────

describe('promoteInk — cascading delete', () => {
  it('deleting the promoted object also deletes its connections', () => {
    // Create a sea in the scene
    let doc = newDocument()
    const r = applyToActivePage(doc, [
      { op: 'add', id: 'mar_1_1', object: 'mar' },
    ], ENV)
    doc = r.document

    // Promote a stroke
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [50, 50, 150, 150]))
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: withObj, objectId } = promoteInk(doc, [strokeId], 'nube')

    // Connect
    const r2 = applyToActivePage(withObj, [
      { op: 'connect', id: 'flecha_1_1', from: objectId!, to: 'mar_1_1', style: 'arrow' },
    ], ENV)

    // Delete the promoted object
    const r3 = applyToActivePage(r2.document, [
      { op: 'delete', ref: objectId! },
    ], ENV)

    const finalScene = activeScene(r3.document)
    expect(finalScene.objects.has(objectId!)).toBe(false)
    // The connection must also have been deleted in cascade
    expect(finalScene.connections.has('flecha_1_1')).toBe(false)
  })
})

// ── g) nonexistent strokeIds → no-op ────────────────────────────────────────

describe('promoteInk — nonexistent strokeIds', () => {
  it('empty list → unchanged and null objectId', () => {
    const doc = docWithStroke([0, 0, 100, 100])

    const { document: newDoc, objectId } = promoteInk(doc, [], 'sol')

    expect(objectId).toBeNull()
    // Unchanged document: identical reference
    expect(newDoc).toBe(doc)
  })

  it('nonexistent id → unchanged and null objectId', () => {
    const doc = docWithStroke([0, 0, 100, 100])

    const { document: newDoc, objectId } = promoteInk(doc, ['id_que_no_existe'], 'sol')

    expect(objectId).toBeNull()
    expect(newDoc).toBe(doc)
  })

  it('mix of existing and nonexistent ids → promotes only the existing ones', () => {
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(
      doc,
      [strokeId, 'id_fantasma'],
      'sol',
    )

    expect(objectId).not.toBeNull()
    // The real stroke was promoted
    expect(activeInk(newDoc).strokes).toHaveLength(0)
  })
})

// ── h) PROMOTE_INK reducer does not clear pendingSteps ─────────────────────────────

describe('PROMOTE_INK in the reducer', () => {
  it('does not clear pendingSteps', () => {
    // State with pending steps
    const base = stateWithPendingSteps()
    expect(base.pendingSteps.length).toBeGreaterThan(0)

    // Add an ink stroke
    const withStroke = documentReducer(base, {
      type: 'ADD_INK_STROKE',
      points: [0, 0, 100, 100],
    })
    const strokeId = activeInk(withStroke.document).strokes[0]!.id

    // Promote
    const next = documentReducer(withStroke, {
      type: 'PROMOTE_INK',
      strokeIds: [strokeId],
      objectType: 'sol',
    })

    // pendingSteps stays intact
    expect(next.pendingSteps.length).toBeGreaterThan(0)
  })

  it('creates the object in the active scene', () => {
    const base = initialDocumentState()
    const withStroke = documentReducer(base, {
      type: 'ADD_INK_STROKE',
      points: [10, 20, 100, 200],
    })
    const strokeId = activeInk(withStroke.document).strokes[0]!.id

    const next = documentReducer(withStroke, {
      type: 'PROMOTE_INK',
      strokeIds: [strokeId],
      objectType: 'sol',
    })

    const scene = activeScene(next.document)
    expect(scene.objects.size).toBe(1)

    const obj = Array.from(scene.objects.values())[0]!
    expect(obj.object).toBe('sol')
    expect(obj.inkGeometry).toBeDefined()
    // The stroke is no longer in the ink
    expect(activeInk(next.document).strokes).toHaveLength(0)
  })

  it('nonexistent strokeIds in PROMOTE_INK → unchanged', () => {
    const base = initialDocumentState()

    const next = documentReducer(base, {
      type: 'PROMOTE_INK',
      strokeIds: ['id_inexistente'],
      objectType: 'sol',
    })

    expect(activeScene(next.document).objects.size).toBe(0)
  })
})

// ── i) Stroke color → object color ───────────────

describe('promoteInk — color of the promoted stroke', () => {
  it('promoting colored strokes → SceneObject has that color', () => {
    // Build a document with a stroke of color 'azul'
    let doc = newDocument()
    const inkConColor = addStroke(activeInk(doc), [10, 10, 100, 100], 'azul')
    doc = updateActiveInk(doc, inkConColor)
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(doc, [strokeId], 'sol')

    expect(objectId).not.toBeNull()
    const obj = activeScene(newDoc).objects.get(objectId!)
    expect(obj).toBeDefined()
    expect(obj!.color).toBe('azul')
  })

  it('promoting strokes without color → undefined color on the SceneObject', () => {
    const doc = docWithStroke([20, 20, 80, 80])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: newDoc, objectId } = promoteInk(doc, [strokeId], 'sol')

    expect(objectId).not.toBeNull()
    const obj = activeScene(newDoc).objects.get(objectId!)
    expect(obj).toBeDefined()
    expect(obj!.color).toBeUndefined()
  })

  it('several strokes: uses the color of the first one that has a color', () => {
    // First stroke without color, second with color 'verde'
    let doc = newDocument()
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [0, 0, 50, 50]))      // no color
    doc = updateActiveInk(doc, addStroke(activeInk(doc), [60, 60, 110, 110], 'verde')) // with color
    const ids = activeInk(doc).strokes.map((s) => s.id)

    const { document: newDoc, objectId } = promoteInk(doc, ids, 'sol')

    const obj = activeScene(newDoc).objects.get(objectId!)
    // The first one with a color is the second stroke → 'verde'
    expect(obj!.color).toBe('verde')
  })
})

// ── documentIds after promotion ──────────────────────

describe('documentIds after promotion', () => {
  it('the id of the promoted object appears in documentIds of the other pages', () => {
    // Promote on page 1
    const doc = docWithStroke([0, 0, 100, 100])
    const strokeId = activeInk(doc).strokes[0]!.id

    const { document: withObj, objectId } = promoteInk(doc, [strokeId], 'sol')
    expect(objectId).not.toBeNull()

    // Go to page 2 (number 2)
    const withPage2 = addPage(withObj)

    // Ids outside page 2 include the promoted object on page 1
    const extIds = documentIds(withPage2, withPage2.activeIndex)
    expect(extIds.has(objectId!)).toBe(true)
  })
})

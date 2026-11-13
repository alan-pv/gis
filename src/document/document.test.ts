/**
 * Tests for the multi-page document module.
 *
 * a) newDocument: 1 empty page, number 1, active.
 * b) addPage: appends at the end, the new page becomes active, consecutive numbers.
 * c) setActivePage: switches; out-of-range index → unchanged.
 * d) removePage: with 1 page → unchanged. Removing the active page → the previous
 *    one becomes active. Removing a non-active page → the active page stays the same.
 *    Page numbers are not recycled after deletion.
 * e) Global id collisions: ids on page 2 do not collide with those on page 1;
 *    a suggested id equal to one on another page → renamed.
 * f) clear on the active page does not touch other pages.
 * g) documentToAgentState reflects only the active page.
 * h) applyToActivePage does not mutate the input document.
 */
import { describe, it, expect } from 'vitest'
import {
  newDocument,
  addPage,
  removePage,
  setActivePage,
  activePage,
  activeScene,
  activeInk,
  updateActiveInk,
  documentIds,
} from './model.js'
import { leafIds, defaultAreaTree } from '@/layout/index.js'
import { applyToActivePage } from './apply.js'
import { documentToAgentState } from './agent-state.js'
import { allIds } from '@/scene/index.js'
import { CanvasStateSchema } from '@/contract/index.js'
import type { Operation } from '@/contract/index.js'
import { addStroke } from '@/ink/index.js'

// ── Test environment ─────────────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 800 }

const ENV = { canvas: CANVAS }

// ── a) newDocument ─────────────────────────────────────────────────────────────

describe('newDocument', () => {
  it('creates a document with 1 empty page', () => {
    const doc = newDocument()
    expect(doc.pages.length).toBe(1)
    expect(doc.activeIndex).toBe(0)
  })

  it('the first page has number 1', () => {
    const doc = newDocument()
    expect(doc.pages[0]!.number).toBe(1)
  })

  it('the initial scene is empty', () => {
    const doc = newDocument()
    const scene = activeScene(doc)
    expect(scene.objects.size).toBe(0)
    expect(scene.connections.size).toBe(0)
    expect(scene.groups.size).toBe(0)
  })

  it('nextPageNumber is 2', () => {
    const doc = newDocument()
    expect(doc.nextPageNumber).toBe(2)
  })
})

// ── b) addPage ─────────────────────────────────────────────────────────────────

describe('addPage', () => {
  it('appends a page at the end and makes it active', () => {
    const doc = addPage(newDocument())
    expect(doc.pages.length).toBe(2)
    expect(doc.activeIndex).toBe(1)
  })

  it('the new page has the number following the original', () => {
    const doc = addPage(newDocument())
    expect(doc.pages[1]!.number).toBe(2)
  })

  it('consecutive numbers when adding several pages', () => {
    const doc = addPage(addPage(addPage(newDocument())))
    expect(doc.pages.map((p) => p.number)).toEqual([1, 2, 3, 4])
    expect(doc.activeIndex).toBe(3)
  })

  it('nextPageNumber increments with each addPage', () => {
    const doc = addPage(addPage(newDocument()))
    expect(doc.nextPageNumber).toBe(4)
  })

  it('the new page has an empty scene', () => {
    const doc = addPage(newDocument())
    const scene = activeScene(doc)
    expect(scene.objects.size).toBe(0)
  })
})

// ── c) setActivePage ──────────────────────────────────────────────────────────

describe('setActivePage', () => {
  it('switches the active page to a valid index', () => {
    const doc = setActivePage(addPage(newDocument()), 0)
    expect(doc.activeIndex).toBe(0)
  })

  it('negative index → unchanged', () => {
    const doc = addPage(newDocument())
    const result = setActivePage(doc, -1)
    expect(result.activeIndex).toBe(doc.activeIndex)
    expect(result).toBe(doc) // same reference (unchanged)
  })

  it('index equal to pages.length → unchanged', () => {
    const doc = addPage(newDocument())
    const result = setActivePage(doc, 2)
    expect(result).toBe(doc)
  })

  it('index greater than pages.length → unchanged', () => {
    const doc = newDocument()
    const result = setActivePage(doc, 99)
    expect(result).toBe(doc)
  })
})

// ── d) removePage ─────────────────────────────────────────────────────────────

describe('removePage', () => {
  it('with 1 page → unchanged', () => {
    const doc = newDocument()
    const result = removePage(doc, 0)
    expect(result).toBe(doc)
  })

  it('invalid index (negative) → unchanged', () => {
    const doc = addPage(newDocument())
    const result = removePage(doc, -1)
    expect(result).toBe(doc)
  })

  it('invalid index (out of range) → unchanged', () => {
    const doc = addPage(newDocument())
    const result = removePage(doc, 5)
    expect(result).toBe(doc)
  })

  it('removing the active page → the previous one becomes active', () => {
    // Two pages: [0, 1], active is 1 → remove 1 → active becomes 0
    const doc = addPage(newDocument()) // active = 1
    const result = removePage(doc, 1)
    expect(result.pages.length).toBe(1)
    expect(result.activeIndex).toBe(0)
  })

  it('removing the first (active) page → the next one becomes active', () => {
    // Three pages: [0, 1, 2], active is 0 → remove 0 → active stays 0 (was 1)
    const doc = setActivePage(addPage(addPage(newDocument())), 0) // active = 0
    const result = removePage(doc, 0)
    expect(result.pages.length).toBe(2)
    expect(result.activeIndex).toBe(0) // the "next" one after removing the first
  })

  it('removing a non-active page → the active page stays the same', () => {
    // Three pages: [p1, p2, p3], active = 2 (p3) → remove index 0 (p1)
    // → the active page is still p3, now at index 1
    const doc = addPage(addPage(newDocument())) // active = 2, pages: p1,p2,p3
    const activeBefore = activePage(doc)
    const result = removePage(doc, 0)
    expect(result.pages.length).toBe(2)
    // The same page (same stable number) is still active
    expect(activePage(result).number).toBe(activeBefore.number)
    // Its new index is 1 (it dropped by one because an earlier page was removed)
    expect(result.activeIndex).toBe(1)
  })

  it('page numbers are not recycled after deletion', () => {
    // Create doc with p1; addPage → p2 active; remove p1 (index 0);
    // addPage → the new page has number=3, not number=2
    let doc = newDocument()          // [p1], nextPageNumber=2
    doc = addPage(doc)               // [p1,p2], active=1, nextPageNumber=3
    doc = removePage(doc, 0)         // [p2], active=0, nextPageNumber=3 (unchanged)
    doc = addPage(doc)               // [p2,p3], active=1, nextPageNumber=4
    expect(doc.pages[1]!.number).toBe(3)
  })
})

// ── e) Global id collisions ──────────────────────────────────────────────────

describe('global id collisions across pages', () => {
  it('an id on page 2 does not collide with an id on page 1 (different page number)', () => {
    // Apply "sol" on page 1 suggesting sol_1_1 (free → stays sol_1_1)
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document

    // The resulting canonical id is the suggested one (it was free)
    const ids1 = allIds(activeScene(doc))
    expect(ids1.has('sol_1_1')).toBe(true)

    // Switch to page 2 and apply another "sol" with any suggested id
    doc = addPage(doc) // active = page 2, number=2
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_sugerido', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r2.document

    const ids2 = allIds(activeScene(doc))
    // The suggested id "sol_sugerido" is free on page 2 → kept as is
    expect(ids2.has('sol_sugerido')).toBe(true)
    // sol_1_1 is not on page 2
    expect(ids2.has('sol_1_1')).toBe(false)
  })

  it('suggested id equal to one on another page → renamed', () => {
    // Create sol_1_1 on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document

    // Switch to page 2 and suggest EXACTLY sol_1_1 (already exists on page 1)
    doc = addPage(doc) // page number = 2
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)

    // The draw_object event must carry an id different from sol_1_1
    const drawEvent = r2.events.find((e) => e.type === 'draw_object')
    expect(drawEvent).toBeDefined()
    expect(drawEvent!.type).toBe('draw_object')
    // The canonical id cannot be sol_1_1 (already taken by page 1)
    expect((drawEvent as { type: 'draw_object'; id: string }).id).not.toBe('sol_1_1')
    // It must be concepto_2_1 (first free on page 2)
    expect((drawEvent as { type: 'draw_object'; id: string }).id).toBe('concepto_2_1')
  })
})

// ── f) clear only affects the active page ───────────────────────────────────

describe('clear only affects the active page', () => {
  it('clear on page 2 does not touch the scene of page 1', () => {
    // Add a sol on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document

    // Switch to page 2 and clear
    doc = addPage(doc)
    const r2 = applyToActivePage(doc, [{ op: 'clear' }], ENV)
    doc = r2.document

    // Page 1 is still intact
    const scene1 = doc.pages[0]!.scene
    expect(scene1.objects.size).toBe(1)
  })

  it('clear on the active page empties its scene', () => {
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document
    expect(activeScene(doc).objects.size).toBe(1)

    const r2 = applyToActivePage(doc, [{ op: 'clear' }], ENV)
    doc = r2.document
    expect(activeScene(doc).objects.size).toBe(0)
  })
})

// ── g) documentToAgentState reflects only the active page ─────────────────────

describe('documentToAgentState', () => {
  it('reflects only the objects of the active page', () => {
    // Sol on page 1
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document

    // Switch to page 2 and add a cloud
    doc = addPage(doc)
    const r2 = applyToActivePage(doc, [
      { op: 'add', id: 'nube_2_1', object: 'concepto', label: 'Cloud' },
    ], ENV)
    doc = r2.document

    // The agent state only sees page 2 (active)
    const state = documentToAgentState(doc, CANVAS, [])
    const objectIds = state.objects.map((o) => o.id)
    expect(objectIds).toContain('nube_2_1')
    expect(objectIds).not.toContain('sol_1_1')
  })

  it('the agent state parses against CanvasStateSchema', () => {
    const doc = newDocument()
    const state = documentToAgentState(doc, CANVAS, ['the sun heats the water'])
    expect(() => CanvasStateSchema.parse(state)).not.toThrow()
  })

  it('recent_utterances is passed through unmodified (global window)', () => {
    const utterances = ['the sun heats', 'the water evaporates']
    const doc = newDocument()
    const state = documentToAgentState(doc, CANVAS, utterances)
    expect(state.recent_utterances).toEqual(utterances)
  })
})

// ── h) applyToActivePage does not mutate the input document ──────────────────────

describe('applyToActivePage immutability', () => {
  it('the original scene of the active page is left intact', () => {
    const doc = newDocument()
    const sceneAntes = activeScene(doc)
    expect(sceneAntes.objects.size).toBe(0)

    applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)

    // The original document did not change
    expect(activeScene(doc).objects.size).toBe(0)
    expect(activeScene(doc)).toBe(sceneAntes) // same reference
  })

  it('the pages array of the original document is not mutated', () => {
    const doc = newDocument()
    const pagesAntes = doc.pages

    const { document: newDoc } = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)

    // The original array is still the same object
    expect(doc.pages).toBe(pagesAntes)
    // The new document has a different array
    expect(newDoc.pages).not.toBe(pagesAntes)
  })

  it('documentIds reflects the ids of the other pages', () => {
    let doc = newDocument()
    const r1 = applyToActivePage(doc, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    doc = r1.document
    doc = addPage(doc)

    // Ids outside the active page (index 1) include sol_1_1 from page 1
    const extIds = documentIds(doc, doc.activeIndex)
    expect(extIds.has('sol_1_1')).toBe(true)
  })
})

// ── i) Ink per page ─────────────────────────────────────────────

describe('ink per page', () => {
  it('new pages have empty ink', () => {
    const doc = newDocument()
    const ink = activeInk(doc)
    expect(ink.strokes).toHaveLength(0)
    expect(ink.nextStrokeId).toBe(1)
  })

  it('addPage creates a page with empty ink', () => {
    const doc = addPage(newDocument())
    const ink = activeInk(doc)
    expect(ink.strokes).toHaveLength(0)
  })

  it('updateActiveInk only modifies the active page', () => {
    // Two pages; the active one is the second (index 1)
    let doc = addPage(newDocument())
    const inkWithStroke = addStroke(activeInk(doc), [0, 0, 10, 10])
    doc = updateActiveInk(doc, inkWithStroke)

    // The active page (index 1) has the stroke
    expect(activeInk(doc).strokes).toHaveLength(1)
    // Page 0 still has empty ink
    expect(doc.pages[0]!.ink.strokes).toHaveLength(0)
  })

  it('round-trip of setActivePage preserves the ink of each page', () => {
    // Add a stroke on page 1 (index 0)
    let doc = newDocument()
    const ink1 = addStroke(activeInk(doc), [1, 1, 2, 2])
    doc = updateActiveInk(doc, ink1)

    // Go to page 2 and add another stroke
    doc = addPage(doc) // active = index 1
    const ink2 = addStroke(activeInk(doc), [5, 5, 6, 6])
    doc = updateActiveInk(doc, ink2)

    // Back to page 1
    doc = setActivePage(doc, 0)
    expect(activeInk(doc).strokes).toHaveLength(1)
    expect(activeInk(doc).strokes[0]!.id).toBe('ink_1')

    // Back to page 2
    doc = setActivePage(doc, 1)
    expect(activeInk(doc).strokes).toHaveLength(1)
    expect(activeInk(doc).strokes[0]!.id).toBe('ink_1')
  })

  it('removePage deletes the page together with its ink', () => {
    // Add a stroke on the first page
    let doc = newDocument()
    const ink = addStroke(activeInk(doc), [0, 0, 10, 10])
    doc = updateActiveInk(doc, ink)

    // Add a second page (no ink)
    doc = addPage(doc) // active = index 1
    // Remove the first page (index 0)
    doc = removePage(doc, 0)

    // Only one page is left; the active one has empty ink (it was page 2)
    expect(doc.pages).toHaveLength(1)
    expect(activeInk(doc).strokes).toHaveLength(0)
  })

  it('documentToAgentState produces the same CanvasState with or without ink', () => {
    // Document without ink
    let docWithoutInk = newDocument()
    const r = applyToActivePage(docWithoutInk, [
      { op: 'add', id: 'sol_1_1', object: 'concepto', label: 'Sun' },
    ], ENV)
    docWithoutInk = r.document

    // Same document with ink added
    const inkWithStroke = addStroke(activeInk(docWithoutInk), [10, 10, 50, 50])
    const docWithInk = updateActiveInk(docWithoutInk, inkWithStroke)

    const stateWithoutInk = documentToAgentState(docWithoutInk, CANVAS, [])
    const stateWithInk = documentToAgentState(docWithInk, CANVAS, [])

    // The agent state must be identical (ink is invisible to the agent)
    expect(stateWithInk).toEqual(stateWithoutInk)
  })
})

// ── j) areaTree per page ───────────────────────────────────────────────

describe('areaTree per page', () => {
  it('newDocument().pages[0] has areaTree = defaultAreaTree(3)', () => {
    const doc = newDocument()
    const page = doc.pages[0]!
    expect(page.areaTree).toBeDefined()
    // Compare by leafIds: [area_1, area_2, area_3]
    expect(leafIds(page.areaTree)).toEqual(leafIds(defaultAreaTree(3)))
  })

  it('addPage creates a new page with areaTree = defaultAreaTree(3)', () => {
    const doc = addPage(newDocument())
    const newPg = doc.pages[1]!
    expect(newPg.areaTree).toBeDefined()
    expect(leafIds(newPg.areaTree)).toEqual(leafIds(defaultAreaTree(3)))
  })

  it('the areaTree of page 1 does not change when page 2 is added', () => {
    const doc0 = newDocument()
    const tree0 = doc0.pages[0]!.areaTree
    const doc1 = addPage(doc0)
    // The areaTree reference of page 0 is the same (it does not move)
    expect(doc1.pages[0]!.areaTree).toBe(tree0)
  })
})

// ── k) group with non-canonical ids ──────────────────────────────────────────
//
// Providers may suggest free-format ids and group ids ("texto_N", "grupo_1")
// that do not follow the canonical object_page_n format. Such ids must not
// yield out-of-bounds or degenerate boxes, in live mode or in slide mode.
describe('group with non-canonical ids', () => {
  const HIBRIDO_BATCHES: Operation[][] = [
    [{ op: 'add', id: 'texto_1', object: 'texto', text: 'The Digestive System', role: 'titulo' }],
    [{ op: 'add', id: 'texto_2', object: 'texto', text: 'Where does food go after swallowing?', role: 'subtitulo' }],
    [
      { op: 'add', id: 'texto_3', object: 'texto', text: 'The Digestive System', role: 'subtitulo', group: 'grupo_1' },
      { op: 'add', id: 'texto_4', object: 'texto', text: 'It breaks down food into nutrients', role: 'cuerpo', group: 'grupo_1' },
    ],
    [{ op: 'add', id: 'texto_5', object: 'texto', text: 'Breaking food down into small pieces', role: 'subtitulo', group: 'grupo_1' }],
    [{ op: 'add', id: 'texto_6', object: 'texto', text: 'The Journey Begins in the Mouth', role: 'subtitulo', group: 'grupo_1' }],
    [{ op: 'add', id: 'texto_7', object: 'texto', text: 'The Teeth Break Food Into Smaller Pieces', role: 'subtitulo', group: 'grupo_1' }],
    [{ op: 'add', id: 'texto_8', object: 'texto', text: 'It breaks food down into tiny pieces', role: 'cuerpo', group: 'grupo_1' }],
    [{ op: 'add', id: 'texto_9', object: 'texto', text: 'The digestive system empties into the stomach', role: 'subtitulo', group: 'grupo_1' }],
    [{ op: 'add', id: 'texto_10', object: 'texto', text: 'A pouch that receives everything we ate', role: 'cuerpo', group: 'grupo_1' }],
    [{ op: 'highlight', refs: ['grupo_1'] }],
    [{ op: 'add', id: 'texto_11', object: 'texto', text: 'The Digestive System', role: 'subtitulo', group: 'grupo_1' }],
  ]

  function replay(mode: 'live' | 'slide') {
    let doc = newDocument()
    for (const ops of HIBRIDO_BATCHES) {
      const result = applyToActivePage(doc, ops, ENV, mode)
      expect(result.warnings, `no warnings in ${mode} mode`).toEqual([])
      doc = result.document
    }
    return activeScene(doc)
  }

  it.each(['live', 'slide'] as const)('%s mode: the 11 adds + 1 highlight are accepted and end up in the scene', (mode) => {
    const scene = replay(mode)
    expect(scene.objects.size).toBe(11)
    expect(scene.groups.size).toBe(1)
    const group = scene.groups.get('grupo_1')
    expect(group).toBeDefined()
    expect(group!.members).toEqual([
      'texto_3', 'texto_4', 'texto_5', 'texto_6', 'texto_7',
      'texto_8', 'texto_9', 'texto_10', 'texto_11',
    ])
  })

  it.each(['live', 'slide'] as const)('%s mode: all boxes (grouped or not) have finite geometry inside the canvas', (mode) => {
    const scene = replay(mode)
    const boxes = [...scene.objects.values()].map(o => o.box)

    // No box may fall outside the board area or have degenerate dimensions
    // (NaN, negative, zero). Overlap is not checked: the subtitle that opens a
    // group and its first body touch by design (opening strip).
    for (const box of boxes) {
      expect(Number.isFinite(box.x)).toBe(true)
      expect(Number.isFinite(box.y)).toBe(true)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(CANVAS.width)
      expect(box.y + box.height).toBeLessThanOrEqual(CANVAS.height)
    }
  })
})

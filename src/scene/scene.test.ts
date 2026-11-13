/**
 * Unit tests for the scene engine.
 *
 * Covers:
 * - add (position is computed by the layout, in arrival order)
 * - duplicate add -> rename + alias works
 * - connect (curve/anchors are optional on SceneConnection, for app use)
 * - connect to a group
 * - label / update label / text
 * - delete object -> cascade to connections + leaves its groups
 * - delete group -> removes members and their connections
 * - ungroup keeps members
 * - clear
 * - events in the exact order of the ops
 * - unknown ref -> warning without throw, scene intact
 * - sceneToAgentState parses against CanvasStateSchema (no zone)
 * - immutability (the input scene did not change)
 * - add with group (membership declared at creation)
 */
import { describe, it, expect } from 'vitest'
import { emptyScene, allIds, groupBBox } from './model.js'
import { applyOperations } from './apply.js'
import { sceneToAgentState } from './agent-state.js'
import { CanvasStateSchema } from '@/contract/index.js'
import type { SceneEnv, SceneEvent } from './apply.js'

// ── Test environment ──────────────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 800 }

/**
 * Minimal library for tests (no need to load files from disk).
 * Mocks the objects we need: sol, nube, texto, lluvia, mar.
 */
function makeMockLibrary(): SceneEnv['library'] {
  const makeMeta = (
    name: string,
    width: number,
    height: number,
    render?: 'text',
  ) => ({
    name,
    format_version: 1 as const,
    default_size: { width, height },
    anchors: {
      top: { x: width / 2, y: 0 },
      bottom: { x: width / 2, y: height },
      left: { x: 0, y: height / 2 },
      right: { x: width, y: height / 2 },
    },
    ...(render === 'text'
      ? { render: 'text' as const }
      : { stroke_order: ['cuerpo'] }),
  })

  const lib = new Map()

  const objects = [
    { name: 'sol', w: 120, h: 120 },
    { name: 'nube', w: 160, h: 100 },
    { name: 'mar', w: 200, h: 80 },
    { name: 'lluvia', w: 80, h: 120 },
    { name: 'circulo', w: 80, h: 80 },
    { name: 'rectangulo', w: 120, h: 80 },
  ]

  for (const { name, w, h } of objects) {
    lib.set(name, {
      name,
      meta: makeMeta(name, w, h),
      svg: `<svg><path id="cuerpo"/></svg>`,
    })
  }

  lib.set('texto', {
    name: 'texto',
    meta: makeMeta('texto', 200, 40, 'text'),
    svg: null,
  })

  return lib
}

const ENV: SceneEnv = { canvas: CANVAS, library: makeMockLibrary() }

// ── Test helpers ──────────────────────────────────────────────────────────────

function eventTypes(events: SceneEvent[]): string[] {
  return events.map((e) => e.type)
}

// ── Model tests ────────────────────────────────────────────────────────────────

describe('scene model', () => {
  it('emptyScene produces an empty scene', () => {
    const s = emptyScene()
    expect(s.objects.size).toBe(0)
    expect(s.connections.size).toBe(0)
    expect(s.groups.size).toBe(0)
  })

  it('allIds returns all object, connection and group ids', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'flecha_1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'group', id: 'grupo_1', members: ['sol_1', 'nube_1'] },
      ],
      ENV,
    )
    const ids = allIds(scene)
    expect(ids.has('sol_1')).toBe(true)
    expect(ids.has('nube_1')).toBe(true)
    expect(ids.has('flecha_1')).toBe(true)
    expect(ids.has('grupo_1')).toBe(true)
  })

  it('groupBBox computes the union of member boxes', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'a', object: 'circulo' },
        { op: 'add', id: 'b', object: 'circulo' },
        { op: 'group', id: 'g', members: ['a', 'b'] },
      ],
      ENV,
    )
    const box = groupBBox(scene, 'g')
    expect(box).not.toBeNull()
    const aBox = scene.objects.get('a')!.box
    const bBox = scene.objects.get('b')!.box
    expect(box!.x).toBe(Math.min(aBox.x, bBox.x))
    expect(box!.y).toBe(Math.min(aBox.y, bBox.y))
  })

})

// ── add tests ──────────────────────────────────────────────────────────────────

describe('add', () => {
  it('adds an object: its box is resolved in the scene', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    expect(scene.objects.has('sol_1')).toBe(true)
    const obj = scene.objects.get('sol_1')!
    // Valid box: positive dimensions and inside the canvas
    expect(obj.box.width).toBeGreaterThan(0)
    expect(obj.box.height).toBeGreaterThan(0)
    expect(obj.box.x).toBeGreaterThanOrEqual(0)
    expect(obj.box.y).toBeGreaterThanOrEqual(0)
    expect(obj.box.x + obj.box.width).toBeLessThanOrEqual(CANVAS.width)
    expect(obj.box.y + obj.box.height).toBeLessThanOrEqual(CANVAS.height)

    expect(eventTypes(events)).toEqual(['draw_object'])
    expect((events[0] as { type: 'draw_object'; id: string }).id).toBe('sol_1')
  })

  it('adding several objects: each has positive dimensions', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'add', id: 'nube_1', object: 'nube' },
      ],
      ENV,
    )
    expect(scene.objects.has('mar_1')).toBe(true)
    expect(scene.objects.has('nube_1')).toBe(true)
    const mar = scene.objects.get('mar_1')!
    const nube = scene.objects.get('nube_1')!
    expect(mar.box.width).toBeGreaterThan(0)
    expect(nube.box.width).toBeGreaterThan(0)
  })

  it('duplicate add -> renamed in type_page_n format', () => {
    const { scene, warnings } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'sol_1', object: 'sol' },
      ],
      ENV,
    )
    // The first keeps the suggested id
    expect(scene.objects.has('sol_1')).toBe(true)
    // The second must have been renamed to sol_1_1
    expect(scene.objects.has('sol_1_1')).toBe(true)
    expect(scene.objects.size).toBe(2)
    // No warnings for the rename (it is silent)
    expect(warnings.length).toBe(0)
  })

  it('alias works: a later connect to the duplicated suggested id connects to the renamed one', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        // Second add with the same suggested id "sol_1" but a nube object.
        { op: 'add', id: 'sol_1', object: 'nube' },
        { op: 'add', id: 'mar_1', object: 'mar' },
        {
          op: 'connect',
          id: 'f1',
          from: 'mar_1',
          to: 'sol_1', // alias of the second add -> nube_1_1
          style: 'arrow',
        },
      ],
      ENV,
    )
    const conn = scene.connections.get('f1')
    expect(conn).toBeDefined()
    expect(conn!.from).toBe('mar_1')
    expect(conn!.to).toBe('nube_1_1')
    expect(eventTypes(events)).toEqual([
      'draw_object',
      'draw_object',
      'draw_object',
      'draw_connection',
    ])
  })

  it('connect to the duplicated suggested id uses the right alias', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_existente', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        // duplicate -> alias nube_1 -> nube_1_1
        { op: 'add', id: 'nube_1', object: 'nube' },
        {
          op: 'connect',
          id: 'f2',
          from: 'sol_existente',
          to: 'nube_1',   // resolved by alias -> nube_1_1
          style: 'line',
        },
      ],
      ENV,
    )
    const conn = scene.connections.get('f2')
    expect(conn).toBeDefined()
    expect(conn!.from).toBe('sol_existente')
    expect(conn!.to).toBe('nube_1_1')
  })

  // ── add with group ──────────────────────────────────────────────────────────

  it('add with group creates the group implicitly if it did not exist', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'verteb_1', object: 'texto', text: 'Vertebrados', group: 'col_verteb' },
      ],
      ENV,
    )
    // The object was created
    expect(scene.objects.has('verteb_1')).toBe(true)
    // The group was created implicitly with col_verteb as its id
    expect(scene.groups.has('col_verteb')).toBe(true)
    const grp = scene.groups.get('col_verteb')!
    expect(grp.members).toContain('verteb_1')
    // The group event is emitted BEFORE draw_object
    expect(eventTypes(events)).toEqual(['group', 'draw_object'])
  })

  it('add with an existing group grows the group (create-or-grow)', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'verteb_1', object: 'texto', group: 'col_verteb' },
        { op: 'add', id: 'verteb_def_1', object: 'texto', group: 'col_verteb' },
      ],
      ENV,
    )
    // Both objects in the same group
    const grp = scene.groups.get('col_verteb')!
    expect(grp.members).toContain('verteb_1')
    expect(grp.members).toContain('verteb_def_1')
    expect(grp.members.length).toBe(2)
  })

  it('add without group creates no group', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    expect(scene.groups.size).toBe(0)
  })
})

// ── connect tests ──────────────────────────────────────────────────────────────

describe('connect', () => {
  it('plain connect: stored in the scene with the right fields', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        {
          op: 'connect',
          id: 'flecha_eva',
          from: 'mar_1',
          to: 'nube_1',
          style: 'arrow',
          label: 'evaporación',
          // curve, from_anchor, to_anchor are not declared in the op
        },
      ],
      ENV,
    )
    const conn = scene.connections.get('flecha_eva')
    expect(conn).toBeDefined()
    expect(conn!.from).toBe('mar_1')
    expect(conn!.to).toBe('nube_1')
    expect(conn!.style).toBe('arrow')
    expect(conn!.label).toBe('evaporación')
    expect(eventTypes(events)).toContain('draw_connection')
  })

  it('connect to a group: stored correctly', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'cielo', members: ['sol_1', 'nube_1'] },
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'connect', id: 'f1', from: 'mar_1', to: 'cielo', style: 'arrow' },
      ],
      ENV,
    )
    expect(scene.connections.has('f1')).toBe(true)
    expect(scene.connections.get('f1')!.to).toBe('cielo')
    expect(eventTypes(events)).toContain('draw_connection')
  })

  it('connect to an unknown id -> warning and scene unchanged', () => {
    const { scene, warnings } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'INEXISTENTE', style: 'arrow' },
      ],
      ENV,
    )
    expect(scene.connections.has('f1')).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

// ── label tests ──────────────────────────────────────────────────────────────────

describe('label', () => {
  it('applies a label to an object (labelPlacement is not set from the op)', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'label', ref: 'nube_1', text: 'condensación' },
      ],
      ENV,
    )
    const obj = scene.objects.get('nube_1')!
    expect(obj.label).toBe('condensación')
    expect(eventTypes(events)).toContain('set_label')
  })

  it('applies a label to a connection', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'mar_1', to: 'nube_1', style: 'arrow' },
        { op: 'label', ref: 'f1', text: 'evaporación' },
      ],
      ENV,
    )
    expect(scene.connections.get('f1')!.label).toBe('evaporación')
  })

  it('applies a label to a group', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'ciclo', members: ['sol_1', 'nube_1'] },
        { op: 'label', ref: 'ciclo', text: 'ciclo del agua' },
      ],
      ENV,
    )
    expect(scene.groups.get('ciclo')!.label).toBe('ciclo del agua')
  })
})

// ── update tests ────────────────────────────────────────────────────────────────

describe('update', () => {
  it('update label y text', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        {
          op: 'add',
          id: 'titulo_1',
          object: 'texto',
          text: 'hola',
        },
        { op: 'update', ref: 'titulo_1', set: { label: 'nueva etiqueta', text: 'nuevo texto' } },
      ],
      ENV,
    )
    const obj = scene.objects.get('titulo_1')!
    expect(obj.label).toBe('nueva etiqueta')
    expect(obj.text).toBe('nuevo texto')
    expect(eventTypes(events)).toContain('update')
  })

  it('text update that extends: event with extendedFrom; rewrite: without it', () => {
    const base = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'p_1', object: 'texto', text: 'Water rises.' }],
      ENV,
    ).scene
    const ext = applyOperations(base, [{ op: 'update', ref: 'p_1', set: { text: 'Water rises. It cools.' } }], ENV)
    expect(ext.events).toEqual([{ type: 'update', id: 'p_1', extendedFrom: 'Water rises.' }])
    const rew = applyOperations(base, [{ op: 'update', ref: 'p_1', set: { text: 'Vapor goes up.' } }], ENV)
    expect(rew.events).toEqual([{ type: 'update', id: 'p_1' }])
  })

  it('a growing paragraph widens into the free space on the right and origins do not move', () => {
    const longText = 'The water rises as vapor and then it cools down high in the sky until it forms little clouds that drift over the land and the sea.'
    const base = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'a_1', object: 'texto', role: 'subtitulo', text: 'Cycle', group: 'g' },
        { op: 'add', id: 'p_1', object: 'texto', text: 'Water rises.', group: 'g' },
        { op: 'add', id: 'z_1', object: 'texto', role: 'cuerpo', text: 'Remember this', group: 'g' },
      ],
      ENV,
    ).scene
    const before = (id: string) => base.objects.get(id)!.box
    const { scene } = applyOperations(
      base,
      [{ op: 'update', ref: 'p_1', set: { text: `Water rises. ${longText}` } }],
      ENV,
    )
    const after = (id: string) => scene.objects.get(id)!.box
    // Earlier content keeps its origin; the block widens to the full row (free space
    // on the right) instead of only wrapping downward, and the subtitle stretches with it.
    expect(scene.groups.get('g')!.wide).toBe(true)
    expect(after('a_1').x).toBe(before('a_1').x)
    expect(after('a_1').y).toBe(before('a_1').y)
    expect(after('a_1').width).toBeGreaterThan(before('a_1').width)
    expect(after('p_1').x).toBe(before('p_1').x)
    expect(after('p_1').y).toBe(before('p_1').y)
    // the paragraph grows (less than it would at 3 units)
    expect(after('p_1').height).toBeGreaterThan(before('p_1').height)
    // later content moves down
    expect(after('z_1').y).toBeGreaterThan(before('z_1').y)
    expect(after('z_1').y).toBeGreaterThan(after('p_1').y + before('p_1').height)
  })

  it('update on a group label only affects the group', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'cielo', members: ['sol_1', 'nube_1'] },
        { op: 'update', ref: 'cielo', set: { label: 'el cielo' } },
      ],
      ENV,
    )
    expect(scene.groups.get('cielo')!.label).toBe('el cielo')
    // Members get no label from this operation
    expect(scene.objects.get('sol_1')!.label).toBeNull()
  })
})

// ── delete tests ────────────────────────────────────────────────────────────────

describe('delete', () => {
  it('delete object -> cascades to connections', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'mar_1', to: 'nube_1', style: 'arrow' },
        { op: 'delete', ref: 'nube_1' },
      ],
      ENV,
    )
    // nube deleted
    expect(scene.objects.has('nube_1')).toBe(false)
    // f1 also deleted by cascade
    expect(scene.connections.has('f1')).toBe(false)
    // remove event with all the ids
    const removeEvent = events.find((e) => e.type === 'remove') as
      | { type: 'remove'; ids: string[] }
      | undefined
    expect(removeEvent).toBeDefined()
    expect(removeEvent!.ids).toContain('nube_1')
    expect(removeEvent!.ids).toContain('f1')
  })

  it('delete object -> leaves its groups; an empty group is deleted', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'group', id: 'g1', members: ['sol_1'] },
        { op: 'delete', ref: 'sol_1' },
      ],
      ENV,
    )
    expect(scene.objects.has('sol_1')).toBe(false)
    // Empty group -> deleted
    expect(scene.groups.has('g1')).toBe(false)
    const removeEvent = events.find((e) => e.type === 'remove') as
      | { type: 'remove'; ids: string[] }
      | undefined
    expect(removeEvent!.ids).toContain('sol_1')
    expect(removeEvent!.ids).toContain('g1')
  })

  it('delete object -> leaves the group when other members remain', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'g1', members: ['sol_1', 'nube_1'] },
        { op: 'delete', ref: 'sol_1' },
      ],
      ENV,
    )
    // The group still exists with only nube_1
    expect(scene.groups.has('g1')).toBe(true)
    expect(scene.groups.get('g1')!.members).toEqual(['nube_1'])
  })

  it('delete group -> removes members and their connections', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'connect', id: 'f2', from: 'mar_1', to: 'nube_1', style: 'line' },
        { op: 'group', id: 'cielo', members: ['sol_1', 'nube_1'] },
        { op: 'delete', ref: 'cielo' },
      ],
      ENV,
    )
    // Group and members deleted
    expect(scene.groups.has('cielo')).toBe(false)
    expect(scene.objects.has('sol_1')).toBe(false)
    expect(scene.objects.has('nube_1')).toBe(false)
    // mar remains
    expect(scene.objects.has('mar_1')).toBe(true)
    // Member connections deleted
    expect(scene.connections.has('f1')).toBe(false)
    expect(scene.connections.has('f2')).toBe(false)
    // The remove event contains everything
    const removeEvent = events.find((e) => e.type === 'remove') as
      | { type: 'remove'; ids: string[] }
      | undefined
    expect(removeEvent!.ids).toContain('sol_1')
    expect(removeEvent!.ids).toContain('nube_1')
    expect(removeEvent!.ids).toContain('f1')
    expect(removeEvent!.ids).toContain('f2')
    expect(removeEvent!.ids).toContain('cielo')
  })

  it('delete connection -> only the connection', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'delete', ref: 'f1' },
      ],
      ENV,
    )
    expect(scene.connections.has('f1')).toBe(false)
    // Objects intact
    expect(scene.objects.has('sol_1')).toBe(true)
    expect(scene.objects.has('nube_1')).toBe(true)
  })
})

// ── group/ungroup tests ───────────────────────────────────────────────────

describe('group / ungroup', () => {
  it('group creates a logical group', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'ciclo', members: ['sol_1', 'nube_1'], label: 'ciclo del agua' },
      ],
      ENV,
    )
    const grp = scene.groups.get('ciclo')!
    expect(grp).toBeDefined()
    expect(grp.members).toContain('sol_1')
    expect(grp.members).toContain('nube_1')
    expect(grp.label).toBe('ciclo del agua')
    expect(eventTypes(events)).toContain('group')
  })

  it('group with a group as a member -> warning and that member is skipped', () => {
    const { scene, warnings } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'g1', members: ['sol_1'] },
        // g1 is a group: it cannot be a member of another group
        { op: 'group', id: 'g2', members: ['g1', 'nube_1'] },
      ],
      ENV,
    )
    // g2 exists but without g1 as a member
    const g2 = scene.groups.get('g2')!
    expect(g2).toBeDefined()
    expect(g2.members).not.toContain('g1')
    expect(g2.members).toContain('nube_1')
    expect(warnings.some((w) => w.includes('g1') && w.includes('group'))).toBe(true)
  })

  it('group create-or-grow: re-emitting with the same id merges members', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'add', id: 'mar_1', object: 'mar' },
        { op: 'group', id: 'cielo', members: ['sol_1', 'nube_1'] },
        // Re-emit with the same id: merges mar_1 into the existing group
        { op: 'group', id: 'cielo', members: ['mar_1'] },
      ],
      ENV,
    )
    const grp = scene.groups.get('cielo')!
    expect(grp.members).toContain('sol_1')
    expect(grp.members).toContain('nube_1')
    expect(grp.members).toContain('mar_1')
  })

  it('ungroup dissolves the group without deleting the members', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'group', id: 'ciclo', members: ['sol_1', 'nube_1'] },
        { op: 'ungroup', ref: 'ciclo' },
      ],
      ENV,
    )
    // Group deleted
    expect(scene.groups.has('ciclo')).toBe(false)
    // Members intact
    expect(scene.objects.has('sol_1')).toBe(true)
    expect(scene.objects.has('nube_1')).toBe(true)
    expect(eventTypes(events)).toContain('ungroup')
  })
})

// ── clear tests ──────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('clear empties the scene and emits a clear event', () => {
    const { scene, events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'clear' },
      ],
      ENV,
    )
    expect(scene.objects.size).toBe(0)
    expect(scene.connections.size).toBe(0)
    expect(scene.groups.size).toBe(0)
    expect(eventTypes(events)).toContain('clear')
  })
})

// ── Event order tests ─────────────────────────────────────────────────

describe('event order', () => {
  it('events follow the same order as the accepted ops', () => {
    const { events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'label', ref: 'f1', text: 'evaporación' },
        { op: 'highlight', refs: ['sol_1', 'f1'] },
        { op: 'group', id: 'ciclo', members: ['sol_1', 'nube_1'] },
      ],
      ENV,
    )
    expect(eventTypes(events)).toEqual([
      'draw_object',
      'draw_object',
      'draw_connection',
      'set_label',
      'highlight',
      'group',
    ])
  })

  it('add with group: the group event comes BEFORE draw_object', () => {
    const { events } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'verteb_1', object: 'texto', group: 'col_verteb' },
      ],
      ENV,
    )
    // group (implicit creation) comes before draw_object
    expect(eventTypes(events)).toEqual(['group', 'draw_object'])
  })
})

// ── Robustness tests ───────────────────────────────────────────

describe('robustness: an unknown ref does not throw', () => {
  it('label on an unknown ref -> warning, no throw, scene intact', () => {
    const base = emptyScene()
    const { scene, warnings } = applyOperations(
      base,
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'label', ref: 'INEXISTENTE', text: 'algo' },
      ],
      ENV,
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(scene.objects.has('sol_1')).toBe(true)
  })

  it('update on an unknown ref -> warning, no throw', () => {
    const { warnings } = applyOperations(
      emptyScene(),
      [{ op: 'update', ref: 'INEXISTENTE', set: { label: 'x' } }],
      ENV,
    )
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('delete on an unknown ref -> warning, no throw', () => {
    const { warnings } = applyOperations(
      emptyScene(),
      [{ op: 'delete', ref: 'INEXISTENTE' }],
      ENV,
    )
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('highlight with partially unknown refs -> only the valid ones in the event', () => {
    const { scene, events, warnings } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'highlight', refs: ['sol_1', 'INEXISTENTE'] },
      ],
      ENV,
    )
    expect(warnings.length).toBeGreaterThan(0)
    const hEvent = events.find((e) => e.type === 'highlight') as
      | { type: 'highlight'; highlights: Array<{ id: string; ref: string; word?: string }> }
      | undefined
    expect(hEvent).toBeDefined()
    expect(hEvent!.highlights.map(h => h.ref)).toContain('sol_1')
    expect(hEvent!.highlights.map(h => h.ref)).not.toContain('INEXISTENTE')
    expect(scene.objects.has('sol_1')).toBe(true)
  })
})

// ── Immutability tests ───────────────────────────────────────────────────

describe('immutability', () => {
  it('the input scene is not modified after applyOperations', () => {
    const original = emptyScene()
    const originalObjectsSize = original.objects.size

    applyOperations(
      original,
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow' },
        { op: 'clear' },
      ],
      ENV,
    )

    // The original scene must not have changed
    expect(original.objects.size).toBe(originalObjectsSize)
    expect(original.connections.size).toBe(0)
    expect(original.groups.size).toBe(0)
  })

  it('chained applyOperations: each call starts from the previous result', () => {
    const s0 = emptyScene()

    const { scene: s1 } = applyOperations(
      s0,
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const { scene: s2 } = applyOperations(
      s1,
      [{ op: 'add', id: 'nube_1', object: 'nube' }],
      ENV,
    )

    // s0 and s1 must not have changed
    expect(s0.objects.size).toBe(0)
    expect(s1.objects.size).toBe(1)
    expect(s2.objects.size).toBe(2)
  })
})

// ── sceneToAgentState tests ───────────────────────────────────────────────

describe('sceneToAgentState', () => {
  it('parses correctly against CanvasStateSchema (no zone)', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'arrow', label: 'evap' },
        { op: 'group', id: 'ciclo', members: ['sol_1', 'nube_1'], label: 'ciclo del agua' },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, ['frase 1', 'frase 2'])
    const result = CanvasStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  it('objects have NO zone in the agent state', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'mar_1', object: 'mar' },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])

    const solState = state.objects.find((o) => o.id === 'sol_1')
    const marState = state.objects.find((o) => o.id === 'mar_1')

    expect(solState).toBeDefined()
    expect(marState).toBeDefined()
    // no zone in the agent state
    expect((solState as Record<string, unknown>)['zone']).toBeUndefined()
    expect((marState as Record<string, unknown>)['zone']).toBeUndefined()
  })

  it('recent_utterances are included as is', () => {
    const state = sceneToAgentState(emptyScene(), CANVAS, ['frase uno', 'frase dos'])
    expect(state.recent_utterances).toEqual(['frase uno', 'frase dos'])
  })

  it('connections with a null label are included correctly', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
        { op: 'add', id: 'nube_1', object: 'nube' },
        { op: 'connect', id: 'f1', from: 'sol_1', to: 'nube_1', style: 'line' },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])
    const conn = state.connections.find((c) => c.id === 'f1')
    expect(conn).toBeDefined()
    expect(conn!.label).toBeNull()
    const result = CanvasStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  // "texto" objects expose their content as the label in the state
  it('a texto object with text exposes the content as label', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        {
          op: 'add',
          id: 'txt_1',
          object: 'texto',
          text: '3 + 3 = 6',
        },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])
    const obj = state.objects.find((o) => o.id === 'txt_1')
    expect(obj).toBeDefined()
    expect(obj!.label).toBe('3 + 3 = 6')
  })

  it('a texto object without text falls back to label', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        {
          op: 'add',
          id: 'txt_2',
          object: 'texto',
          label: 'nota',
        },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])
    const obj = state.objects.find((o) => o.id === 'txt_2')
    expect(obj).toBeDefined()
    expect(obj!.label).toBe('nota')
  })

  it('a texto object with text and label exposes the content, not the label', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        {
          op: 'add',
          id: 'txt_3',
          object: 'texto',
          text: 'contenido',
          label: 'anotación',
        },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])
    const obj = state.objects.find((o) => o.id === 'txt_3')
    expect(obj).toBeDefined()
    expect(obj!.label).toBe('contenido')
  })

  it('a non-text object keeps exposing its label unchanged', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [
        {
          op: 'add',
          id: 'sol_99',
          object: 'sol',
          label: 'el sol',
        },
      ],
      ENV,
    )
    const state = sceneToAgentState(scene, CANVAS, [])
    const obj = state.objects.find((o) => o.id === 'sol_99')
    expect(obj).toBeDefined()
    expect(obj!.label).toBe('el sol')
  })
})

// ── highlight tests ──────────────────────────────────────────────────────────

describe('highlight', () => {
  it('is idempotent: repeating a highlight on (ref, word) creates no other', () => {
    const { scene: s1 } = applyOperations(emptyScene(), [{ op: 'add', id: 'sol_1', object: 'sol' }], ENV)
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: ['sol_1'] }], ENV)
    const { scene: s3, events } = applyOperations(s2, [{ op: 'highlight', refs: ['sol_1', 'sol_1'] }], ENV)
    expect(s3.highlights.size).toBe(1)
    expect(events.some((e) => e.type === 'highlight')).toBe(false)
    // a different word selector is a different highlight
    const { scene: s4 } = applyOperations(s3, [{ op: 'highlight', refs: [{ ref: 'sol_1', word: 'x' }] }], ENV)
    expect(s4.highlights.size).toBe(2)
  })

  it('does not mutate the scene objects but creates a SceneHighlight and emits an event', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'sol_1', object: 'sol' },
      ],
      ENV,
    )
    const { scene: s2, events: e2 } = applyOperations(
      s1,
      [{ op: 'highlight', refs: ['sol_1'] }],
      ENV,
    )
    // The objects did not change, but there is now a highlight
    expect(s2.objects.size).toBe(s1.objects.size)
    expect(s2.highlights.size).toBe(1)
    // The event contains the id of the created highlight and the ref
    const hEvent = e2[0] as { type: 'highlight'; highlights: Array<{ id: string; ref: string; word?: string }> } | undefined
    expect(hEvent).toBeDefined()
    expect(hEvent!.type).toBe('highlight')
    expect(hEvent!.highlights).toHaveLength(1)
    expect(hEvent!.highlights[0]!.ref).toBe('sol_1')
  })

  it('highlight with {ref, word} propagates the word to the event and the SceneHighlight', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [
        { op: 'add', id: 'def_1', object: 'texto', text: 'La evaporación es un proceso' },
      ],
      ENV,
    )
    const { scene: s2, events } = applyOperations(
      s1,
      [{ op: 'highlight', refs: [{ ref: 'def_1', word: 'evaporación' }] }],
      ENV,
    )
    const hEvent = events.find((e) => e.type === 'highlight') as
      | { type: 'highlight'; highlights: Array<{ id: string; ref: string; word?: string }> }
      | undefined
    expect(hEvent).toBeDefined()
    expect(hEvent!.highlights).toHaveLength(1)
    expect(hEvent!.highlights[0]!.ref).toBe('def_1')
    expect(hEvent!.highlights[0]!.word).toBe('evaporación')
    // The SceneHighlight also has the word
    const hl = Array.from(s2.highlights.values())[0]
    expect(hl).toBeDefined()
    expect(hl!.word).toBe('evaporación')
    expect(hl!.ref).toBe('def_1')
  })

  it('gesture cycle: text -> underline, ellipse, arrow', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'txt_1', object: 'texto', text: 'hola' }],
      ENV,
    )
    // Three successive highlights on the same ref (with different selectors: the same
    // (ref, word) is idempotent and creates no other)
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: [{ ref: 'txt_1', word: 'h' }] }], ENV)
    const { scene: s3 } = applyOperations(s2, [{ op: 'highlight', refs: [{ ref: 'txt_1', word: 'o' }] }], ENV)
    const { scene: s4 } = applyOperations(s3, [{ op: 'highlight', refs: [{ ref: 'txt_1', word: 'l' }] }], ENV)
    const gestures = Array.from(s4.highlights.values()).map(h => h.gesture)
    expect(gestures).toContain('underline')
    expect(gestures).toContain('ellipse')
    expect(gestures).toContain('arrow')
  })

  it('gesture cycle: figure -> ellipse first', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: ['sol_1'] }], ENV)
    const first = Array.from(s2.highlights.values())[0]!
    expect(first.gesture).toBe('ellipse')
  })

  it('deleting an object cascades to its highlights', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: ['sol_1'] }], ENV)
    expect(s2.highlights.size).toBe(1)
    const { scene: s3 } = applyOperations(s2, [{ op: 'delete', ref: 'sol_1' }], ENV)
    expect(s3.highlights.size).toBe(0)
  })

  it('clear empties the highlights', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: ['sol_1'] }], ENV)
    expect(s2.highlights.size).toBe(1)
    const { scene: s3 } = applyOperations(s2, [{ op: 'clear' }], ENV)
    expect(s3.highlights.size).toBe(0)
  })

  it('highlight ids in the format highlight_<page>_<n>', () => {
    const { scene: s1 } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const { scene: s2 } = applyOperations(s1, [{ op: 'highlight', refs: ['sol_1'] }], ENV)
    const hid = Array.from(s2.highlights.keys())[0]!
    expect(hid).toMatch(/^highlight_\d+_\d+$/)
  })
})

// ── Open catalog: placeholder ─────────────────────────────────────────────────

describe('open catalog: an unknown object creates a placeholder', () => {
  it('add of an unknown object creates an object with label = requested name', () => {
    const { scene, warnings } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'dragon_1', object: 'dragón' }],
      ENV,
    )
    const obj = scene.objects.get('dragon_1')
    expect(obj).toBeDefined()
    expect(obj!.object).toBe('dragón')
    expect(obj!.label).toBe('dragón')
    expect(warnings).toHaveLength(0)
  })

  it('add of an unknown object with an agent label -> the agent label is respected', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'volcano_1', object: 'volcan', label: 'El volcán Popocatépetl' }],
      ENV,
    )
    const obj = scene.objects.get('volcano_1')
    expect(obj).toBeDefined()
    expect(obj!.label).toBe('El volcán Popocatépetl')
  })

  it('known object without a label -> label is null (the name is not used)', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const obj = scene.objects.get('sol_1')
    expect(obj).toBeDefined()
    expect(obj!.label).toBeNull()
  })

  it('an unknown object generates a normal draw_object event', () => {
    const { events } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'mitocondria_1', object: 'mitocondria' }],
      ENV,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'draw_object', id: 'mitocondria_1' })
  })
})

// ── Color and fill in the scene ──────────────────────────────────────────────

describe('color and fill on SceneObject', () => {
  it('add without override uses the meta default (negro/contorno in the mock library)', () => {
    const { scene } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'sol' }],
      ENV,
    )
    const obj = scene.objects.get('sol_1')
    expect(obj).toBeDefined()
    expect(obj!.color).toBe('negro')
    expect(obj!.fill).toBe('contorno')
  })
})

// @vitest-environment node
/**
 * Scene engine: measured concepts, late title in the reserved band
 * and sticky widening of groups.
 */
import { describe, it, expect } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { applyOperations } from './apply.js'
import { emptyScene } from './model.js'
import type { Operation } from '@/contract/index.js'
import type { Scene } from './model.js'
import { CONCEPT_DIAMETER } from './concept-measure.js'
import { TITLE_BAND_HEIGHT } from '@/layout/index.js'

const env = { canvas: { width: 1200, height: 900 }, library: loadLibrary() }
const apply = (s: Scene, ops: Operation[]) => applyOperations(s, ops, env)
const txt = (id: string, text: string, group?: string, role: 'cuerpo' | 'subtitulo' | 'titulo' = 'cuerpo'): Operation =>
  ({ op: 'add', id, object: 'texto', role, text, ...(group ? { group } : {}) }) as Operation
const concepto = (id: string, label: string): Operation => ({ op: 'add', id, object: 'concepto', label }) as Operation

describe('concept: circle with its name inside', () => {
  it('the box is square with a fixed diameter, regardless of the name', () => {
    const { scene, warnings } = apply(emptyScene(), [concepto('sol_1', 'Sun'), concepto('c_1', 'Water cycle')])
    expect(warnings).toEqual([])
    const sol = scene.objects.get('sol_1')!
    expect(sol.object).toBe('concepto')
    expect(sol.label).toBe('Sun')
    expect(sol.box.width).toBe(sol.box.height)
    expect(sol.box.width).toBe(CONCEPT_DIAMETER)
    expect(scene.objects.get('c_1')!.box.width).toBe(CONCEPT_DIAMETER)
  })

  it('connects like any other object', () => {
    const { scene, warnings } = apply(emptyScene(), [
      concepto('a_1', 'Sea'), concepto('b_1', 'Cloud'),
      { op: 'connect', id: 'f_1', from: 'a_1', to: 'b_1', style: 'arrow' } as Operation,
    ])
    expect(warnings).toEqual([])
    expect(scene.connections.has('f_1')).toBe(true)
  })
})

describe('late title', () => {
  it('lands in the reserved top-left band without moving anything already placed', () => {
    const base = apply(emptyScene(), [
      txt('s_1', 'Warm water', 'g1', 'subtitulo'), txt('p_1', 'Becomes vapor', 'g1'),
      concepto('sol_1', 'Sun'),
    ]).scene
    const antes = new Map([...base.objects].map(([id, o]) => [id, o.box]))
    const { scene } = apply(base, [txt('t_1', 'The Water Cycle', undefined, 'titulo')])
    for (const [id, box] of antes) expect(scene.objects.get(id)!.box, id).toEqual(box)
    const t = scene.objects.get('t_1')!.box
    expect(t.x).toBe(24)
    expect(t.y).toBe(24)
    expect(t.y + t.height).toBeLessThanOrEqual(24 + TITLE_BAND_HEIGHT)
  })
})

describe('sticky group widening', () => {
  const LARGO = 'The water rises as vapor and then it cools down high in the sky until it forms little clouds that drift over the land.'
  it('when a paragraph grows with free space on the right it widens and remembers it across batches', () => {
    const s1 = apply(emptyScene(), [txt('s_1', 'Cycle', 'g', 'subtitulo'), txt('p_1', 'Water rises.', 'g')]).scene
    expect(s1.groups.get('g')!.wide).toBeUndefined()
    const s2 = apply(s1, [{ op: 'update', ref: 'p_1', set: { text: `Water rises. ${LARGO}` } } as Operation]).scene
    expect(s2.groups.get('g')!.wide).toBe(true)
    const wideBox = s2.objects.get('p_1')!.box
    // a new block does not return the group to 3 units: it is placed below
    const s3 = apply(s2, [txt('s_2', 'Rain', 'h', 'subtitulo'), txt('p_2', 'Falls down.', 'h')]).scene
    expect(s3.groups.get('g')!.wide).toBe(true)
    expect(s3.objects.get('p_1')!.box).toEqual(wideBox)
    expect(s3.objects.get('s_2')!.box.y).toBeGreaterThanOrEqual(wideBox.y + wideBox.height)
  })

  it('does not widen when another block is already to its right', () => {
    const s1 = apply(emptyScene(), [
      txt('s_1', 'Cycle', 'g', 'subtitulo'), txt('p_1', 'Water rises.', 'g'),
      txt('s_2', 'Rain', 'h', 'subtitulo'), txt('p_2', 'Falls.', 'h'),
    ]).scene
    const antes = new Map([...s1.objects].map(([id, o]) => [id, o.box]))
    const s2 = apply(s1, [{ op: 'update', ref: 'p_1', set: { text: `Water rises. ${LARGO}` } } as Operation]).scene
    expect(s2.groups.get('g')!.wide).toBeUndefined()
    for (const id of ['s_1', 's_2', 'p_2']) {
      expect(s2.objects.get(id)!.box.x, id).toBe(antes.get(id)!.x)
      expect(s2.objects.get(id)!.box.y, id).toBe(antes.get(id)!.y)
    }
  })
})

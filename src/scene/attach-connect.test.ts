/**
 * Contiguity of connected objects.
 *
 * A loose figure that receives a `connect` IN THE SAME BATCH toward a member of a
 * group (or the group itself) is placed in layout as a late member of that group's block.
 * Layout only: membership in the scene and in the agent state does not change.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { Operation } from '@/contract/index.js'
import { sceneToAgentState } from './agent-state.js'
import { applyOperations, type SceneEnv } from './apply.js'
import { emptyScene, type Scene } from './model.js'

const CANVAS = { width: 1200, height: 800 }
let env: SceneEnv
beforeAll(() => {
  env = { canvas: CANVAS }
})

const txt = (id: string, text: string, group?: string): Operation =>
  ({ op: 'add', id, object: 'texto', text, role: 'cuerpo', ...(group ? { group } : {}) }) as Operation
const fig = (id: string): Operation => ({ op: 'add', id, object: 'concepto', label: 'circulo' }) as Operation
const conn = (id: string, from: string, to: string): Operation =>
  ({ op: 'connect', id, from, to, style: 'arrow' }) as Operation

const apply = (scene: Scene, ops: Operation[]): Scene => {
  const r = applyOperations(scene, ops, env)
  expect(r.warnings).toEqual([])
  return r.scene
}
const box = (s: Scene, id: string) => s.objects.get(id)!.box

/** Base scene: opening + group gA (2 members) + group gB (2 members), in a previous batch. */
function base(): Scene {
  return apply(emptyScene(), [
    txt('t_1', 'Opening'),
    txt('a_1', 'Alpha one', 'gA'),
    txt('a_2', 'Alpha two', 'gA'),
    txt('b_1', 'Beta one', 'gB'),
    txt('b_2', 'Beta two', 'gB'),
  ])
}

describe('figure connected in the same batch', () => {
  it('falls inside the target group block: below its last member, x within the slot', () => {
    const s0 = base()
    const s1 = apply(s0, [fig('c_1'), conn('f_1', 'c_1', 'a_2')])
    const c = box(s1, 'c_1')
    const last = box(s1, 'a_2')
    expect(c.y).toBeGreaterThanOrEqual(last.y + last.height) // below, without overlapping its neighbor (positive gap)
    // Centered in the group's slot: its center falls within the block's horizontal range.
    const a1 = box(s1, 'a_1')
    const slotRight = a1.x + 400
    expect(c.x).toBeGreaterThanOrEqual(a1.x - 1)
    expect(c.x + c.width).toBeLessThanOrEqual(slotRight)
    // Neither the group nor the agent state changes membership.
    expect(s1.groups.get('gA')!.members).toEqual(['a_1', 'a_2'])
  })

  it('works in the other direction and with the group itself as target', () => {
    const s = apply(base(), [fig('c_1'), conn('f_1', 'a_1', 'c_1')])
    expect(s.objects.get('c_1')!.layoutAttach).toBe('gA')
    const s2 = apply(base(), [fig('c_1'), conn('f_1', 'c_1', 'gB')])
    expect(s2.objects.get('c_1')!.layoutAttach).toBe('gB')
  })

  it('the first matching connect wins', () => {
    const s = apply(base(), [fig('c_1'), conn('f_1', 'c_1', 'b_1'), conn('f_2', 'c_1', 'a_1')])
    expect(s.objects.get('c_1')!.layoutAttach).toBe('gB')
  })

  it('target in the opening strip, loose text or loose figure: no change', () => {
    const s0 = base()
    const sAp = apply(s0, [fig('c_1'), conn('f_1', 'c_1', 't_1')])
    expect(sAp.objects.get('c_1')!.layoutAttach).toBeUndefined()
    const sFig = apply(s0, [fig('c_1'), fig('c_2'), conn('f_1', 'c_1', 'c_2')])
    expect(sFig.objects.get('c_1')!.layoutAttach).toBeUndefined()
    expect(sFig.objects.get('c_2')!.layoutAttach).toBeUndefined()
  })

  it('a connect from a later batch does NOT move the already drawn figure', () => {
    const s1 = apply(base(), [fig('c_1')])
    const antes = new Map([...s1.objects].map(([id, o]) => [id, { ...o.box }]))
    const s2 = apply(s1, [conn('f_1', 'c_1', 'a_1')])
    for (const [id, b] of antes) expect(box(s2, id)).toEqual(b)
    expect(s2.objects.get('c_1')!.layoutAttach).toBeUndefined()
  })

  it('nothing placed BEFORE the batch moves horizontally; only later blocks move down', () => {
    const s0 = base()
    const s1 = apply(s0, [fig('c_1'), conn('f_1', 'c_1', 'a_1')])
    for (const [id, o] of s0.objects) {
      const now = box(s1, id)
      expect(now.x).toBe(o.box.x)
      expect(now.y).toBeGreaterThanOrEqual(o.box.y) // accepted cost: they only move down (never up)
    }
    // The members of gA and whatever sits above the figure do not move vertically.
    expect(box(s1, 'a_1').y).toBe(box(s0, 'a_1').y)
    expect(box(s1, 'a_2').y).toBe(box(s0, 'a_2').y)
  })

  it('attachment is stable under later adds and the agent state does not expose it', () => {
    const s1 = apply(base(), [fig('c_1'), conn('f_1', 'c_1', 'a_2')])
    const s2 = apply(s1, [txt('b_3', 'Beta three', 'gB')])
    expect(s2.objects.get('c_1')!.layoutAttach).toBe('gA')
    const state = sceneToAgentState(s2, CANVAS, [])
    expect(JSON.stringify(state)).not.toContain('layoutAttach')
    expect(JSON.stringify(state)).not.toContain('attach')
    expect(state.groups.find((g) => g.id === 'gA')!.members).toEqual(['a_1', 'a_2'])
  })
})

/** Scene with column 0 almost full: gA with 19 members (attaching to the block would overflow the column and gets reverted). */
function fullColumn(): Scene {
  const ops: Operation[] = [txt('t_1', 'Opening')]
  for (let i = 1; i <= 19; i++) ops.push(txt(`a_${i}`, `Alpha ${i}`, 'gA'))
  return apply(emptyScene(), ops)
}
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('attach fallback: figure next to the target when the attachment is reverted', () => {
  it('with the column full the attached figure continues at the top of the next column without moving anything (the attachment is no longer reverted)', () => {
    const s0 = fullColumn()
    const ops = [fig('c_1'), conn('f_1', 'c_1', 'a_19')]
    const withoutFallback = applyOperations(s0, ops, { ...env, fallbackNearTarget: false })
    const withFallback = applyOperations(s0, ops, env)
    expect(withoutFallback.warnings).toEqual([])
    expect(withFallback.warnings).toEqual([])
    // The section splits across columns: the attachment is kept and no fallback is needed.
    for (const r of [withoutFallback, withFallback]) {
      expect(r.scene.objects.get('c_1')!.layoutAttach).toBe('gA')
      expect(r.scene.objects.get('c_1')!.layoutNear).toBeUndefined()
    }
    // Nothing already placed moves (neither x nor y).
    for (const [id, o] of s0.objects) expect(box(withFallback.scene, id)).toEqual(o.box)
    // The figure follows the group into the next column, colliding with nothing.
    const c = box(withFallback.scene, 'c_1')
    expect(c.x).toBeGreaterThanOrEqual(box(withFallback.scene, 'a_19').x)
    expect(c.y).toBeGreaterThan(box(withFallback.scene, 'a_19').y)
    for (const [id, o] of withFallback.scene.objects) if (id !== 'c_1') expect(overlap(c, o.box)).toBe(false)
    // Membership in the scene and in the agent state is intact.
    expect(withFallback.scene.groups.get('gA')!.members).toHaveLength(19)
    expect(JSON.stringify(sceneToAgentState(withFallback.scene, CANVAS, []))).not.toContain('layoutNear')
  })

  it('is stable under later adds and a later connect does not move it', () => {
    const s1 = apply(fullColumn(), [fig('c_1'), conn('f_1', 'c_1', 'a_19')])
    const antes = new Map([...s1.objects].map(([id, o]) => [id, { ...o.box }]))
    const s2 = apply(s1, [txt('b_1', 'Beta one', 'gB'), txt('b_2', 'Beta two', 'gB')])
    for (const [id, b] of antes) expect(box(s2, id)).toEqual(b)
    const c = box(s2, 'c_1')
    for (const [id, o] of s2.objects) if (id !== 'c_1') expect(overlap(c, o.box)).toBe(false)
  })
})

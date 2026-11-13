// @vitest-environment node
/**
 * Scene engine: sections split across columns (member and line) and
 * numbering of enumerations by the app.
 */
import { describe, it, expect } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { applyOperations } from './apply.js'
import { emptyScene } from './model.js'
import type { Operation } from '@/contract/index.js'
import type { Scene } from './model.js'
import { displayText } from './text-runs.js'
import { estimateTextSize } from './text-measure.js'
import { reflowScene } from './reflow.js'
import { buildTimeline } from '@/animation/timeline.js'

const env = { canvas: { width: 1200, height: 800 }, library: loadLibrary() }
const apply = (s: Scene, ops: Operation[]) => applyOperations(s, ops, env)
type R = 'cuerpo' | 'subtitulo' | 'titulo' | 'lista' | 'enumeracion'
const txt = (id: string, text: string, group?: string, role: R = 'cuerpo'): Operation =>
  ({ op: 'add', id, object: 'texto', role, text, ...(group ? { group } : {}) }) as Operation
const snapshot = (s: Scene) => new Map([...s.objects].map(([id, o]) => [id, { box: o.box, fragments: o.fragments }]))

const WORDS = 'water rises as vapor and cools high in the sky until it forms clouds that drift over land'
const long = (n: number): string => Array.from({ length: n }, () => WORDS).join(' ')

describe('split sections (scene)', () => {
  it('stability: a section growing batch by batch never moves what is already placed, and continues in column 2', () => {
    let scene = apply(emptyScene(), [txt('s_1', 'Cycle', 'g', 'subtitulo'), txt('p_1', long(2), 'g')]).scene
    let prev = snapshot(scene)
    let partio = false
    for (let i = 2; i <= 9; i++) {
      scene = apply(scene, [txt(`p_${i}`, long(3), 'g')]).scene
      for (const [id, before] of prev) {
        // a paragraph the new batch does not touch keeps its box
        expect(scene.objects.get(id)!.box, `${id} @${i}`).toEqual(before.box)
        expect(scene.objects.get(id)!.fragments, `${id} @${i}`).toEqual(before.fragments)
      }
      prev = snapshot(scene)
      const last = scene.objects.get(`p_${i}`)!
      if (last.box.x > scene.objects.get('s_1')!.box.x + 100 || last.fragments !== undefined) partio = true
    }
    expect(partio).toBe(true)
  })

  it('a paragraph that grows with update is split into fragments of the same object with continuous indices', () => {
    const s1 = apply(emptyScene(), [txt('s_1', 'Cycle', 'g', 'subtitulo'), txt('p_1', long(2), 'g')]).scene
    const antes = s1.objects.get('p_1')!.box
    const text = long(12)
    const { scene, events } = apply(s1, [{ op: 'update', ref: 'p_1', set: { text } } as Operation])
    const p = scene.objects.get('p_1')!
    expect(p.fragments!.length).toBeGreaterThanOrEqual(2)
    expect(p.fragments![0]!.box).toEqual(p.box)
    expect(p.box.x).toBe(antes.x)
    expect(p.box.y).toBe(antes.y)
    // the fragments' lines cover the whole paragraph with no gaps or overlaps
    for (let i = 1; i < p.fragments!.length; i++) expect(p.fragments![i]!.fromLine).toBe(p.fragments![i - 1]!.toLine)
    const measured = estimateTextSize(text, p.box.width - 16, 'cuerpo')
    const lines = Math.round((measured.height - 16) / (18 * 1.3))
    expect(p.fragments!.at(-1)!.toLine).toBe(lines)
    // fragments never extend past the bottom of the canvas
    for (const f of p.fragments!) expect(f.box.y + f.box.height).toBeLessThanOrEqual(800)
    // the animation writes the suffix by character index over the full visible text
    const steps = buildTimeline(events, scene, env.library)
    const typed = steps.find((st) => st.kind === 'type_text' && st.targetId === 'p_1')
    expect(typed).toBeDefined()
    if (typed?.kind === 'type_text') {
      expect((typed.prefix ?? '') + typed.text).toBe(displayText(text, 'cuerpo'))
    }
  })

  it('reflow (slide mode) also keeps the fragments', () => {
    const s1 = apply(emptyScene(), [txt('s_1', 'Cycle', 'g', 'subtitulo'), txt('p_1', long(12), 'g')]).scene
    const r = reflowScene(s1, env.canvas)
    expect(r.objects.get('p_1')!.fragments).toEqual(s1.objects.get('p_1')!.fragments)
  })
})

describe('split sections — the app numbers enumerations', () => {
  const item = (id: string, text: string, group = 'g'): Operation => txt(id, text, group, 'enumeracion')

  it('two enumeracion adds in the same group come out as "1." and "2."; a third in a later turn, "3."', () => {
    let scene = apply(emptyScene(), [txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', 'Water **evaporates**'), item('e_2', 'Vapor cools')]).scene
    const e1 = scene.objects.get('e_1')!
    const e2 = scene.objects.get('e_2')!
    expect(displayText(e1.text!, e1.role, e1.listStart)).toBe('1. Water evaporates')
    expect(displayText(e2.text!, e2.role, e2.listStart)).toBe('2. Vapor cools')
    scene = apply(scene, [item('e_3', 'Clouds form')]).scene
    const e3 = scene.objects.get('e_3')!
    expect(displayText(e3.text!, e3.role, e3.listStart)).toBe('3. Clouds form')
    // the previous ones keep their number
    expect(scene.objects.get('e_2')!.listStart).toBe(2)
    expect(scene.objects.get('e_1')!.listStart).toBeUndefined()
  })

  it('the number the model wrote is stripped and position rules', () => {
    const scene = apply(emptyScene(), [txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', '1. First'), item('e_2', '1. Second')]).scene
    const e2 = scene.objects.get('e_2')!
    expect(displayText(e2.text!, e2.role, e2.listStart)).toBe('2. Second')
  })

  it('a run is cut by a member with another role; another group numbers separately', () => {
    const scene = apply(emptyScene(), [
      txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', 'One'), item('e_2', 'Two'),
      txt('c_1', 'A remark', 'g'), item('e_3', 'Again'),
      txt('s_2', 'Other', 'h', 'subtitulo'), item('e_4', 'Solo', 'h'),
    ]).scene
    expect(scene.objects.get('e_2')!.listStart).toBe(2)
    expect(scene.objects.get('e_3')!.listStart).toBe(0) // new run of a single item => no marker
    expect(scene.objects.get('e_4')!.listStart).toBe(0)
  })

  it('a multi-line object numbers consecutively and the next item continues', () => {
    const scene = apply(emptyScene(), [txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', 'A\nB'), item('e_2', 'C')]).scene
    const e1 = scene.objects.get('e_1')!
    expect(displayText(e1.text!, e1.role, e1.listStart)).toBe('1. A\n2. B')
    expect(scene.objects.get('e_2')!.listStart).toBe(3)
  })

  it('bulleted list: each item of a run carries its bullet, no number', () => {
    const scene = apply(emptyScene(), [txt('s_1', 'Things', 'g', 'subtitulo'), txt('l_1', 'rock', 'g', 'lista'), txt('l_2', 'desk', 'g', 'lista')]).scene
    for (const id of ['l_1', 'l_2']) {
      const o = scene.objects.get(id)!
      expect(o.listStart).toBeUndefined()
      expect(displayText(o.text!, o.role, o.listStart).startsWith('• ')).toBe(true)
    }
  })

  it('a lone item carries no marker; when the second arrives in another turn "1." and "2." appear', () => {
    let scene = apply(emptyScene(), [txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', '1. Take in water from the **soil**')]).scene
    let e1 = scene.objects.get('e_1')!
    expect(displayText(e1.text!, e1.role, e1.listStart)).toBe('Take in water from the soil')
    const r = apply(scene, [item('e_2', 'Make food')])
    scene = r.scene
    e1 = scene.objects.get('e_1')!
    const e2 = scene.objects.get('e_2')!
    expect(displayText(e1.text!, e1.role, e1.listStart)).toBe('1. Take in water from the soil')
    expect(displayText(e2.text!, e2.role, e2.listStart)).toBe('2. Make food')
    // only the new part is animated: the already written item is not retyped
    const steps = buildTimeline(r.events, r.scene, env.library)
    expect(steps.some((st) => st.kind === 'type_text' && st.targetId === 'e_1')).toBe(false)
  })

  it('a one-line list carries no bullet; a two-line one does', () => {
    let scene = apply(emptyScene(), [txt('s_1', 'Things', 'g', 'subtitulo'), txt('l_1', '- rock', 'g', 'lista')]).scene
    let o = scene.objects.get('l_1')!
    expect(displayText(o.text!, o.role, o.listStart)).toBe('rock')
    scene = apply(emptyScene(), [txt('s_1', 'Things', 'g', 'subtitulo'), txt('l_1', 'rock\ndesk', 'g', 'lista')]).scene
    o = scene.objects.get('l_1')!
    expect(displayText(o.text!, o.role, o.listStart)).toBe('• rock\n• desk')
  })

  it('the animation writes the displayed text with its number', () => {
    const r = apply(emptyScene(), [txt('s_1', 'Steps', 'g', 'subtitulo'), item('e_1', 'One'), item('e_2', 'Two')])
    const step = buildTimeline(r.events, r.scene, env.library).find((st) => st.kind === 'type_text' && st.targetId === 'e_2')
    expect(step && step.kind === 'type_text' ? step.text : '').toBe('2. Two')
  })
})

describe('split sections — highlight of a split paragraph', () => {
  it('with a selector it covers the fragment where the word falls; without one, the first', async () => {
    const { fragmentIndexForLine } = await import('./layout-support.js')
    const mk = (fromLine: number, toLine: number) => ({ box: { x: 0, y: 0, width: 1, height: 1 }, fromLine, toLine })
    const frags = [mk(0, 5), mk(5, 9)]
    expect(fragmentIndexForLine(frags, 0)).toBe(0)
    expect(fragmentIndexForLine(frags, 4)).toBe(0)
    expect(fragmentIndexForLine(frags, 5)).toBe(1)
    expect(fragmentIndexForLine(frags, 12)).toBe(1) // the last one is open at the bottom
  })
})

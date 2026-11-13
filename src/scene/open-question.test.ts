// @vitest-environment node
/** The open question is in the scene and the agent state, but it is neither drawn nor does it take up space. */
import { describe, it, expect, beforeAll } from 'vitest'
import { applyOperations } from './apply.js'
import { emptyScene } from './model.js'
import { sceneToAgentState } from './agent-state.js'
import { reflowScene } from './reflow.js'
import { findOpenQuestionId, matchesOpenQuestion, sceneForDisplay } from './open-question.js'
import type { Operation } from '@/contract/index.js'
import type { Scene } from './model.js'

const canvas = { width: 1200, height: 900 }
const env = { canvas }
const apply = (s: Scene, ops: Operation[]) => applyOperations(s, ops, env)
const txt = (id: string, text: string, role: 'cuerpo' | 'subtitulo' | 'titulo', group?: string): Operation =>
  ({ op: 'add', id, object: 'texto', role, text, ...(group ? { group } : {}) }) as Operation

const TITLE = txt('t_1', 'The Water Cycle', 'titulo')
const QUESTION = txt('q_1', 'Where does rain come from?', 'subtitulo')
const SECTION = [txt('s_1', 'Evaporation', 'subtitulo', 'g1'), txt('p_1', 'Water rises as vapor', 'cuerpo', 'g1')]

describe('open-question criterion', () => {
  it('subtitle without a group ending in "?"', () => {
    expect(matchesOpenQuestion('subtitulo', null, 'Why?')).toBe(true)
    expect(matchesOpenQuestion('subtitulo', null, 'Why? »')).toBe(true)
    expect(matchesOpenQuestion('subtitulo', 'g1', 'Why?')).toBe(false)
    expect(matchesOpenQuestion('cuerpo', null, 'Why?')).toBe(false)
    expect(matchesOpenQuestion('subtitulo', null, 'Evaporation')).toBe(false)
  })
})

describe('hidden question', () => {
  let withQuestion: Scene
  let withoutQuestion: Scene
  beforeAll(() => {
    withQuestion = apply(emptyScene(), [TITLE, QUESTION, ...SECTION]).scene
    withoutQuestion = apply(emptyScene(), [TITLE, ...SECTION]).scene
  })

  it('is in the scene and in the agent state', () => {
    expect(findOpenQuestionId(withQuestion)).toBe('q_1')
    expect(sceneToAgentState(withQuestion, canvas, []).objects.some((o) => o.id === 'q_1')).toBe(true)
  })

  it('is not among the drawable nodes', () => {
    expect(sceneForDisplay(withQuestion).objects.has('q_1')).toBe(false)
  })

  it('sections are placed as if it did not exist', () => {
    for (const id of ['t_1', 's_1', 'p_1']) expect(withQuestion.objects.get(id)!.box, id).toEqual(withoutQuestion.objects.get(id)!.box)
    const r = reflowScene(withQuestion, canvas)
    for (const id of ['t_1', 's_1', 'p_1']) expect(r.objects.get(id)!.box, id).toEqual(withoutQuestion.objects.get(id)!.box)
  })

  it('connect and highlight that touch it are not drawn', () => {
    const { scene } = apply(withQuestion, [
      { op: 'connect', id: 'f_1', from: 'q_1', to: 's_1', style: 'arrow' } as Operation,
      { op: 'highlight', id: 'h_1', ref: 'q_1' } as unknown as Operation,
    ])
    expect(scene.connections.has('f_1')).toBe(true)
    const view = sceneForDisplay(scene)
    expect(view.connections.has('f_1')).toBe(false)
    expect([...view.highlights.values()].some((h) => h.ref === 'q_1')).toBe(false)
  })
})

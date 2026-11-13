/**
 * Tests of `role` in the agent state.
 */
import { describe, it, expect } from 'vitest'
import { emptyScene } from './model.js'
import { sceneToAgentState } from './agent-state.js'
import { CanvasStateSchema } from '@/contract/index.js'
import type { Scene } from './model.js'

const CANVAS = { width: 1280, height: 720 }

function withText(role: 'titulo' | 'lista' | null): Scene {
  const scene = emptyScene()
  scene.objects.set('txt_1', {
    id: 'txt_1',
    object: 'texto',
    label: null,
    text: 'Hola',
    role,
  } as never)
  scene.objects.set('sol_1', { id: 'sol_1', object: 'sol', label: null, role: null } as never)
  return scene
}

describe('sceneToAgentState — role', () => {
  it('exposes the role of text objects', () => {
    const state = sceneToAgentState(withText('titulo'), CANVAS, [])
    expect(state.objects.find((o) => o.id === 'txt_1')).toEqual({
      id: 'txt_1',
      object: 'texto',
      label: 'Hola',
      role: 'titulo',
    })
    expect(CanvasStateSchema.safeParse(state).success).toBe(true)
  })

  it('a text without an explicit role comes out as body', () => {
    const state = sceneToAgentState(withText(null), CANVAS, [])
    expect(state.objects.find((o) => o.id === 'txt_1')?.role).toBe('cuerpo')
  })

  it('non-text objects carry no role', () => {
    const state = sceneToAgentState(withText('lista'), CANVAS, [])
    const sol = state.objects.find((o) => o.id === 'sol_1')
    expect(sol).toEqual({ id: 'sol_1', object: 'sol', label: null })
    expect('role' in (sol as object)).toBe(false)
  })
})

describe('sceneToAgentState — paragraph extended with update', () => {
  it('the state of later turns shows the grown paragraph with role cuerpo', async () => {
    const { applyGoldenEnvelope, CANVAS: GCANVAS } = await import('@/__fixtures__/golden-helpers.js')
    const { loadLibrary } = await import('@/library/index.js')
    const env = { canvas: GCANVAS, library: loadLibrary() }
    const env1 = {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'texto_1_1', object: 'texto', text: 'Evaporation', role: 'subtitulo', group: 'g' },
        { op: 'add', id: 'texto_1_2', object: 'texto', text: 'Heat makes water rise as vapor', role: 'cuerpo', group: 'g' },
      ],
    }
    const env2 = {
      schema_version: '1.0',
      operations: [
        { op: 'update', ref: 'texto_1_2', set: { text: 'Heat makes water rise as vapor, called evaporation.' } },
      ],
    }
    let scene = applyGoldenEnvelope(emptyScene(), env1, env).scene
    scene = applyGoldenEnvelope(scene, env2, env).scene
    const state = sceneToAgentState(scene, GCANVAS, [])
    const paragraph = state.objects.find((o) => o.id === 'texto_1_2')
    expect(paragraph).toMatchObject({
      object: 'texto',
      label: 'Heat makes water rise as vapor, called evaporation.',
      role: 'cuerpo',
    })
    expect(state.objects.filter((o) => o.object === 'texto')).toHaveLength(2)
  })
})

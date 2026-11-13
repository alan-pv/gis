/**
 * Minimal test of `boardInputsFromScene`: arrival order, isText and group.
 */
import { describe, it, expect } from 'vitest'
import { emptyScene } from './model.js'
import type { Scene, SceneObject, SceneGroup } from './model.js'
import { boardInputsFromScene } from './board-inputs.js'

/** Creates a minimal SceneObject with the given box. */
function obj(id: string, object: string, box: { x: number; y: number; width: number; height: number }): SceneObject {
  return { id, object, label: null, text: null, role: null, box }
}

describe('boardInputsFromScene', () => {
  it('preserves insertion order, flags isText and resolves group', () => {
    const scene: Scene = emptyScene()
    scene.objects.set('titulo_1', obj('titulo_1', 'texto', { x: 0, y: 0, width: 200, height: 40 }))
    scene.objects.set('sol_1', obj('sol_1', 'sol', { x: 0, y: 0, width: 120, height: 120 }))
    scene.objects.set('verteb_1', obj('verteb_1', 'texto', { x: 0, y: 0, width: 200, height: 40 }))

    const group: SceneGroup = { id: 'g_verteb', label: null, members: ['verteb_1'] }
    scene.groups.set('g_verteb', group)

    const { items, dimsById } = boardInputsFromScene(scene)

    expect(items).toEqual([
      { id: 'titulo_1', isText: true, group: null, role: null },
      { id: 'sol_1', isText: false, group: null, role: null },
      { id: 'verteb_1', isText: true, group: 'g_verteb', role: null },
    ])

    expect(dimsById.get('sol_1')).toEqual({ width: 120, height: 120 })
    expect(dimsById.get('titulo_1')).toEqual({ width: 200, height: 40 })
  })

  it('empty scene → no items and no dims', () => {
    const { items, dimsById } = boardInputsFromScene(emptyScene())
    expect(items).toEqual([])
    expect(dimsById.size).toBe(0)
  })
})

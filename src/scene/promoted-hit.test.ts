/**
 * Tests of the hit-test and cascade-delete utilities.
 *
 * Covers:
 * - promotedObjectAtPoint: hits a stroke translated by the box; misses when far away;
 *   ignores objects without inkGeometry; prefers the last inserted.
 * - removeObjectCascade: deletes the object + connections + group membership;
 *   an empty group is removed; unknown id → no change.
 */
import { describe, it, expect } from 'vitest'
import { emptyScene } from './model.js'
import type { Scene, SceneObject, SceneConnection, SceneGroup } from './model.js'
import { removeObjectCascade, objectAtBoxPoint } from './promoted-hit.js'

// ── Scene-building helpers ────────────────────────────────────────────────────

/** Creates a normal scene object (no inkGeometry). */
function makeNormal(id: string): SceneObject {
  return {
    id,
    object: 'nube',
    label: null,
    text: null,
    role: null,
    box: { x: 0, y: 0, width: 100, height: 100 },
  }
}

/** Creates a scene from arrays of objects, connections and groups. */
function makeScene(
  objects: SceneObject[],
  connections: SceneConnection[] = [],
  groups: SceneGroup[] = [],
): Scene {
  const scene = emptyScene()
  for (const o of objects) scene.objects.set(o.id, o)
  for (const c of connections) scene.connections.set(c.id, c)
  for (const g of groups) scene.groups.set(g.id, g)
  return scene
}

// ── promotedObjectAtPoint ─────────────────────────────────────────────────────

// ── objectAtBoxPoint ──────────────────────────────────────────────────────────

describe('objectAtBoxPoint', () => {
  it('hits inside the box of an object without inkGeometry', () => {
    // makeNormal uses box {x:0,y:0,w:100,h:100}; we create one with a custom box
    const custom: import('./model.js').SceneObject = {
      id: 'nube_1_1',
      object: 'nube',
      label: null,
      text: null,
      
      role: null,
      box: { x: 100, y: 100, width: 50, height: 50 },
    }
    const scene = makeScene([custom])

    const hit = objectAtBoxPoint(scene, 120, 120)
    expect(hit).toBeDefined()
    expect(hit!.id).toBe('nube_1_1')
  })

  it('fails when the point is outside the box', () => {
    const obj: import('./model.js').SceneObject = {
      id: 'nube_1_1',
      object: 'nube',
      label: null,
      text: null,
      
      role: null,
      box: { x: 100, y: 100, width: 50, height: 50 },
    }
    const scene = makeScene([obj])

    const hit = objectAtBoxPoint(scene, 10, 10)
    expect(hit).toBeUndefined()
  })

  it('with two overlapping objects returns the last inserted (on top)', () => {
    // Both share the same box; the second inserted must win
    const obj1: import('./model.js').SceneObject = {
      id: 'a',
      object: 'sol',
      label: null,
      text: null,
      
      role: null,
      box: { x: 0, y: 0, width: 100, height: 100 },
    }
    const obj2: import('./model.js').SceneObject = {
      id: 'b',
      object: 'nube',
      label: null,
      text: null,
      
      role: null,
      box: { x: 0, y: 0, width: 100, height: 100 },
    }
    const scene = makeScene([obj1, obj2])

    const hit = objectAtBoxPoint(scene, 50, 50)
    expect(hit).toBeDefined()
    expect(hit!.id).toBe('b')
  })

  it('returns undefined on an empty scene', () => {
    const hit = objectAtBoxPoint(emptyScene(), 50, 50)
    expect(hit).toBeUndefined()
  })

  it('includes objects WITHOUT inkGeometry', () => {
    const obj = makeNormal('sol_1_1')
    // makeNormal has box {x:0,y:0,w:100,h:100}
    const scene = makeScene([obj])

    const hit = objectAtBoxPoint(scene, 50, 50)
    expect(hit).toBeDefined()
    expect(hit!.id).toBe('sol_1_1')
  })
})

// ── removeObjectCascade ───────────────────────────────────────────────────────

describe('removeObjectCascade', () => {
  it('deletes the object from the scene', () => {
    const obj = makeNormal('sol_1_1')
    const scene = makeScene([obj])

    const result = removeObjectCascade(scene, 'sol_1_1')

    expect(result.objects.has('sol_1_1')).toBe(false)
  })

  it('deletes the connections touching the object (from or to)', () => {
    const sol = makeNormal('sol_1_1')
    const nube = makeNormal('nube_1_1')
    const conn: SceneConnection = {
      id: 'f1', from: 'sol_1_1', to: 'nube_1_1', style: 'arrow', label: null,
    }
    const scene = makeScene([sol, nube], [conn])

    const result = removeObjectCascade(scene, 'sol_1_1')

    expect(result.connections.has('f1')).toBe(false)
    // cloud stays intact
    expect(result.objects.has('nube_1_1')).toBe(true)
  })

  it('does not delete connections that do not touch the object', () => {
    const sol = makeNormal('sol_1_1')
    const nube = makeNormal('nube_1_1')
    const mar = makeNormal('mar_1_1')
    const connSolNube: SceneConnection = {
      id: 'f1', from: 'sol_1_1', to: 'nube_1_1', style: 'arrow', label: null,
    }
    const connNubeMar: SceneConnection = {
      id: 'f2', from: 'nube_1_1', to: 'mar_1_1', style: 'line', label: null,
    }
    const scene = makeScene([sol, nube, mar], [connSolNube, connNubeMar])

    const result = removeObjectCascade(scene, 'sol_1_1')

    // f1 deleted; f2 not (it does not touch sol)
    expect(result.connections.has('f1')).toBe(false)
    expect(result.connections.has('f2')).toBe(true)
  })

  it('removes the object from every group it belongs to', () => {
    const sol = makeNormal('sol_1_1')
    const nube = makeNormal('nube_1_1')
    const group: SceneGroup = { id: 'g1', label: null, members: ['sol_1_1', 'nube_1_1'] }
    const scene = makeScene([sol, nube], [], [group])

    const result = removeObjectCascade(scene, 'sol_1_1')

    // The group still exists with only the cloud
    expect(result.groups.has('g1')).toBe(true)
    expect(result.groups.get('g1')!.members).toEqual(['nube_1_1'])
  })

  it('an empty group is also deleted after the removal', () => {
    const sol = makeNormal('sol_1_1')
    const group: SceneGroup = { id: 'g1', label: null, members: ['sol_1_1'] }
    const scene = makeScene([sol], [], [group])

    const result = removeObjectCascade(scene, 'sol_1_1')

    expect(result.objects.has('sol_1_1')).toBe(false)
    expect(result.groups.has('g1')).toBe(false)
  })

  it('unknown id → returns the same scene reference unchanged', () => {
    const scene = emptyScene()
    const result = removeObjectCascade(scene, 'no_existe')
    expect(result).toBe(scene)
  })

  it('does not mutate the input scene', () => {
    const sol = makeNormal('sol_1_1')
    const conn: SceneConnection = {
      id: 'f1', from: 'sol_1_1', to: 'nube_1_1', style: 'arrow', label: null,
    }
    const scene = makeScene([sol], [conn])

    removeObjectCascade(scene, 'sol_1_1')

    // The original scene did not change
    expect(scene.objects.has('sol_1_1')).toBe(true)
    expect(scene.connections.has('f1')).toBe(true)
  })
})

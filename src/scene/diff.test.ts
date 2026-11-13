/**
 * Tests of the diffAddedObjects helper.
 *
 * Checks that the function correctly returns the objects present in
 * the next scene that were not in the previous one, and returns an empty array
 * when there are no new objects.
 */
import { describe, it, expect } from 'vitest'
import { emptyScene } from './model.js'
import { applyOperations } from './apply.js'
import { diffAddedObjects } from './diff.js'
import type { SceneEnv } from './apply.js'

// ── Minimal test environment ──────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 900 }

const ENV: SceneEnv = { canvas: CANVAS }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('diffAddedObjects', () => {
  it('returns the new object with its box when one is added to the scene', () => {
    // Previous scene with a sun
    const { scene: prev } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'concepto', label: 'sol' }],
      ENV,
    )
    // Next scene with sun and cloud
    const { scene: next } = applyOperations(
      prev,
      [{ op: 'add', id: 'nube_1', object: 'concepto', label: 'nube' }],
      ENV,
    )

    const added = diffAddedObjects(prev, next)

    expect(added).toHaveLength(1)
    expect(added[0]!.id).toBe('nube_1')
    // The box must be valid (positive dimensions)
    expect(added[0]!.box.width).toBeGreaterThan(0)
    expect(added[0]!.box.height).toBeGreaterThan(0)
  })

  it('returns an empty array when there are no new objects', () => {
    const { scene: prev } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'concepto', label: 'sol' }],
      ENV,
    )

    const added = diffAddedObjects(prev, prev)

    expect(added).toHaveLength(0)
  })

  it('returns multiple objects if several were added at once', () => {
    const prev = emptyScene()
    const { scene: next } = applyOperations(
      prev,
      [
        { op: 'add', id: 'sol_1', object: 'concepto', label: 'sol' },
        { op: 'add', id: 'nube_1', object: 'concepto', label: 'nube' },
      ],
      ENV,
    )

    const added = diffAddedObjects(prev, next)

    expect(added).toHaveLength(2)
    const ids = added.map(o => o.id)
    expect(ids).toContain('sol_1')
    expect(ids).toContain('nube_1')
  })

  it('does not include objects already present in prev', () => {
    const { scene: prev } = applyOperations(
      emptyScene(),
      [{ op: 'add', id: 'sol_1', object: 'concepto', label: 'sol' }],
      ENV,
    )
    const { scene: next } = applyOperations(
      prev,
      [{ op: 'add', id: 'texto_1', object: 'texto', text: 'hola' }],
      ENV,
    )

    const added = diffAddedObjects(prev, next)

    expect(added).toHaveLength(1)
    expect(added[0]!.id).toBe('texto_1')
  })
})

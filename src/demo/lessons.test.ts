// @vitest-environment node
/**
 * lessons.test.ts — checks the discovery and normalization of the bundled lessons.
 */
import { describe, it, expect } from 'vitest'
import { loadSeeds } from './lessons.js'
import type { LoadedSeed } from './lessons.js'

describe('loadSeeds()', () => {
  const seeds: LoadedSeed[] = loadSeeds()

  it('returns the recorded lessons', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(3)
  })

  it('does not list the legacy golden examples', () => {
    const ids = seeds.map(s => s.id)
    expect(ids).not.toContain('dorado-1')
    expect(ids).not.toContain('dorado-2')
    expect(ids).toContain('estados-materia')
  })

  it('"The food chain" comes first and the rest by alphabetical title', () => {
    expect(seeds[0]?.label).toBe('The food chain')
    const rest = seeds.slice(1).map(s => s.label)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('estados-materia has exactly 15 turns', () => {
    const em = seeds.find(s => s.id === 'estados-materia')!
    expect(em).toBeDefined()
    expect(em.turns).toHaveLength(15)
  })

  it('every turn of estados-materia has both registers non-empty and caseTags', () => {
    const em = seeds.find(s => s.id === 'estados-materia')!
    for (const turn of em.turns) {
      expect(typeof turn.utteranceFormal).toBe('string')
      expect(turn.utteranceFormal.length).toBeGreaterThan(0)
      expect(typeof turn.utteranceColoquial).toBe('string')
      expect(turn.utteranceColoquial.length).toBeGreaterThan(0)
      expect(Array.isArray(turn.caseTags)).toBe(true)
      expect(turn.caseTags.length).toBeGreaterThan(0)
      expect(turn.envelope).toBeDefined()
    }
  })

  it('every turn of every lesson has a defined envelope', () => {
    for (const seed of seeds) {
      for (const turn of seed.turns) {
        expect(turn.envelope).toBeDefined()
      }
    }
  })
})

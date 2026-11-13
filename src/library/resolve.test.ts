/**
 * Tests for the object resolution module (open catalog).
 *
 * Covers: resolveObject (hit and miss), mixed resolution, an error
 * when the base library has no 'circulo'.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadLibrary } from './loader.js'
import { resolveObject } from './resolve.js'
import type { Library } from './loader.js'

// ── Real library ──────────────────────────────────────────────────────────────

let library: Library

beforeAll(() => {
  library = loadLibrary()
})

// ── resolveObject — hit ───────────────────────────────────────────────────────

describe('resolveObject — hit', () => {
  it('library object → returns the object with isPlaceholder = false', () => {
    const result = resolveObject(library, 'sol')
    expect(result.isPlaceholder).toBe(false)
    expect(result.obj.name).toBe('sol')
  })

  it('circulo is in the library and resolves as a hit', () => {
    const result = resolveObject(library, 'circulo')
    expect(result.isPlaceholder).toBe(false)
    expect(result.obj.name).toBe('circulo')
  })

  it('nube is a hit', () => {
    const result = resolveObject(library, 'nube')
    expect(result.isPlaceholder).toBe(false)
    expect(result.obj.name).toBe('nube')
  })
})

// ── resolveObject — miss (placeholder) ───────────────────────────────────────

describe('resolveObject — miss → placeholder with circulo', () => {
  it('nonexistent object → returns the circulo LibraryObject with isPlaceholder = true', () => {
    const result = resolveObject(library, 'dragón')
    expect(result.isPlaceholder).toBe(true)
    // The base obj is circulo (the placeholder shape)
    expect(result.obj.name).toBe('circulo')
  })

  it('a very long made-up object name → placeholder', () => {
    const result = resolveObject(library, 'mitocondria_especial')
    expect(result.isPlaceholder).toBe(true)
    expect(result.obj.name).toBe('circulo')
  })

  it('placeholder has the same meta (anchors, etc.) as circulo', () => {
    const resultPh = resolveObject(library, 'ajolote')
    const resultCircle = resolveObject(library, 'circulo')
    // The placeholder uses exactly the same LibraryObject as circulo
    expect(resultPh.obj).toBe(resultCircle.obj)
  })
})

// ── resolveObject — library without circulo → throws ─────────────────────────

describe('resolveObject — broken library (no circulo)', () => {
  it('throws an Error if circulo does not exist and neither does the requested name', () => {
    // Simulated empty library
    const brokenLibrary = new Map() as Library
    expect(() => resolveObject(brokenLibrary, 'sol')).toThrow(
      /circulo/i,
    )
  })
})

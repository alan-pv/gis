import { describe, it, expect } from 'vitest'
import { extensionSuffix } from './text-extend.js'

describe('extensionSuffix', () => {
  it('returns the suffix when the new text starts with the old one', () => {
    expect(extensionSuffix('Water rises.', 'Water rises. It cools.')).toBe(' It cools.')
  })
  it('ignores trailing spaces of the old text', () => {
    expect(extensionSuffix('Water rises.  ', 'Water rises. It cools.')).toBe(' It cools.')
  })
  it('real rewrite → null', () => {
    expect(extensionSuffix('Water rises.', 'Vapor goes up.')).toBeNull()
  })
  it('no previous text or nothing added → null', () => {
    expect(extensionSuffix('', 'algo')).toBeNull()
    expect(extensionSuffix('hola', 'hola')).toBeNull()
    expect(extensionSuffix('hola  ', 'hola')).toBeNull()
  })
})

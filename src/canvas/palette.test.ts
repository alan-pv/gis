/**
 * Tests for palette.ts: the closed pen palette and its hex lookup.
 */
import { describe, it, expect } from 'vitest'
import { PALETTE_HEX, colorHex } from './palette.js'

const colors = Object.keys(PALETTE_HEX) as Array<keyof typeof PALETTE_HEX>

describe('palette', () => {
  it.each(colors)('%s: colorHex returns its #rrggbb hex', (color) => {
    expect(colorHex(color)).toBe(PALETTE_HEX[color])
    expect(colorHex(color)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('undefined falls back to black', () => {
    expect(colorHex(undefined)).toBe(PALETTE_HEX.black)
  })
})

/**
 * Tests for palette.ts: colors, darkened outline and the outline rule.
 */
import { describe, it, expect } from 'vitest'
import { PALETTE_HEX, colorHex, strokeHex, outlineHex } from './palette.js'

// ── Local helper: sum of the RGB channels of a #rrggbb hex ────────────────────

function rgbSum(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return r + g + b
}

// ── Tests for each palette color ──────────────────────────────────────────────

const colors = Object.keys(PALETTE_HEX) as Array<keyof typeof PALETTE_HEX>

describe('palette', () => {

  describe('strokeHex: darkened outline', () => {

    it.each(colors)('%s: strokeHex es distinto de colorHex', (color) => {
      expect(strokeHex(color)).not.toBe(colorHex(color))
    })

    it.each(colors)('%s: strokeHex is strictly darker (smaller RGB sum)', (color) => {
      const base = colorHex(color)
      const dark = strokeHex(color)
      expect(rgbSum(dark)).toBeLessThan(rgbSum(base))
    })

  })

  describe('outlineHex: outline color rule', () => {

    it.each(colors)('%s: fill="contorno" → colorHex (sin cambio)', (color) => {
      expect(outlineHex(color, 'contorno')).toBe(colorHex(color))
    })

    it.each(colors)('%s: fill="relleno" → strokeHex (dark border)', (color) => {
      expect(outlineHex(color, 'relleno')).toBe(strokeHex(color))
    })

    it.each(colors)('%s: fill=undefined → colorHex (default = contorno)', (color) => {
      expect(outlineHex(color, undefined)).toBe(colorHex(color))
    })

  })

})

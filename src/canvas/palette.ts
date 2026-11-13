/**
 * Canvas color palette: maps the pen Color to hex.
 *
 * The colors are chosen to be legible on a #fafaf8 background and to look like
 * a school blackboard (not saturated primary colors).
 */
import type { Color } from '@/ink/index.js'

// ── Closed palette ────────────────────────────────────────────────────────────

export const PALETTE_HEX: Record<Color, string> = {
  negro:    '#1a1a1a',
  azul:     '#2563eb',
  rojo:     '#dc2626',
  verde:    '#16a34a',
  amarillo: '#eab308',
  naranja:  '#ea580c',
  café:     '#92400e',
  gris:     '#6b7280',
}

/**
 * Returns the hex of the given color; falls back to black if undefined.
 */
export function colorHex(color: Color | undefined): string {
  return PALETTE_HEX[color ?? 'negro']
}

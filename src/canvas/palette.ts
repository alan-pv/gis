/**
 * Canvas color palette: maps the pen Color to hex.
 *
 * The colors are chosen to be legible on a #fafaf8 background and to look like
 * a school blackboard (not saturated primary colors).
 */
import type { Color } from '@/ink/index.js'

// ── Closed palette ────────────────────────────────────────────────────────────

export const PALETTE_HEX: Record<Color, string> = {
  black:    '#1a1a1a',
  blue:     '#2563eb',
  red:      '#dc2626',
  green:    '#16a34a',
  yellow:   '#eab308',
  orange:   '#ea580c',
  brown:    '#92400e',
  gray:     '#6b7280',
}

/**
 * Returns the hex of the given color; falls back to black if undefined.
 */
export function colorHex(color: Color | undefined): string {
  return PALETTE_HEX[color ?? 'black']
}

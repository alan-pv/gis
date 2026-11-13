/**
 * Canvas color palette: maps Color to hex.
 *
 * The colors are chosen to be legible on a #fafaf8 background and to look like
 * a school blackboard (not saturated primary colors).
 */
import type { Color, Fill } from '@/library/index.js'

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

/**
 * Returns true if the fill is 'relleno' (colored interior area).
 */
export function isFilled(fill: Fill | undefined): boolean {
  return fill === 'relleno'
}

// ── Derived outline ───────────────────────────────────────────────────────────

/** Darkens a #rrggbb hex color by multiplying each channel by `factor` (0..1). */
function darken(hex: string, factor: number): string {
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor))
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor))
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor))
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

/**
 * Returns the darkened outline color (factor 0.6) for filled shapes.
 * Guarantees the border is visually distinguishable from the interior.
 */
export function strokeHex(color: Color | undefined): string {
  return darken(colorHex(color), 0.6)
}

/**
 * Centralizes the outline color rule:
 * - 'relleno' → strokeHex (dark border derived from the base color).
 * - 'contorno' or undefined → colorHex (direct color).
 */
export function outlineHex(color: Color | undefined, fill: Fill | undefined): string {
  return fill === 'relleno' ? strokeHex(color) : colorHex(color)
}

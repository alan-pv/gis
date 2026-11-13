/**
 * Board color scheme. Pure module.
 *
 * The model does not decide color: the app does.
 * - Black ink (`INK_COLOR`) for body text, lists, enumerations, concept names
 *   and arrows.
 * - COLOR BY SECTION: each group gets, in creation order, a cyclic entry of
 *   `SECTION_PALETTE`. A subtitle uses the light tone as background and the dark
 *   one as text; the circle outline of a concept uses the dark tone of its section.
 * - The title keeps its style (yellow background + `INK_COLOR`).
 * - Red is reserved for emphasis (`EMPHASIS_COLOR`, highlights): it is not in the palette.
 * - Arrows use ink (simplest: they do not inherit a section color).
 */
import type { Role } from '@/contract/index.js'
import type { Scene } from '@/scene/index.js'
import { TEXT_BG_COLOR } from '@/scene/text-measure.js'

/** Content ink (strokes, body text, connections). */
export const INK_COLOR = '#1a1a1a'
/** Emphasis red (highlights); same as `rojo` in the contract palette. */
export const EMPHASIS_COLOR = '#dc2626'

/** Color of a section: light tone (background) and dark tone (text/stroke). */
export interface SectionColor {
  name: string
  /** Light background. */
  light: string
  /** Text and stroke, with AA contrast (≥ 4.5) on `light` and on the board. */
  dark: string
}

/** Section palette in group creation order (cyclic). No red. */
export const SECTION_PALETTE: readonly SectionColor[] = [
  { name: 'verde',        light: '#dcfce7', dark: '#166534' },
  { name: 'azul',         light: '#dbeafe', dark: '#1e40af' },
  { name: 'naranja',      light: '#ffedd5', dark: '#9a3412' },
  { name: 'morado',       light: '#f3e8ff', dark: '#6b21a8' },
  { name: 'verde azulado', light: '#ccfbf1', dark: '#115e59' },
  { name: 'marrón',       light: '#f1e4d6', dark: '#6b4226' },
]

/** Color of the section at index `index` (cyclic). */
export function sectionColorAt(index: number): SectionColor {
  const n = SECTION_PALETTE.length
  return SECTION_PALETTE[((index % n) + n) % n]!
}

/** Id of the group containing the object, or null. */
export function groupIdOf(scene: Scene, objectId: string): string | null {
  for (const [gid, g] of scene.groups) if (g.members.includes(objectId)) return gid
  return null
}

/**
 * Color of the object's section: by the creation order of its group
 * (insertion order in `scene.groups`). `null` if it belongs to no group.
 */
export function sectionColorOf(scene: Scene, objectId: string): SectionColor | null {
  const gid = groupIdOf(scene, objectId)
  if (gid === null) return null
  let i = 0
  for (const key of scene.groups.keys()) {
    if (key === gid) return sectionColorAt(i)
    i++
  }
  return null
}

/**
 * Text color of a text object.
 * - Subtitle with a section → dark tone of the section.
 * - Title, or subtitle without a section → `INK_COLOR`.
 * - Everything else (body, list, enumeration) → ink.
 */
export function textInkColor(role: Role | null | undefined, section: SectionColor | null): string {
  if (role === 'subtitulo' && section !== null) return section.dark
  return role === 'titulo' || role === 'subtitulo' ? INK_COLOR : INK_COLOR
}

/**
 * Background of a text.
 * - Subtitle with a section → light tone of the section.
 * - Title, or subtitle without a section → light yellow (`TEXT_BG_COLOR`).
 * - Everything else → `null` (written directly on the board).
 */
export function textBackgroundFor(role: Role | null | undefined, section: SectionColor | null): string | null {
  if (role === 'subtitulo' && section !== null) return section.light
  return role === 'titulo' || role === 'subtitulo' ? TEXT_BG_COLOR : null
}

/** Outline color of a concept: dark tone of its section, or ink if it has no group. */
export function conceptStrokeColor(section: SectionColor | null): string {
  return section === null ? INK_COLOR : section.dark
}

// ── Contrast (WCAG) ───────────────────────────────────────────────────────────


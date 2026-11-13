import { describe, it, expect } from 'vitest'
import { INK_COLOR, EMPHASIS_COLOR, SECTION_PALETTE, textInkColor, textBackgroundFor, sectionColorAt, sectionColorOf, conceptStrokeColor } from './board-colors.js'
import { colorHex } from './palette.js'
import { emptyScene } from '@/scene/index.js'
import { TEXT_BG_COLOR } from '@/scene/text-measure.js'
import type { Scene } from '@/scene/index.js'

function sceneWithGroups(groupIds: string[], membersOf: Record<string, string[]>): Scene {
  const s = emptyScene()
  for (const g of groupIds) s.groups.set(g, { id: g, label: null, members: membersOf[g] ?? [] })
  return s
}

describe('board-colors: section palette', () => {
  it('order: green, blue, orange, purple, teal, brown (cyclic)', () => {
    expect(SECTION_PALETTE.map((c) => c.name)).toEqual(['verde', 'azul', 'naranja', 'morado', 'verde azulado', 'marrón'])
    expect(sectionColorAt(6)).toBe(SECTION_PALETTE[0])
    expect(sectionColorAt(7)).toBe(SECTION_PALETTE[1])
  })

  it('the emphasis red is not in the palette', () => {
    for (const c of SECTION_PALETTE) {
      expect(c.dark).not.toBe(EMPHASIS_COLOR)
      expect(c.light).not.toBe(EMPHASIS_COLOR)
    }
    expect(EMPHASIS_COLOR).toBe(colorHex('rojo'))
  })

  it('an object\'s section follows the creation order of its group', () => {
    const scene = sceneWithGroups(['g1', 'g2'], { g1: ['a'], g2: ['b'] })
    expect(sectionColorOf(scene, 'a')).toBe(SECTION_PALETTE[0])
    expect(sectionColorOf(scene, 'b')).toBe(SECTION_PALETTE[1])
    expect(sectionColorOf(scene, 'suelto')).toBeNull()
  })
})

describe('board-colors: text and concept', () => {
  const verde = SECTION_PALETTE[0]!

  it('subtitle with a section: light background and dark text of the section', () => {
    expect(textBackgroundFor('subtitulo', verde)).toBe(verde.light)
    expect(textInkColor('subtitulo', verde)).toBe(verde.dark)
  })

  it('title (and subtitle without a section) keep their style: yellow + heading blue', () => {
    expect(textBackgroundFor('titulo', verde)).toBe(TEXT_BG_COLOR)
    expect(textInkColor('titulo', verde)).toBe(INK_COLOR)
    expect(textBackgroundFor('subtitulo', null)).toBe(TEXT_BG_COLOR)
    expect(textInkColor('subtitulo', null)).toBe(INK_COLOR)
  })

  it('body, list, enumeration and no role: black ink and no background, with or without a section', () => {
    for (const r of ['cuerpo', 'lista', 'enumeracion', null, undefined] as const) {
      expect(textInkColor(r, verde)).toBe(INK_COLOR)
      expect(textBackgroundFor(r, verde)).toBeNull()
    }
  })

  it('the concept outline is the dark tone of its section (ink without a group)', () => {
    expect(conceptStrokeColor(verde)).toBe(verde.dark)
    expect(conceptStrokeColor(null)).toBe(INK_COLOR)
  })
})

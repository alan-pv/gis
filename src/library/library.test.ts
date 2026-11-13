/**
 * Tests for the object library.
 *
 * Covers: ObjectMetaSchema and loadLibrary (real).
 */
import { describe, it, expect } from 'vitest'
import { ObjectMetaSchema, metaColor, metaFill } from './meta.js'
import { loadLibrary } from './loader.js'

// ── Expected objects in the library ──────────────────────────────────────────

const EXPECTED_OBJECTS = [
  'circulo', 'rectangulo', 'triangulo', 'linea', 'texto',
  'sol', 'nube', 'lluvia', 'mar', 'montaña', 'arbol', 'gota', 'persona',
] as const

// ── ObjectMetaSchema tests ────────────────────────────────────────────────────

describe('ObjectMetaSchema', () => {
  it('parses a valid SVG meta', () => {
    const input = {
      name: 'sol',
      format_version: 1,
      default_size: { width: 120, height: 120 },
      anchors: {
        top:    { x: 60, y: 0 },
        bottom: { x: 60, y: 120 },
        left:   { x: 0,  y: 60 },
        right:  { x: 120, y: 60 },
      },
      stroke_order: ['cuerpo', 'rayo_1'],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('fails if anchors are missing', () => {
    const input = {
      name: 'sol',
      format_version: 1,
      default_size: { width: 120, height: 120 },
      stroke_order: ['cuerpo'],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('fails if some anchors are missing (only top)', () => {
    const input = {
      name: 'sol',
      format_version: 1,
      default_size: { width: 120, height: 120 },
      anchors: {
        top: { x: 60, y: 0 },
      },
      stroke_order: ['cuerpo'],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('parses a text meta without stroke_order', () => {
    const input = {
      render: 'text',
      name: 'texto',
      format_version: 1,
      default_size: { width: 200, height: 40 },
      anchors: {
        top:    { x: 100, y: 0 },
        bottom: { x: 100, y: 40 },
        left:   { x: 0,   y: 20 },
        right:  { x: 200, y: 20 },
      },
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.render).toBe('text')
    }
  })

  it('fails if format_version is not 1', () => {
    const input = {
      name: 'sol',
      format_version: 2,
      default_size: { width: 120, height: 120 },
      anchors: {
        top:    { x: 60, y: 0 },
        bottom: { x: 60, y: 120 },
        left:   { x: 0,  y: 60 },
        right:  { x: 120, y: 60 },
      },
      stroke_order: ['cuerpo'],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('fails if default_size has negative values', () => {
    const input = {
      name: 'sol',
      format_version: 1,
      default_size: { width: -10, height: 120 },
      anchors: {
        top:    { x: 60, y: 0 },
        bottom: { x: 60, y: 120 },
        left:   { x: 0,  y: 60 },
        right:  { x: 120, y: 60 },
      },
      stroke_order: ['cuerpo'],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('fails if stroke_order is an empty array', () => {
    const input = {
      name: 'sol',
      format_version: 1,
      default_size: { width: 120, height: 120 },
      anchors: {
        top:    { x: 60, y: 0 },
        bottom: { x: 60, y: 120 },
        left:   { x: 0,  y: 60 },
        right:  { x: 120, y: 60 },
      },
      stroke_order: [],
    }
    const result = ObjectMetaSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ── Real loader tests (import.meta.glob) ──────────────────────────────────────

describe('loadLibrary', () => {
  it('loads the 13 expected objects', () => {
    const library = loadLibrary()
    for (const name of EXPECTED_OBJECTS) {
      expect(library.has(name), `missing object "${name}"`).toBe(true)
    }
    expect(library.size).toBe(EXPECTED_OBJECTS.length)
  })

  it('all objects have the 4 mandatory anchors', () => {
    const library = loadLibrary()
    for (const [name, obj] of library) {
      const anchors = obj.meta.anchors
      expect(anchors.top,    `${name}: missing anchor top`).toBeDefined()
      expect(anchors.bottom, `${name}: missing anchor bottom`).toBeDefined()
      expect(anchors.left,   `${name}: missing anchor left`).toBeDefined()
      expect(anchors.right,  `${name}: missing anchor right`).toBeDefined()
    }
  })

  it('all anchors are inside the viewBox for SVG objects', () => {
    const library = loadLibrary()
    for (const [name, obj] of library) {
      if (obj.meta.render === 'text') continue
      const { width, height } = obj.meta.default_size
      const { top, bottom, left, right } = obj.meta.anchors
      const inBounds = (p: { x: number; y: number }) =>
        p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height
      expect(inBounds(top),    `${name}: anchor top outside the viewBox`).toBe(true)
      expect(inBounds(bottom), `${name}: anchor bottom outside the viewBox`).toBe(true)
      expect(inBounds(left),   `${name}: anchor left outside the viewBox`).toBe(true)
      expect(inBounds(right),  `${name}: anchor right outside the viewBox`).toBe(true)
    }
  })

  it('the 12 SVG objects have a non-null svg', () => {
    const library = loadLibrary()
    for (const [name, obj] of library) {
      if (obj.meta.render === 'text') {
        expect(obj.svg, `${name}: texto should have a null svg`).toBeNull()
      } else {
        expect(obj.svg, `${name}: SVG object should not have a null svg`).not.toBeNull()
      }
    }
  })

  it('texto has a null svg', () => {
    const library = loadLibrary()
    const textObj = library.get('texto')
    expect(textObj).toBeDefined()
    expect(textObj?.svg).toBeNull()
  })

  it('stroke_order and SVG ids match exactly for SVG objects', () => {
    // The loader also does this validation at startup, but we
    // replicate it here to document the invariant.
    const library = loadLibrary()
    for (const [name, obj] of library) {
      if (obj.meta.render === 'text' || obj.svg === null) continue

      const svgIds = new Set<string>()
      const re = /\bid="([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(obj.svg)) !== null) {
        if (m[1]) svgIds.add(m[1])
      }

      const strokeOrder = obj.meta.stroke_order
      expect(strokeOrder.length, `${name}: stroke_order.length != svgIds.size`).toBe(svgIds.size)
      for (const id of strokeOrder) {
        expect(svgIds.has(id), `${name}: id "${id}" in stroke_order is missing from the SVG`).toBe(true)
      }
    }
  })
})

// ── Color and fill in meta.json ──────────────────────────────────────────────

describe('color and fill in the library metas', () => {
  it('sol has color "amarillo" in its meta (real library)', () => {
    const lib = loadLibrary()
    const sunObj = lib.get('sol')
    expect(sunObj).toBeDefined()
    expect(sunObj!.meta.color).toBe('amarillo')
  })

  it('mar has color "azul" in its meta (real library)', () => {
    const lib = loadLibrary()
    const marObj = lib.get('mar')
    expect(marObj).toBeDefined()
    expect(marObj!.meta.color).toBe('azul')
  })

  it('all base objects have fill "contorno" in their meta', () => {
    const lib = loadLibrary()
    const EXPECTED = ['sol', 'mar', 'nube', 'lluvia', 'gota', 'arbol', 'montaña', 'persona',
      'circulo', 'rectangulo', 'triangulo', 'linea', 'texto']
    for (const name of EXPECTED) {
      const obj = lib.get(name)
      expect(obj, `${name} not found in the library`).toBeDefined()
      expect(obj!.meta.fill, `${name}.fill`).toBe('contorno')
    }
  })

  it('metaColor returns the meta color when defined', () => {
    const lib = loadLibrary()
    const sunObj = lib.get('sol')
    expect(sunObj).toBeDefined()
    expect(metaColor(sunObj!.meta)).toBe('amarillo')
  })

  it('metaFill returns the meta fill when defined', () => {
    const lib = loadLibrary()
    const sunObj = lib.get('sol')
    expect(sunObj).toBeDefined()
    expect(metaFill(sunObj!.meta)).toBe('contorno')
  })

  it('metaColor falls back to DEFAULT_COLOR when the meta has no color', () => {
    // Simulate a meta without a color field (as created before the color field existed)
    const metaWithoutColor = {
      name: 'prueba',
      format_version: 1 as const,
      default_size: { width: 100, height: 100 },
      anchors: {
        top: { x: 50, y: 0 }, bottom: { x: 50, y: 100 },
        left: { x: 0, y: 50 }, right: { x: 100, y: 50 },
      },
      stroke_order: ['cuerpo'],
    }
    const result = ObjectMetaSchema.safeParse(metaWithoutColor)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(metaColor(result.data)).toBe('negro')
      expect(metaFill(result.data)).toBe('contorno')
    }
  })
})

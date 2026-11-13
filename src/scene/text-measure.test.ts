/**
 * Tests of `estimateTextSize`.
 *
 * Checks the key properties of the pure text-size estimate:
 * 1. Short text (1 line, width < maxContentWidth).
 * 2. Long text (several lines, width = maxContentWidth).
 * 3. Text with an explicit '\n' (counts lines correctly).
 * 4. Empty text (valid minimal box).
 */
import { describe, it, expect } from 'vitest'
import { estimateTextSize, fitTitleFontSize, TITLE_FONT_SIZE_MIN, TEXT_LINE_HEIGHT, TEXT_PADDING, ROLE_STYLE, markerizeText } from './text-measure.js'

/** Representative maximum content width (a representative column width minus 2*TEXT_PADDING). */
const MAX_CONTENT_WIDTH = 264

/** Height of a single line including line spacing, rounded up. */
const ONE_LINE_HEIGHT = Math.ceil(ROLE_STYLE.cuerpo.fontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING

describe('estimateTextSize', () => {
  it('short text (1 line, width < max): box narrower than the maximum', () => {
    // "Hola" = 4 caracteres × 9.9 px/char ≈ 39.6 px (< 264 px).
    const { width, height } = estimateTextSize('Hola', MAX_CONTENT_WIDTH)

    // The box must not reach the maximum possible width.
    expect(width).toBeLessThan(MAX_CONTENT_WIDTH + 2 * TEXT_PADDING)
    // A single line → standard line height.
    expect(height).toBe(ONE_LINE_HEIGHT)
    // Positive integer dimensions.
    expect(width).toBeGreaterThan(0)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })

  it('long text (several lines, width = max): box as wide as the maximum and taller', () => {
    // A very long word (no spaces) exceeding maxContentWidth → placed alone
    // on its line with maxLineContentWidth > maxContentWidth → contentWidth = maxContentWidth.
    // A short prefix forces at least 2 lines.
    const longText = 'breve ' + 'a'.repeat(200)
    const { width, height } = estimateTextSize(longText, MAX_CONTENT_WIDTH)

    // Box width = ceil(maxContentWidth) + 2*padding.
    expect(width).toBe(Math.ceil(MAX_CONTENT_WIDTH) + 2 * TEXT_PADDING)
    // Several lines → height > 1 line.
    expect(height).toBeGreaterThan(ONE_LINE_HEIGHT)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })

  it('empty text: returns a valid minimal box (no errors)', () => {
    const { width, height } = estimateTextSize('', MAX_CONTENT_WIDTH)

    // At least 1 line → height = ONE_LINE_HEIGHT.
    expect(height).toBe(ONE_LINE_HEIGHT)
    // Reasonable minimum width.
    expect(width).toBeGreaterThanOrEqual(40)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })
})

// ── Role tests ──────────────────────────────────────────

describe('estimateTextSize — roles', () => {
  it('titulo measures taller than cuerpo for the same text (fontSize 28 > 18)', () => {
    const text = 'El ciclo del agua'
    const { height: heightTitle } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'titulo')
    const { height: heightBody } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'cuerpo')
    expect(heightTitle).toBeGreaterThan(heightBody)
  })

  it('lista with 3 lines measures 3 items with a "• " marker prefixed', () => {
    const text = 'Mamíferos\nAves\nPeces'
    const { height } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'lista')
    const threeLineHeight = Math.ceil(3 * ROLE_STYLE['lista'].fontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
    expect(height).toBe(threeLineHeight)
  })

  it('enumeracion with 2 lines measures 2 items with numbered markers', () => {
    const text = 'Primero\nSegundo'
    const { height } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'enumeracion')
    const twoLineHeight = Math.ceil(2 * ROLE_STYLE['enumeracion'].fontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
    expect(height).toBe(twoLineHeight)
  })

  it('no role defaults to cuerpo (same result as role="cuerpo")', () => {
    const text = 'Texto de prueba'
    const withoutRole = estimateTextSize(text, MAX_CONTENT_WIDTH)
    const withBody = estimateTextSize(text, MAX_CONTENT_WIDTH, 'cuerpo')
    expect(withoutRole).toEqual(withBody)
  })

  it('subtitulo measures taller than cuerpo and shorter than titulo', () => {
    const text = 'Vertebrados'
    const { height: hSub } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'subtitulo')
    const { height: hBody } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'cuerpo')
    const { height: hTitle } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'titulo')
    expect(hSub).toBeGreaterThan(hBody)
    expect(hSub).toBeLessThan(hTitle)
  })
})

// ── Per-role background tests ───────────────────────────────

describe('ROLE_STYLE — text background', () => {
  it('only title and subtitle carry a background; body/list/enumeration do not', () => {
    expect(ROLE_STYLE.titulo.hasBackground).toBe(true)
    expect(ROLE_STYLE.subtitulo.hasBackground).toBe(true)
    expect(ROLE_STYLE.cuerpo.hasBackground).toBe(false)
    expect(ROLE_STYLE.lista.hasBackground).toBe(false)
    expect(ROLE_STYLE.enumeracion.hasBackground).toBe(false)
  })

})

// ── markerizeText tests ────────────────────────────────────

describe('markerizeText — list/enumeration markers', () => {
  it('lista role: prefixes "• " to each item separated by a line break', () => {
    expect(markerizeText('piedra\npupitre', 'lista')).toBe('• piedra\n• pupitre')
  })

  it('listStart 0: no marker, and the one the model wrote is stripped', () => {
    expect(markerizeText('1. uno', 'enumeracion', 0)).toBe('uno')
    expect(markerizeText('- uno', 'lista', 0)).toBe('uno')
  })

  it('enumeracion role: prefixes a 1-indexed "N. " to each item', () => {
    expect(markerizeText('uno\ndos\ntres', 'enumeracion')).toBe('1. uno\n2. dos\n3. tres')
  })

  it('strips the number / bullet the model already wrote (no double marker)', () => {
    expect(markerizeText('2. **Condensation** water', 'enumeracion')).toBe('1. **Condensation** water')
    expect(markerizeText('1) uno\n2. dos', 'enumeracion')).toBe('1. uno\n2. dos')
    expect(markerizeText('1.5 litros', 'enumeracion')).toBe('1. 1.5 litros')
    expect(markerizeText('- a\n• b', 'lista')).toBe('• a\n• b')
  })

  it('roles without a marker (cuerpo/subtitulo/titulo/nota): text unchanged', () => {
    expect(markerizeText('Sólido', 'subtitulo')).toBe('Sólido')
    expect(markerizeText('cuerpo normal', 'cuerpo')).toBe('cuerpo normal')
    expect(markerizeText('x', undefined)).toBe('x') // default 'cuerpo'
  })

  it('keeps empty lines without a marker', () => {
    expect(markerizeText('a\n\nb', 'lista')).toBe('• a\n\n• b')
  })

  it('a single item in a list also gets a bullet', () => {
    expect(markerizeText('aire', 'lista')).toBe('• aire')
  })

  it('the background does not alter measurement: estimateTextSize returns the same result as before', () => {
    // Representative one-line text with role cuerpo (which has a background).
    // The expected values are deterministic and must not change when the background field is added.
    const text = 'Hola mundo'
    const { width, height } = estimateTextSize(text, MAX_CONTENT_WIDTH, 'cuerpo')
    // 10 chars × 18px × 0.55 = 99 px → contentWidth = 99 → width = 99 + 16 = 115.
    // height = ceil(1 × 18 × 1.3) + 16 = ceil(23.4) + 16 = 24 + 16 = 40.
    expect(width).toBe(115)
    expect(height).toBe(40)
  })
})

// ── fitTitleFontSize tests ─────────────────────────────────

describe('fitTitleFontSize', () => {
  const TITULO_MAX_FS = ROLE_STYLE.titulo.fontSize  // 28

  it('short text in a generous width → maximum fontSize (28)', () => {
    // "Hola" = 4 chars; 4 * 28 * 0.55 = 61.6 <= 1000 → fits at 28.
    const result = fitTitleFontSize('Hola', 1000)
    expect(result).toBe(TITULO_MAX_FS)
  })

  it('very long text in a narrow width → minimum fontSize (14)', () => {
    // 200 chars * 14 * 0.55 = 1540 > 200 → does not fit even at 14. Returns 14 (floor).
    const result = fitTitleFontSize('a'.repeat(200), 200)
    expect(result).toBe(TITLE_FONT_SIZE_MIN)
  })

  it('empty text → maximum fontSize (28)', () => {
    const result = fitTitleFontSize('', 200)
    expect(result).toBe(TITULO_MAX_FS)
  })

  it('monotonicity: more available width → fontSize ≥', () => {
    const text = 'El ciclo del agua en la naturaleza'
    const fs1 = fitTitleFontSize(text, 300)
    const fs2 = fitTitleFontSize(text, 600)
    expect(fs2).toBeGreaterThanOrEqual(fs1)
  })

  it('text with \\n collapses to a single line for the computation', () => {
    // "A\nB" = 3 chars with the space; same result as "A B" (3 chars).
    const withNewline = fitTitleFontSize('A\nB', 500)
    const withSpace   = fitTitleFontSize('A B', 500)
    expect(withNewline).toBe(withSpace)
  })

  it('returns an integer', () => {
    const result = fitTitleFontSize('Texto de prueba del pizarrón', 400)
    expect(Number.isInteger(result)).toBe(true)
  })
})

// ── estimateTextSize with role:'titulo' ───────────────

describe('estimateTextSize — role titulo', () => {
  // Representative width of the full canvas (1200 - 2*24 - 2*8 = 1136).
  const MAX_CW_BOARD = 1136

  it('height = a single line at the fittedFontSize', () => {
    const text = 'El ciclo del agua'
    const fittedFontSize = fitTitleFontSize(text, MAX_CW_BOARD)
    const expectedHeight = Math.ceil(fittedFontSize * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
    const { height } = estimateTextSize(text, MAX_CW_BOARD, 'titulo')
    expect(height).toBe(expectedHeight)
  })

  it('width = natural text width (one line, at the fittedFontSize) + 2*PADDING, not the full available width', () => {
    const text = 'Hola'
    const fittedFontSize = fitTitleFontSize(text, MAX_CW_BOARD)
    const expectedWidth = Math.ceil(text.length * fittedFontSize * 0.55) + 2 * TEXT_PADDING
    const { width } = estimateTextSize(text, MAX_CW_BOARD, 'titulo')
    expect(width).toBe(expectedWidth)
    expect(width).toBeLessThan(Math.ceil(MAX_CW_BOARD) + 2 * TEXT_PADDING)
  })

  it('text with \\n does not produce 2 lines (treated as a single line)', () => {
    const { height: h1 } = estimateTextSize('Línea 1', MAX_CW_BOARD, 'titulo')
    const { height: h2 } = estimateTextSize('Línea 1\nLínea 2', MAX_CW_BOARD, 'titulo')
    // Both must produce the height of a SINGLE line.
    expect(h1).toBe(h2)
  })

  it('short title in a wide width → natural width SMALLER than a long title (natural width, not full-width)', () => {
    const { width: w1 } = estimateTextSize('Hola', MAX_CW_BOARD, 'titulo')
    const { width: w2 } = estimateTextSize('Un título bastante más largo que el anterior', MAX_CW_BOARD, 'titulo')
    expect(w1).toBeLessThan(w2)
  })
})

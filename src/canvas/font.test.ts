import { describe, it, expect, vi, afterEach } from 'vitest'
import { FONT_FAMILY, ensureBoardFontLoaded } from './font.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('font: single stack and preloading', () => {
  it('the stack starts with the bundled font and keeps fallbacks', () => {
    expect(FONT_FAMILY.startsWith('"Kalam"')).toBe(true)
    expect(FONT_FAMILY).toContain('cursive')
  })

  it('without document.fonts (jsdom) it resolves without breaking', async () => {
    vi.stubGlobal('document', {})
    await expect(ensureBoardFontLoaded()).resolves.toBeUndefined()
  })

  it('waits for fonts.load and fonts.ready when present', async () => {
    const load = vi.fn().mockResolvedValue([])
    vi.stubGlobal('document', { fonts: { load, ready: Promise.resolve() } })
    await ensureBoardFontLoaded()
    expect(load).toHaveBeenCalledTimes(2)
    const requested = load.mock.calls.map((c) => String(c[0]))
    expect(requested.some((p) => p.startsWith('700 ') && p.includes('"Kalam"'))).toBe(true)
    expect(requested.some((p) => p.startsWith('400 ') && p.includes('"Kalam"'))).toBe(true)
  })

  it('if fonts.load fails, it does not reject', async () => {
    const load = vi.fn().mockRejectedValue(new Error('x'))
    vi.stubGlobal('document', { fonts: { load, ready: Promise.resolve() } })
    await expect(ensureBoardFontLoaded()).resolves.toBeUndefined()
  })
})

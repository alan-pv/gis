import { describe, it, expect } from 'vitest'
import { computeEditorStyle, editorKeyAction, resolveEditorCommit } from './inplace-edit.js'
import { TEXT_PADDING, TEXT_LINE_HEIGHT, ROLE_STYLE } from '@/scene/text-measure.js'

const box = { x: 100, y: 50, width: 300, height: 60 }

describe('computeEditorStyle', () => {
  it('positions and scales with the viewport', () => {
    const s = computeEditorStyle({ box, role: 'cuerpo', color: '#111', view: { scale: 2, x: 10, y: 20 } })
    expect(s.left).toBe(210)
    expect(s.top).toBe(120)
    expect(s.width).toBe(600)
    expect(s.minHeight).toBe(120)
    expect(s.padding).toBe(TEXT_PADDING * 2)
    expect(s.fontSize).toBe(ROLE_STYLE.cuerpo.fontSize * 2)
    expect(s.lineHeight).toBe(`${ROLE_STYLE.cuerpo.fontSize * 2 * TEXT_LINE_HEIGHT}px`)
    expect(s.fontWeight).toBe('normal')
    expect(s.whiteSpace).toBe('pre-wrap')
  })
  it('title and subtitle in bold; title not wrapped; respects auto-fit fontSize', () => {
    const view = { scale: 1, x: 0, y: 0 }
    const t = computeEditorStyle({ box, role: 'titulo', fontSize: 20, color: '#000', view })
    expect(t.fontWeight).toBe('bold')
    expect(t.whiteSpace).toBe('pre')
    expect(t.fontSize).toBe(20)
    expect(computeEditorStyle({ box, role: 'subtitulo', color: '#000', view }).fontSize).toBe(22)
  })
})

describe('editorKeyAction', () => {
  it('Enter confirms, Shift+Enter inserts a line break in body, Escape cancels', () => {
    expect(editorKeyAction('Enter', false, 'cuerpo')).toBe('confirm')
    expect(editorKeyAction('Enter', true, 'cuerpo')).toBe('newline')
    expect(editorKeyAction('Escape', false, 'cuerpo')).toBe('cancel')
    expect(editorKeyAction('a', false, 'cuerpo')).toBeNull()
  })
  it('in title/subtitle Shift+Enter also confirms', () => {
    expect(editorKeyAction('Enter', true, 'titulo')).toBe('confirm')
    expect(editorKeyAction('Enter', true, 'subtitulo')).toBe('confirm')
  })
})

describe('resolveEditorCommit', () => {
  it('applies a different text, trimmed', () => {
    expect(resolveEditorCommit('hola', '  hola **mundo** ', 'cuerpo')).toEqual({ apply: true, text: 'hola **mundo**' })
  })
  it('does not apply when empty or unchanged', () => {
    expect(resolveEditorCommit('hola', '   ', 'cuerpo')).toEqual({ apply: false })
    expect(resolveEditorCommit('hola', 'hola ', 'cuerpo')).toEqual({ apply: false })
  })
  it('flattens the title to a single line', () => {
    expect(resolveEditorCommit('a', 'uno\ndos', 'titulo')).toEqual({ apply: true, text: 'uno dos' })
  })
})

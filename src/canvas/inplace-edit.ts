/**
 * inplace-edit.ts — pure logic of in-place text editing.
 *
 * On double click over a board text, a <textarea> is overlaid EXACTLY on the object box
 * (same font, color, padding and line height, scaled by the fixed viewport); the
 * object's `RunsText` node is hidden while editing. This module imports neither React nor
 * Konva: it computes the editor style and decides what to do on a key or on close.
 *
 * DESIGN CHOICE: the editor shows the SOURCE text with the `**` marks visible. This is the
 * simplest and most robust option: it keeps the bold without mapping positions between plain
 * text and marked text, and the result travels through the same `update set.text` as always.
 * List markers ("• ", "1. ") are NOT shown (the render adds them, they are not in the source text).
 */
import type { Role } from '@/contract/index.js'
import { ROLE_STYLE, TEXT_LINE_HEIGHT, TEXT_PADDING } from '@/scene/text-measure.js'
import { canvasToScreen, type Viewport } from './viewport.js'
import { FONT_FAMILY } from './font.js'

export interface EditorStyleInput {
  /** Box of the object (or of its first fragment) in logical canvas coords. */
  box: { x: number; y: number; width: number; height: number }
  role: Role | null | undefined
  /** Effective font size (title auto-fit); if missing, the role's. */
  fontSize?: number
  /** Text color (the same one the render uses). */
  color: string
  view: Viewport
}

export interface EditorStyle {
  left: number
  top: number
  width: number
  minHeight: number
  fontFamily: string
  fontSize: number
  fontWeight: 'bold' | 'normal'
  lineHeight: string
  padding: number
  color: string
  /** The title does not wrap (a single line, as in the render). */
  whiteSpace: 'pre' | 'pre-wrap'
}

/** Editor style in screen px, from the box, the role and the viewport. */
export function computeEditorStyle(input: EditorStyleInput): EditorStyle {
  const { box, role, view, color } = input
  const style = ROLE_STYLE[role ?? 'cuerpo']
  const fontSize = (input.fontSize ?? style.fontSize) * view.scale
  const origin = canvasToScreen({ x: box.x, y: box.y }, view)
  return {
    left: origin.x,
    top: origin.y,
    width: box.width * view.scale,
    minHeight: box.height * view.scale,
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight: style.fontStyle,
    lineHeight: `${fontSize * TEXT_LINE_HEIGHT}px`,
    padding: TEXT_PADDING * view.scale,
    color,
    whiteSpace: role === 'titulo' ? 'pre' : 'pre-wrap',
  }
}

export type EditorKeyAction = 'confirm' | 'cancel' | 'newline' | null

/**
 * What a key does: Enter confirms (Shift+Enter inserts a line break except in
 * title/subtitle, which are single-line), Escape cancels, anything else types.
 */
export function editorKeyAction(key: string, shiftKey: boolean, role: Role | null | undefined): EditorKeyAction {
  if (key === 'Escape') return 'cancel'
  if (key !== 'Enter') return null
  const oneLine = role === 'titulo' || role === 'subtitulo'
  return shiftKey && !oneLine ? 'newline' : 'confirm'
}

export type EditorCommit = { apply: true; text: string } | { apply: false }

/**
 * Result of closing the editor by confirming. Nothing is applied if the text ends up empty
 * (editing never deletes an object) or did not change. The title is flattened to one line.
 */
export function resolveEditorCommit(initial: string, draft: string, role: Role | null | undefined): EditorCommit {
  let text = draft.trim()
  if (role === 'titulo') text = text.split(/\s*\n\s*/).join(' ')
  if (text === '' || text === initial.trim()) return { apply: false }
  return { apply: true, text }
}

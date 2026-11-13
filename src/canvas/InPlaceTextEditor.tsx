/**
 * InPlaceTextEditor.tsx — <textarea> overlaid on the box of a board text.
 *
 * Visually replaces the text (the Konva node is hidden meanwhile) with the same
 * font, color, padding and line height. Style and keys: `inplace-edit.ts` (pure).
 * Imperative focus + blur guard on mount, like `TextBoxOverlay`: Konva takes the focus
 * back on the pointerup after the double click.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Role } from '@/contract/index.js'
import { computeEditorStyle, editorKeyAction, resolveEditorCommit, type EditorStyleInput } from './inplace-edit.js'

const BLUR_GUARD_MS = 300

export interface InPlaceTextEditorProps extends EditorStyleInput {
  role: Role | null | undefined
  initialText: string
  /** New text, already validated (non-empty, different from the original). */
  onCommit: (text: string) => void
  /** Closed without changes (Escape, empty or identical): nothing is applied. */
  onCancel: () => void
}

export function InPlaceTextEditor({ initialText, onCommit, onCancel, ...styleInput }: InPlaceTextEditorProps) {
  const [value, setValue] = useState(initialText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const doneRef = useRef(false)
  const mountedAtRef = useRef(0)
  const s = computeEditorStyle(styleInput)

  const finish = useCallback((confirm: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    const r = confirm ? resolveEditorCommit(initialText, value, styleInput.role) : { apply: false as const }
    if (r.apply) onCommit(r.text)
    else onCancel()
  }, [initialText, value, styleInput.role, onCommit, onCancel])

  // The height grows with the content (never below the original box).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, s.minHeight)}px`
  }, [value, s.minHeight, s.width, s.fontSize])

  useEffect(() => {
    mountedAtRef.current = Date.now()
    const id = setTimeout(() => {
      const el = ref.current
      if (el && !doneRef.current) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }, 50)
    return () => clearTimeout(id)
  }, [])

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      value={value}
      rows={1}
      spellCheck={false}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return
        const action = editorKeyAction(e.key, e.shiftKey, styleInput.role)
        if (action === null || action === 'newline') { e.stopPropagation(); return }
        e.preventDefault()
        e.stopPropagation()
        finish(action === 'confirm')
      }}
      onBlur={() => {
        if (Date.now() - mountedAtRef.current < BLUR_GUARD_MS) return
        finish(true)
      }}
      style={{
        position: 'absolute',
        left: s.left,
        top: s.top,
        width: s.width,
        minHeight: s.minHeight,
        boxSizing: 'border-box',
        margin: 0,
        padding: s.padding,
        border: 'none',
        borderRadius: 6,
        outline: '1px dashed rgba(37, 99, 235, 0.55)',
        outlineOffset: 0,
        background: 'transparent',
        resize: 'none',
        overflow: 'hidden',
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        whiteSpace: s.whiteSpace,
        zIndex: 20,
      }}
    />
  )
}

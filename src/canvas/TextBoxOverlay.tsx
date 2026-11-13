/**
 * TextBoxOverlay.tsx — floating HTML input for typing text.
 *
 * Appears over the canvas at the point where the teacher double-clicked.
 * On confirm (Enter or blur with text) it calls `onConfirm` with the trimmed
 * text. On cancel (Escape or empty blur) it calls `onCancel`.
 *
 * Same pattern as DeleteObjectButton: an absolutely positioned overlay with
 * coords passed as props and styling in a CSS module with --gis-* tokens.
 * The input height (~28 px) is centered on the double-click point.
 *
 * Focus fix: autoFocus is not enough because Konva captures the focus on the
 * pointerup following the double-click. Imperative focus is forced in a useEffect
 * so the input always gets it back. Also, a blur right after mount
 * (< BLUR_GUARD_MS ms) is ignored so the box does not close before the teacher
 * has typed anything.
 */
import { useRef, useState, useCallback, useEffect } from 'react'
import styles from './TextBoxOverlay.module.css'

/** Approximate height of the input, to center it vertically on the click point. */
const INPUT_HEIGHT = 28

/**
 * Window in ms during which a blur right after mount is ignored.
 * Keeps Konva from stealing the focus just after the double-click and closing the overlay.
 */
const BLUR_GUARD_MS = 300

export interface TextBoxOverlayProps {
  /** Absolute X coord inside the stage container (double-click point). */
  x: number
  /** Absolute Y coord inside the stage container (double-click point). */
  y: number
  /**
   * Initial text of the input; used when editing an already existing text object.
   * Without this prop (new insertion) the input starts empty.
   */
  initialText?: string
  /** Trimmed, non-empty text confirmed by the teacher. */
  onConfirm: (text: string) => void
  /** The teacher cancelled (Escape, empty blur). */
  onCancel: () => void
}

export function TextBoxOverlay({ x, y, initialText, onConfirm, onCancel }: TextBoxOverlayProps) {
  const [value, setValue] = useState(initialText ?? '')
  // Flag to avoid a double confirm firing (Enter followed by blur)
  const doneRef = useRef(false)
  // Ref to the input element for imperative focus
  const inputRef = useRef<HTMLInputElement>(null)
  // Mount timestamp to ignore an immediate blur (Konva steals the focus after pointerup)
  const mountedAtRef = useRef(0)

  const confirm = useCallback((text: string) => {
    if (doneRef.current) return
    doneRef.current = true
    onConfirm(text)
  }, [onConfirm])

  const cancel = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }, [onCancel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      const trimmed = value.trim()
      if (trimmed) {
        confirm(trimmed)
      } else {
        cancel()
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      cancel()
    }
  }, [value, confirm, cancel])

  const handleBlur = useCallback(() => {
    // Ignore a blur very close to mount: Konva fires a pointerup/focus-shift
    // right after the input mounts, which would steal the focus and close
    // the box before the teacher can type.
    if (Date.now() - mountedAtRef.current < BLUR_GUARD_MS) return
    const trimmed = value.trim()
    if (trimmed) {
      confirm(trimmed)
    } else {
      cancel()
    }
  }, [value, confirm, cancel])

  // Reset the ref on mount (in case the component is reused)
  useEffect(() => {
    doneRef.current = false
    mountedAtRef.current = Date.now()
  }, [])

  // Imperative focus: autoFocus is sometimes not enough because the pointerup of the
  // double-click (which arrives after mount) returns the focus to the Konva Stage.
  // We request the focus with a small delay to beat the pointerup.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!doneRef.current) {
        inputRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(id)
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.input}
      style={{
        left: x,
        top: y - INPUT_HEIGHT / 2,
      }}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      autoFocus
      aria-label="Text box"
      placeholder="Type…"
    />
  )
}

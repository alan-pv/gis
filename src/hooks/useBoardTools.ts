/**
 * useBoardTools — the teacher's manual tools on the board: active tool and pen
 * color, object selection, text-box insertion and in-place editing, ink handling
 * (erase, move, undo) and the keyboard shortcuts.
 */
import { useCallback, useEffect, useState } from 'react'
import { SCHEMA_VERSION } from '@/contract/index.js'
import type { Color } from '@/ink/index.js'
import type { CanvasTool } from '@/canvas/SceneCanvas.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'
import { activeScene } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'
import type { BBox } from '@/layout/index.js'
import type { ApplyEnvelopeResult } from './useDocumentState.js'
import type { ValidationMode } from '@/validator/index.js'

type ApplyEnvelope = (raw: unknown, canvas: { width: number; height: number }, mode?: ValidationMode) => ApplyEnvelopeResult

export interface UseBoardToolsOptions {
  document: GisDocument
  /** A turn animation or a model call is in progress: the text box cannot open. */
  isRunning: boolean
  isInterpreting: boolean
  setIsRunning: (running: boolean) => void
  applyEnvelope: ApplyEnvelope
  objectMoved: (id: string, newBox: BBox) => void
  removeObject: (id: string) => void
  undo: () => void
}

/** Envelope that inserts a `text` object with the given content (double-click text box). */
function buildTextEnvelope(text: string) {
  return {
    schema_version: SCHEMA_VERSION,
    operations: [{ op: 'add' as const, id: 'texto_1', object: 'texto', text }],
  }
}

export function useBoardTools({
  document, isRunning, isInterpreting, setIsRunning, applyEnvelope,
  objectMoved, removeObject, undo,
}: UseBoardToolsOptions) {
  // Active canvas tool.
  const [tool, setTool] = useState<CanvasTool>('select')

  // Active pen color; persists across tool or page changes
  const [penColor, setPenColor] = useState<Color>('black')

  // Selected object id (null = none); ephemeral, not part of the reducer
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Floating text box: null = closed; { x, y } = new insertion at that board point.
  // Editing an existing text goes separately (`editingId`, in place).
  const [textBoxAt, setTextBoxAt] = useState<{ x: number; y: number } | null>(null)
  /** Board text being edited in place: its id, to hide it and apply the change. */
  const [editingId, setEditingId] = useState<string | null>(null)

  /** Hides the selection (the board may be about to change). */
  const clearTransient = useCallback(() => {
    setSelectedId(null)
  }, [])

  const handleSetTool = useCallback((newTool: CanvasTool) => {
    setSelectedId(null)
    setTool(newTool)
  }, [])

  /** Double click on empty area with the select tool: opens the text box at that point. */
  const handleRequestTextBox = useCallback((point: { x: number; y: number }) => {
    if (isRunning || isInterpreting) return
    setSelectedId(null)
    setTextBoxAt(point)
  }, [isRunning, isInterpreting])

  /** Text box confirmation: inserts a new text object and moves it to the double-click point. */
  const handleTextBoxConfirm = useCallback((text: string) => {
    const point = textBoxAt
    if (!point) return

    const env = buildTextEnvelope(text)
    const { steps, created } = applyEnvelope(env, { width: CANVAS_W, height: CANVAS_H }, 'slide')
    // Move to the exact double-click point (same as dragging)
    const obj = created[0]
    if (obj) {
      objectMoved(obj.id, {
        x: point.x,
        y: point.y - obj.box.height / 2,
        width: obj.box.width,
        height: obj.box.height,
      })
    }
    if (steps > 0) setIsRunning(true)
    setTextBoxAt(null)
  }, [textBoxAt, applyEnvelope, objectMoved, setIsRunning])

  /** Closes the text box without inserting anything. */
  const handleTextBoxCancel = useCallback(() => setTextBoxAt(null), [])

  /** Double click on an existing text object: edits it in place. */
  const handleRequestEditText = useCallback((objectId: string) => {
    if (isRunning || isInterpreting) return
    const scene = activeScene(document)
    const obj = scene.objects.get(objectId)
    if (!obj) return
    setSelectedId(null)
    setEditingId(objectId)
  }, [isRunning, isInterpreting, document])

  /** Commits the in-place edit through the usual path (envelope `update set.text`). */
  const handleEditCommit = useCallback((text: string) => {
    const id = editingId
    setEditingId(null)
    if (!id) return
    const env = {
      schema_version: SCHEMA_VERSION,
      operations: [{ op: 'update' as const, ref: id, set: { text } }],
    }
    const { steps } = applyEnvelope(env, { width: CANVAS_W, height: CANVAS_H }, 'slide')
    if (steps > 0) setIsRunning(true)
  }, [editingId, applyEnvelope, setIsRunning])
  const handleEditCancel = useCallback(() => setEditingId(null), [])

  // Derived auto-clean: if the object no longer exists in the active scene (cascade
  // delete, reset, page change) the effective selection is null. Resolved at render
  // (not in an effect) to avoid cascading renders.
  const effectiveSelectedId =
    selectedId !== null && activeScene(document).objects.has(selectedId)
      ? selectedId
      : null

  // Delete / Backspace with a selected object and the select tool.
  // Does not interfere with inputs / textareas nor with the eraser.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (effectiveSelectedId === null || tool !== 'select') return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      removeObject(effectiveSelectedId)
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [effectiveSelectedId, tool, removeObject])

  // Shortcuts: never fire inside input/textarea/contentEditable. V/P/E switch
  // tool; Ctrl+Z undoes. Delete/Backspace has its own effect above.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey || typing) return // shift+z = redo (not implemented); in inputs, native undo
          e.preventDefault()
          undo()
        }
        return
      }

      if (typing || e.altKey) return
      if (e.key === 'v' || e.key === 'V') handleSetTool('select')
      else if (e.key === 'p' || e.key === 'P') handleSetTool('pen')
      else if (e.key === 'e' || e.key === 'E') handleSetTool('eraser')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, handleSetTool])

  /** Back to the initial tool state (new board / full reset). */
  const reset = useCallback(() => {
    setSelectedId(null)
    setTextBoxAt(null)
    setTool('select')
  }, [])

  return {
    tool, penColor, setPenColor, selectedId: effectiveSelectedId, setSelectedId,
    textBoxAt, editingId,
    clearTransient, reset,
    handleSetTool, handleRequestTextBox, handleTextBoxConfirm, handleTextBoxCancel,
    handleRequestEditText, handleEditCommit, handleEditCancel,
      }
}

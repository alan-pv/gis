/**
 * useBoardTools — the teacher's manual tools on the board: active tool and pen
 * color, object selection, text-box insertion and in-place editing, ink handling
 * (erase, move, marquee, undo), shape promotion (manual and automatic) and the
 * keyboard shortcuts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SCHEMA_VERSION } from '@/contract/index.js'
import type { Color, Library } from '@/library/index.js'
import type { CanvasTool } from '@/canvas/SceneCanvas.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'
import { activeScene, activeInk } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'
import type { SelectionRect } from '@/ink/index.js'
import type { RecognizerTemplate } from '@/recognizer/index.js'
import { suggestForSelection, suggestForInk } from '@/recognizer/suggest.js'
import type { BBox } from '@/layout/index.js'
import type { ApplyEnvelopeResult } from './useDocumentState.js'
import type { ValidationMode } from '@/validator/index.js'

/**
 * Debounce of ink auto-promotion: pause without a new stroke after which the
 * recognizer runs on the final group. Longer than a single figure needs so that
 * multi-stroke figures and text are not cut while the teacher is still drawing.
 */
const AUTO_PROMOTE_DEBOUNCE_MS = 1200

type ApplyEnvelope = (raw: unknown, library: Library, canvas: { width: number; height: number }, mode?: ValidationMode) => ApplyEnvelopeResult

export interface UseBoardToolsOptions {
  document: GisDocument
  library: Library
  recognizerTemplates: RecognizerTemplate[]
  /** A turn animation or a model call is in progress: the text box cannot open. */
  isRunning: boolean
  isInterpreting: boolean
  setIsRunning: (running: boolean) => void
  applyEnvelope: ApplyEnvelope
  objectMoved: (id: string, newBox: BBox) => void
  removeInkStroke: (id: string) => void
  moveInkStroke: (id: string, dx: number, dy: number) => void
  removeObject: (id: string) => void
  undo: () => void
  promoteInkStrokes: (strokeIds: string[], objectType: string) => void
}

/** Envelope that inserts a `text` object with the given content (double-click text box). */
function buildTextEnvelope(text: string) {
  return {
    schema_version: SCHEMA_VERSION,
    operations: [{ op: 'add' as const, id: 'texto_1', object: 'texto', text }],
  }
}

export function useBoardTools({
  document, library, recognizerTemplates, isRunning, isInterpreting, setIsRunning, applyEnvelope,
  objectMoved, removeInkStroke, moveInkStroke, removeObject, undo, promoteInkStrokes,
}: UseBoardToolsOptions) {
  // Marquee selection of strokes
  const [inkSelection, setInkSelection] = useState<{ strokeIds: string[]; rect: SelectionRect } | null>(null)

  // Active canvas tool. Changing tool hides the shape menu.
  const [tool, setTool] = useState<CanvasTool>('select')

  // Active pen color; persists across tool or page changes
  const [penColor, setPenColor] = useState<Color>('negro')

  // Selected object id (null = none); ephemeral, not part of the reducer
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Floating text box: null = closed; { x, y } = new insertion at that board point.
  // Editing an existing text goes separately (`editingId`, in place).
  const [textBoxAt, setTextBoxAt] = useState<{ x: number; y: number } | null>(null)
  /** Board text being edited in place: its id, to hide it and apply the change. */
  const [editingId, setEditingId] = useState<string | null>(null)

  /** Hides the shape menu and the selection (the board may be about to change). */
  const clearTransient = useCallback(() => {
    setInkSelection(null)
    setSelectedId(null)
  }, [])

  const handleSetTool = useCallback((newTool: CanvasTool) => {
    setInkSelection(null)
    setSelectedId(null)
    setTool(newTool)
  }, [])

  /** Double click on empty area with the select tool: opens the text box at that point. */
  const handleRequestTextBox = useCallback((point: { x: number; y: number }) => {
    if (isRunning || isInterpreting) return
    setInkSelection(null)
    setSelectedId(null)
    setTextBoxAt(point)
  }, [isRunning, isInterpreting])

  /** Text box confirmation: inserts a new text object and moves it to the double-click point. */
  const handleTextBoxConfirm = useCallback((text: string) => {
    const point = textBoxAt
    if (!point) return

    const env = buildTextEnvelope(text)
    const { steps, created } = applyEnvelope(env, library, { width: CANVAS_W, height: CANVAS_H }, 'slide')
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
  }, [textBoxAt, applyEnvelope, library, objectMoved, setIsRunning])

  /** Closes the text box without inserting anything. */
  const handleTextBoxCancel = useCallback(() => setTextBoxAt(null), [])

  /** Double click on an existing text object: edits it in place. */
  const handleRequestEditText = useCallback((objectId: string) => {
    if (isRunning || isInterpreting) return
    const scene = activeScene(document)
    const obj = scene.objects.get(objectId)
    if (!obj) return
    setInkSelection(null)
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
    const { steps } = applyEnvelope(env, library, { width: CANVAS_W, height: CANVAS_H }, 'slide')
    if (steps > 0) setIsRunning(true)
  }, [editingId, applyEnvelope, library, setIsRunning])
  const handleEditCancel = useCallback(() => setEditingId(null), [])

  /** Erasing a stroke that belonged to the active selection closes the menu. */
  const handleInkStrokeErased = useCallback((id: string) => {
    removeInkStroke(id)
    setInkSelection(prev => {
      if (!prev) return null
      if (prev.strokeIds.includes(id)) return null
      return prev
    })
  }, [removeInkStroke])

  /** Moving a stroke that belonged to the active selection closes the menu. */
  const handleInkStrokeMoved = useCallback((id: string, dx: number, dy: number) => {
    moveInkStroke(id, dx, dy)
    setInkSelection(prev => {
      if (!prev) return null
      if (prev.strokeIds.includes(id)) return null
      return prev
    })
  }, [moveInkStroke])

  /** Undo of the last reversible action of the active page; closes the shape menu (the selection may be stale). */
  const handleUndo = useCallback(() => {
    undo()
    setInkSelection(null)
  }, [undo])

  /** Promotes the strokes of the active selection to the chosen type and closes the menu. */
  const handlePromote = useCallback((objectType: string) => {
    if (!inkSelection) return
    promoteInkStrokes(inkSelection.strokeIds, objectType)
    setInkSelection(null)
  }, [inkSelection, promoteInkStrokes])

  /** Marquee released with at least one captured stroke. */
  const handleMarqueeSelect = useCallback((strokeIds: string[], rect: SelectionRect) => {
    setInkSelection({ strokeIds, rect })
  }, [])

  const handleCloseShapeMenu = useCallback(() => {
    setInkSelection(null)
  }, [])

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
          handleUndo()
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
  }, [handleUndo, handleSetTool])

  // Promotion suggestion derived from the ink selection: computed ON SELECTING
  // (not on drawing). null if there is no selection or nothing is recognized.
  const selectionSuggestion = useMemo(() => {
    if (!inkSelection) return null
    const inkLayer = activeInk(document)
    const strokes = inkSelection.strokeIds
      .map(id => inkLayer.strokes.find(s => s.id === id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
    if (strokes.length === 0) return null
    return suggestForSelection(strokes, recognizerTemplates)
  }, [inkSelection, document, recognizerTemplates])

  // Confidence-gated auto-promotion: after the teacher stops drawing (debounce),
  // the recognizer runs on the final group of strokes (trailingGroup, via
  // suggestForInk). If the top-1 confidence passes the threshold the strokes are
  // promoted to the recognized object by themselves; below it the ink stays mute.
  const activeInkStrokes = activeInk(document).strokes
  useEffect(() => {
    if (activeInkStrokes.length === 0) return

    const timer = setTimeout(() => {
      // If the user kept drawing, the next effect run already cancelled this timer,
      // so activeInkStrokes here is the last "stable snapshot".
      const suggestion = suggestForInk(activeInkStrokes, recognizerTemplates)
      if (!suggestion) return
      const topCandidate = suggestion.candidates[0]!
      promoteInkStrokes(suggestion.strokeIds, topCandidate.name)
    }, AUTO_PROMOTE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  // promoteInkStrokes wraps dispatch (stable) — intentionally omitted from the
  // array so the timer does not restart on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInkStrokes, recognizerTemplates])

  /** Back to the initial tool state (new board / full reset). */
  const reset = useCallback(() => {
    setInkSelection(null)
    setSelectedId(null)
    setTextBoxAt(null)
    setTool('select')
  }, [])

  return {
    tool, penColor, setPenColor, inkSelection, selectedId: effectiveSelectedId, setSelectedId,
    textBoxAt, editingId, selectionSuggestion,
    clearTransient, reset,
    handleSetTool, handleRequestTextBox, handleTextBoxConfirm, handleTextBoxCancel,
    handleRequestEditText, handleEditCommit, handleEditCancel,
    handleInkStrokeErased, handleInkStrokeMoved, handleUndo, handlePromote,
    handleMarqueeSelect, handleCloseShapeMenu,
  }
}

/**
 * useBoardPointer — pointer handling of the board: pen strokes, eraser,
 * object hit-test and selection, resize handles, double click detection
 * (text box on empty area, in-place edit on a text) and the right-click area menu.
 */
import { useRef, useCallback, useState } from 'react'
import { objectAtBoxPoint, type Scene } from '@/scene/index.js'
import { computeAreaRects, computeBodyRect, type BBox, type AreaTree } from '@/layout/index.js'
import { strokeAtBoxPoint, type InkLayer } from '@/ink/index.js'
import { resizeBox, handleAtPoint, type ResizeHandle } from './resize.js'
import { DOUBLE_TAP_MS, DOUBLE_TAP_DIST, RESIZE_HANDLE_SIZE } from './canvas-style.js'
import { highlightAtPoint } from './scene-hit.js'
import type { CanvasTool } from './SceneCanvas.js'
import Konva from 'konva'

export interface UseBoardPointerOptions {
  tool: CanvasTool
  ink?: InkLayer
  scene: Scene
  hasTitle: boolean
  width: number
  height: number
  selectedId?: string | null
  onObjectMoved?: (id: string, newBox: BBox) => void
  onInkStrokeAdded?: (points: number[]) => void
  onInkStrokeErased?: (id: string) => void
  onObjectErased?: (id: string) => void
  onHighlightErased?: (id: string) => void
  onSelectObject?: (id: string | null) => void
  onRequestTextBox?: (point: { x: number; y: number }) => void
  onRequestEditText?: (objectId: string) => void
  showAreas: boolean
  areaTree?: AreaTree
  onRequestAreaMenu?: (areaId: string, screen: { x: number; y: number }) => void
}

export function useBoardPointer({
  tool, ink, scene, hasTitle, width, height, selectedId,
  onObjectMoved, onInkStrokeAdded, onInkStrokeErased, onObjectErased, onHighlightErased,
  onSelectObject, onRequestTextBox, onRequestEditText, showAreas, areaTree, onRequestAreaMenu,
}: UseBoardPointerOptions) {
  // Points of the stroke in progress (only while drawing with the pen)
  const [currentStroke, setCurrentStroke] = useState<number[]>([])
  const isDrawing = useRef(false)
  const isErasing = useRef(false)

  // Active resize handle
  const resizeHandleRef = useRef<ResizeHandle | null>(null)

  // Manual double-click detection over an empty area: Konva does not reliably
  // deliver onDblClick on the empty Stage, so we count two pointerdowns
  // close in time and space.
  const lastEmptyTapRef = useRef<{ t: number; x: number; y: number } | null>(null)

  // Double-click detection over a text object: stores the id of the object
  // touched the previous time to detect two consecutive taps on it.
  const lastObjectTapRef = useRef<{ t: number; id: string } | null>(null)

  // ── Pointer handlers for pen and eraser ───────────────────────────────────

  const handlePointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (tool === 'select') {
      const stage = e.target.getStage()
      if (!stage) return
      // Logical canvas coords (undoing the transform): getRelativePointerPosition
      const pos = stage.getRelativePointerPosition()
      if (!pos) return

      // Detect a resize handle BEFORE the object hit-test.
      // Only if an object is selected and resizing is enabled.
      if (selectedId && onObjectMoved) {
        const sel = scene.objects.get(selectedId)
        if (sel) {
          const hit = handleAtPoint(sel.box, pos.x, pos.y, RESIZE_HANDLE_SIZE)
          if (hit !== null) {
            resizeHandleRef.current = hit
            e.evt.preventDefault()
            return
          }
        }
      }

      // Pure bbox hit-test: the selectable area is the object box, not just
      // the visible stroke.
      const hitObj = objectAtBoxPoint(scene, pos.x, pos.y)
      if (hitObj) {
        // Double-click on a text object -> open the edit overlay.
        // Detect two consecutive pointerdowns on the same id within DOUBLE_TAP_MS.
        // Only on a text object (a concept has no editable text).
        const nowObj = Date.now()
        const lastObj = lastObjectTapRef.current
        if (
          lastObj &&
          lastObj.id === hitObj.id &&
          nowObj - lastObj.t < DOUBLE_TAP_MS &&
          onRequestEditText
        ) {
          if (hitObj.object === 'texto') {
            lastObjectTapRef.current = null
            onSelectObject?.(null)
            onRequestEditText(hitObj.id)
            return
          }
        }
        lastObjectTapRef.current = { t: nowObj, id: hitObj.id }
        onSelectObject?.(hitObj.id)
        return
      }

      // Manual double-click on an empty area -> text box.
      // Two pointerdowns close in time (<DOUBLE_TAP_MS) and space (<DOUBLE_TAP_DIST)
      // are interpreted as a double-click; opens the text box at that point.
      const now = Date.now()
      const last = lastEmptyTapRef.current
      if (
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.abs(pos.x - last.x) < DOUBLE_TAP_DIST &&
        Math.abs(pos.y - last.y) < DOUBLE_TAP_DIST
      ) {
        lastEmptyTapRef.current = null
        onSelectObject?.(null)
        onRequestTextBox?.({ x: pos.x, y: pos.y })
        return
      }
      lastEmptyTapRef.current = { t: now, x: pos.x, y: pos.y }

      // Empty: deselect
      onSelectObject?.(null)
      e.evt.preventDefault()
      return
    }

    e.evt.preventDefault()

    if (tool === 'pen') {
      isDrawing.current = true
      const stage = e.target.getStage()
      if (!stage) return
      // Logical canvas coords (undoing the transform): getRelativePointerPosition
      const pos = stage.getRelativePointerPosition()
      if (!pos) return
      setCurrentStroke([pos.x, pos.y])
    } else if (tool === 'eraser' && ink) {
      isErasing.current = true
      const stage = e.target.getStage()
      if (!stage) return
      // Logical canvas coords (undoing the transform): getRelativePointerPosition
      const pos = stage.getRelativePointerPosition()
      if (!pos) return

      // Erase priority: highlights > ink > objects
      const highlightHit = highlightAtPoint(scene, pos.x, pos.y, 12)
      if (highlightHit) {
        onHighlightErased?.(highlightHit)
        return
      }

      // Ink is erased by AREA (stroke box + 12 px), like objects by bbox.
      // Easier to hit than strokeAtPoint (distance to the line).
      const hit = strokeAtBoxPoint(ink, pos.x, pos.y, 12)
      if (hit) {
        onInkStrokeErased?.(hit.id)
      } else {
        // The 🧽 erases any object under the cursor with a cascade.
        // Only on pointerdown (deliberate tap): object erasing does NOT happen while
        // dragging because there is no object undo yet (Ctrl+Z only undoes ink).
        const obj = objectAtBoxPoint(scene, pos.x, pos.y)
        if (obj) onObjectErased?.(obj.id)
      }
    }
  }, [tool, ink, scene, onInkStrokeErased, onObjectErased, onHighlightErased, onSelectObject, selectedId, onObjectMoved, onRequestTextBox, onRequestEditText])

  const handlePointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (tool === 'select') {
      // Process the active resize gesture.
      if (resizeHandleRef.current !== null && selectedId) {
        const stage = e.target.getStage()
        if (!stage) return
        // Logical canvas coords (undoing the transform): getRelativePointerPosition
        const pos = stage.getRelativePointerPosition()
        if (!pos) return
        const sel = scene.objects.get(selectedId)
        if (sel) {
          const newBox = resizeBox(sel.box, resizeHandleRef.current, pos.x, pos.y)
          onObjectMoved?.(selectedId, newBox)
        }
      }
      return
    }

    e.evt.preventDefault()

    if (tool === 'pen' && isDrawing.current) {
      const stage = e.target.getStage()
      if (!stage) return
      // Logical canvas coords (undoing the transform): getRelativePointerPosition
      const pos = stage.getRelativePointerPosition()
      if (!pos) return
      setCurrentStroke(prev => [...prev, pos.x, pos.y])
    } else if (tool === 'eraser' && ink && isErasing.current) {
      // Erase while dragging: highlights > ink > objects
      const stage = e.target.getStage()
      if (!stage) return
      // Logical canvas coords (undoing the transform): getRelativePointerPosition
      const pos = stage.getRelativePointerPosition()
      if (!pos) return

      const highlightHit = highlightAtPoint(scene, pos.x, pos.y, 12)
      if (highlightHit) {
        onHighlightErased?.(highlightHit)
        return
      }

      const hit = strokeAtBoxPoint(ink, pos.x, pos.y, 12)
      if (hit) {
        onInkStrokeErased?.(hit.id)
      } else {
        const obj = objectAtBoxPoint(scene, pos.x, pos.y)
        if (obj) onObjectErased?.(obj.id)
      }
    }
  }, [tool, ink, scene, onInkStrokeErased, onObjectErased, onHighlightErased, selectedId, onObjectMoved])

  const handlePointerUp = useCallback(() => {
    // Close the resize gesture if it was active.
    if (resizeHandleRef.current !== null) {
      resizeHandleRef.current = null
      return
    }

    if (tool === 'pen' && isDrawing.current) {
      isDrawing.current = false
      if (currentStroke.length >= 4) {
        onInkStrokeAdded?.(currentStroke)
      }
      setCurrentStroke([])
    }
    isErasing.current = false
  }, [tool, currentStroke, onInkStrokeAdded])

  // Cursor by tool
  const cursorStyle = (tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'default')

  // Fixed board: the wheel does not pan or zoom; only the browser scroll/zoom is suppressed.
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
  }, [])

  // ── Right click on an area -> context menu ────────────────────────────────
  // Suppresses the browser menu and, if the areas are visible, identifies the
  // area (leaf) under the cursor and asks to open the areas menu (split/delete).
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    e.evt.preventDefault()
    if (!showAreas || !areaTree || !onRequestAreaMenu || tool !== 'select') return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition() // logical canvas coords
    const screen = stage.getPointerPosition()       // px of the container (for the overlay)
    if (!pos || !screen) return
    const areaRects = computeAreaRects(areaTree, computeBodyRect({ width, height }, hasTitle))
    const hit = areaRects.find(
      (ar) =>
        pos.x >= ar.box.x &&
        pos.x <= ar.box.x + ar.box.width &&
        pos.y >= ar.box.y &&
        pos.y <= ar.box.y + ar.box.height,
    )
    if (hit) onRequestAreaMenu(hit.id, { x: screen.x, y: screen.y })
  }, [showAreas, areaTree, onRequestAreaMenu, tool, width, height, hasTitle])

  return { currentStroke, cursorStyle, handlePointerDown, handlePointerMove, handlePointerUp, handleWheel, handleContextMenu }
}

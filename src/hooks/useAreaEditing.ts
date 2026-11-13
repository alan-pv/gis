/**
 * useAreaEditing — state of the area dividers (developer mode): visibility toggle,
 * context menu (right click on an area) and live resizing by dragging a divider.
 */
import { useCallback, useState } from 'react'
import { activePage } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'
import { resizeSplit } from '@/layout/index.js'
import type { AreaTree, Canvas } from '@/layout/index.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'

export interface AreaMenuState {
  areaId: string
  x: number
  y: number
}

export function useAreaEditing(
  document: GisDocument,
  setAreaTree: (tree: AreaTree, canvas: Canvas, opts?: { snapshot?: boolean }) => void,
) {
  // Toggle: shows/hides the divider lines between areas. On by default.
  const [showAreas, setShowAreas] = useState(true)
  // Context menu (right click): area id + screen position.
  // selectedAreaId derives from it to highlight the area of the open menu.
  const [areaMenu, setAreaMenu] = useState<AreaMenuState | null>(null)
  const selectedAreaId = areaMenu?.areaId ?? null

  // Resizing an area by dragging its divider, LIVE.
  // Called by SceneCanvas.onResizeArea on every onDragMove + onDragEnd: the scene
  // re-flows while dragging. The undo snapshot is taken once per gesture
  // (snapshot=true on the first delta); the other moves skip it (snapshot=false)
  // so the undo stack is not flooded.
  const handleResizeArea = useCallback((splitId: string, ratio: number, snapshot: boolean) => {
    const tree = activePage(document).areaTree
    const newTree = resizeSplit(tree, splitId, ratio)
    // Dispatch if the tree changes (resizeSplit returns the same ref when it does not)
    // or if the initial snapshot must be taken (captures the pristine state).
    if (newTree !== tree || snapshot) {
      setAreaTree(newTree, { width: CANVAS_W, height: CANVAS_H }, { snapshot })
    }
  }, [document, setAreaTree])

  return { showAreas, setShowAreas, areaMenu, setAreaMenu, selectedAreaId, handleResizeArea }
}

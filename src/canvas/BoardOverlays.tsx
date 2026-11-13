/**
 * BoardOverlays — HTML overlays anchored on top of the Konva stage: the floating
 * text box, the in-place text editor, the ink-selection shape menu and the floating
 * trash button of the selected object.
 *
 * Board coordinates are logical; they are mapped to screen so every overlay follows
 * its point under the fixed-view fit.
 */
import type { Scene } from '@/scene/index.js'
import type { SelectionRect } from '@/ink/index.js'
import type { PromotionSuggestion } from '@/recognizer/suggest.js'
import type { Library } from '@/library/index.js'
import { DeleteObjectButton } from '@/ui/DeleteObjectButton.js'
import { canvasToScreen } from './viewport.js'
import type { Viewport } from './viewport.js'
import { TextBoxOverlay } from './TextBoxOverlay.js'
import { InPlaceTextEditor } from './InPlaceTextEditor.js'
import { sectionColorOf, textInkColor } from './board-colors.js'
import { ShapeMenu } from './ShapeMenu.js'

export interface BoardOverlaysProps {
  scene: Scene
  view: Viewport
  library: Library
  /** Point of the double click that opened a new text box (null = closed). */
  textBoxAt: { x: number; y: number } | null
  onTextBoxConfirm: (text: string) => void
  onTextBoxCancel: () => void
  /** Id of the text being edited in place (null = none). */
  editingId: string | null
  onEditCommit: (text: string) => void
  onEditCancel: () => void
  /** Marquee selection of ink strokes (null = none). */
  inkSelection: { strokeIds: string[]; rect: SelectionRect } | null
  selectionSuggestion: PromotionSuggestion | null
  onPromote: (objectType: string) => void
  onCloseShapeMenu: () => void
  /** Selected object (null = none). */
  selectedId: string | null
  onDeleteSelected: () => void
}

export function BoardOverlays({
  scene, view, library, textBoxAt, onTextBoxConfirm, onTextBoxCancel, editingId, onEditCommit, onEditCancel,
  inkSelection, selectionSuggestion, onPromote, onCloseShapeMenu, selectedId, onDeleteSelected,
}: BoardOverlaysProps) {
  const textBox = textBoxAt ? canvasToScreen(textBoxAt, view) : null

  const editingObj = editingId ? scene.objects.get(editingId) : undefined
  // Paragraph split between columns: it is edited on the first fragment.
  const editingBox = editingObj ? (editingObj.fragments?.[0]?.box ?? editingObj.box) : null

  let shapeRect: SelectionRect | null = null
  if (inkSelection) {
    const r = inkSelection.rect
    const origin = canvasToScreen({ x: r.x, y: r.y }, view)
    shapeRect = {
      x: origin.x,
      y: origin.y,
      width:  r.width  * view.scale,
      height: r.height * view.scale,
    }
  }

  const selectedObj = selectedId !== null ? scene.objects.get(selectedId) : undefined
  // Top-right logical corner → screen; then a visual offset in screen px
  const corner = selectedObj
    ? canvasToScreen({ x: selectedObj.box.x + selectedObj.box.width, y: selectedObj.box.y }, view)
    : null

  return (
    <>
      {/* Text box: appears at the double-click point. */}
      {textBox && (
        <TextBoxOverlay
          x={textBox.x}
          y={textBox.y}
          onConfirm={onTextBoxConfirm}
          onCancel={onTextBoxCancel}
        />
      )}
      {/* In-place text editing: a <textarea> over the object's own box. */}
      {editingId && editingObj && editingBox && (
        <InPlaceTextEditor
          key={editingId}
          box={editingBox}
          role={editingObj.role}
          fontSize={editingObj.fontSize}
          color={textInkColor(editingObj.role, sectionColorOf(scene, editingObj.id))}
          view={view}
          initialText={editingObj.text ?? ''}
          onCommit={onEditCommit}
          onCancel={onEditCancel}
        />
      )}
      {/* Ink selection menu: appears when a marquee is released with strokes. */}
      {shapeRect && (
        <ShapeMenu
          rect={shapeRect}
          suggestion={selectionSuggestion}
          library={library}
          onPromote={onPromote}
          onClose={onCloseShapeMenu}
        />
      )}
      {/* Floating trash: visible when an object is selected, at the top-right corner of its box.
          The eraser also deletes any object with a tap; the trash is another way to delete the selected one. */}
      {corner && (
        <DeleteObjectButton
          x={corner.x + 6}
          y={corner.y - 6}
          onDelete={onDeleteSelected}
        />
      )}
    </>
  )
}

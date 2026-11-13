/**
 * BoardOverlays — HTML overlays anchored on top of the Konva stage: the floating
 * text box, the in-place text editor and the floating trash button of the selected object.
 *
 * Board coordinates are logical; they are mapped to screen so every overlay follows
 * its point under the fixed-view fit.
 */
import type { Scene } from '@/scene/index.js'
import { DeleteObjectButton } from '@/ui/DeleteObjectButton.js'
import { canvasToScreen } from './viewport.js'
import type { Viewport } from './viewport.js'
import { TextBoxOverlay } from './TextBoxOverlay.js'
import { InPlaceTextEditor } from './InPlaceTextEditor.js'
import { sectionColorOf, textInkColor } from './board-colors.js'

export interface BoardOverlaysProps {
  scene: Scene
  view: Viewport
  /** Point of the double click that opened a new text box (null = closed). */
  textBoxAt: { x: number; y: number } | null
  onTextBoxConfirm: (text: string) => void
  onTextBoxCancel: () => void
  /** Id of the text being edited in place (null = none). */
  editingId: string | null
  onEditCommit: (text: string) => void
  onEditCancel: () => void
  /** Selected object (null = none). */
  selectedId: string | null
  onDeleteSelected: () => void
}

export function BoardOverlays({
  scene, view, textBoxAt, onTextBoxConfirm, onTextBoxCancel, editingId, onEditCommit, onEditCancel,
  selectedId, onDeleteSelected,
}: BoardOverlaysProps) {
  const textBox = textBoxAt ? canvasToScreen(textBoxAt, view) : null

  const editingObj = editingId ? scene.objects.get(editingId) : undefined
  // Paragraph split between columns: it is edited on the first fragment.
  const editingBox = editingObj ? (editingObj.fragments?.[0]?.box ?? editingObj.box) : null

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

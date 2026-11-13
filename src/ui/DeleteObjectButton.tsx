/**
 * DeleteObjectButton.tsx — floating button that deletes the selected object.
 *
 * Pure presentational component: it sits at the top-right corner of the selected
 * object's box on the canvas. The absolute coordinates (left/top) are computed in
 * App.tsx from the object's box and passed as props; the rest of the styling
 * lives in the CSS module with --gis-* tokens.
 *
 * Only visible while an object is selected. The eraser tool still touches only
 * ink, never scene objects.
 */
import { Trash2 } from 'lucide-react'
import styles from './DeleteObjectButton.module.css'

export interface DeleteObjectButtonProps {
  /** Absolute position inside the stage container, in px (computed from the object's box). */
  x: number
  y: number
  /** Deletes the selected object. */
  onDelete: () => void
}

export function DeleteObjectButton({ x, y, onDelete }: DeleteObjectButtonProps) {
  return (
    <button
      type="button"
      className={styles.btn}
      style={{ left: x, top: y }}
      onClick={onDelete}
      aria-label="Delete the selected object"
      title="Delete the selected object (Del)"
    >
      <Trash2 size={15} strokeWidth={1.75} />
    </button>
  )
}

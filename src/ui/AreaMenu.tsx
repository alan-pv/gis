/**
 * AreaMenu — context menu of an area (right click, developer mode): split
 * vertically / horizontally, delete. Positioned at the click point (px of the
 * Stage container). A transparent backdrop closes the menu on any outside click.
 */
import { nextAreaIds, splitLeaf, removeLeaf, leafIds } from '@/layout/index.js'
import type { AreaTree, Canvas } from '@/layout/index.js'

export interface AreaMenuProps {
  areaId: string
  x: number
  y: number
  tree: AreaTree
  canvas: Canvas
  setAreaTree: (tree: AreaTree, canvas: Canvas) => void
  onClose: () => void
}

export function AreaMenu({ areaId, x, y, tree, canvas, setAreaTree, onClose }: AreaMenuProps) {
  const canRemove = leafIds(tree).length > 1
  const close = onClose

  const handleSplitV = () => {
    const { leafId, splitId } = nextAreaIds(tree)
    setAreaTree(splitLeaf(tree, areaId, 'v', leafId, splitId), canvas)
    close()
  }
  const handleSplitH = () => {
    const { leafId, splitId } = nextAreaIds(tree)
    setAreaTree(splitLeaf(tree, areaId, 'h', leafId, splitId), canvas)
    close()
  }
  const handleRemove = () => {
    if (!canRemove) return
    setAreaTree(removeLeaf(tree, areaId), canvas)
    close()
  }

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 12,
    padding: '6px 12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    color: '#374151',
  }
  return (
    <>
      {/* Transparent backdrop: a click outside closes the menu */}
      <div
        onClick={close}
        onContextMenu={(e) => { e.preventDefault(); close() }}
        style={{ position: 'fixed', inset: 0, zIndex: 19 }}
      />
      <div style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 20,
        background: 'white',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        minWidth: 150,
      }}>
        <button onClick={handleSplitV} style={itemStyle}>⬌ Split vertically</button>
        <button onClick={handleSplitH} style={itemStyle}>⬍ Split horizontally</button>
        <button
          onClick={handleRemove}
          disabled={!canRemove}
          style={{
            ...itemStyle,
            color: canRemove ? '#dc2626' : '#aaa',
            cursor: canRemove ? 'pointer' : 'default',
          }}
          title={canRemove ? 'Delete the area (its sibling takes its space)' : 'The only area cannot be deleted'}
        >
          🗑 Delete area
        </button>
      </div>
    </>
  )
}

export interface AreasToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

/**
 * Visibility toggle of the area divider lines (developer mode). Editing is direct on
 * the canvas: dragging a line resizes, right click on an area opens the menu.
 * Placed above the bottom-left corner so it does not cover the MicButton.
 */
export function AreasToggle({ checked, onChange }: AreasToggleProps) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 36,
      left: 8,
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: '#555',
        cursor: 'pointer',
        userSelect: 'none',
        background: 'rgba(255,255,255,0.85)',
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid #d1d5db',
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ margin: 0 }}
        />
        Areas
      </label>
    </div>
  )
}

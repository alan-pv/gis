/**
 * AreaDividerLayer — the divider lines between board areas with their draggable handles.
 *
 * Visible whenever the areas are on (showAreas) in select mode. Each divider is drawn
 * as a visible line (to see the partition) plus a draggable handle Rect on top. The drag
 * is restricted to the perpendicular axis and resizes LIVE (reflow on every drag move);
 * dragBoundFunc receives the ABSOLUTE position (screen px) and converts to/from logical
 * coordinates with view.scale and view.x/y.
 */
import type { Viewport } from './viewport.js'
import { Layer, Group, Rect, Line } from 'react-konva'
import type { Scene } from '@/scene/index.js'
import { computeDividers, isDividerVisible, computeBodyRect, type AreaTree, type AreaDivider } from '@/layout/index.js'
import { DIVIDER_HANDLE_THICKNESS, DIVIDER_HANDLE_COLOR, DIVIDER_HANDLE_HOVER_COLOR, DIVIDER_LINE_COLOR } from './canvas-style.js'
import Konva from 'konva'

interface AreaDividerLayerProps {
  areaTree: AreaTree
  width: number
  height: number
  hasTitle: boolean
  scene: Scene
  view: Viewport
  cursorStyle: string
  /** Whether the current drag gesture already took its undo snapshot. */
  areaResizeSnapshotTaken: React.RefObject<boolean>
  onResizeArea?: (splitId: string, ratio: number, snapshot: boolean) => void
}

export function AreaDividerLayer({ areaTree, width, height, hasTitle, scene, view, cursorStyle, areaResizeSnapshotTaken, onResizeArea }: AreaDividerLayerProps) {

  const dividers = computeDividers(areaTree, computeBodyRect({ width, height }, hasTitle))
  if (dividers.length === 0) return null
  // The dotted line is hidden while the column/row it opens is empty;
  // the (invisible) draggable handle is always kept.
  const occupied = Array.from(scene.objects.values()).map(o => o.box)

  return (
    <Layer>
      {dividers.map((div: AreaDivider) => {
        const hw = DIVIDER_HANDLE_THICKNESS / 2
        // Visible line (not draggable): marks the border between areas.
        const linePoints = div.dir === 'v'
          ? [div.x, div.y, div.x, div.y + div.length]
          : [div.x, div.y, div.x + div.length, div.y]
        // Position and size of the handle Rect in logical canvas coords.
        // dir 'v' -> vertical rect centered on div.x, spanning the full height div.length.
        // dir 'h' -> horizontal rect centered on div.y, spanning the full width div.length.
        const handleX = div.dir === 'v' ? div.x - hw : div.x
        const handleY = div.dir === 'v' ? div.y : div.y - hw
        const handleW = div.dir === 'v' ? DIVIDER_HANDLE_THICKNESS : div.length
        const handleH = div.dir === 'v' ? div.length : DIVIDER_HANDLE_THICKNESS

        return (
          <Group key={div.splitId}>
          {isDividerVisible(div, occupied) && (
            <Line
              points={linePoints}
              stroke={DIVIDER_LINE_COLOR}
              strokeWidth={2}
              lineCap="round"
              listening={false}
            />
          )}
          <Rect
            x={handleX}
            y={handleY}
            width={handleW}
            height={handleH}
            fill={DIVIDER_HANDLE_COLOR}
            draggable={true}
            // Stop bubbling on pointerdown: the Stage selection handler
            // (objects/marquee) must NOT steal the gesture before the
            // handle starts its drag.
            onPointerDown={(e: Konva.KonvaEventObject<PointerEvent>) => {
              e.cancelBubble = true
            }}
            // Stop bubbling on click: keeps a click on the handle from
            // selecting/deselecting objects underneath.
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true
            }}
            onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const target = e.target as Konva.Rect
              target.fill(DIVIDER_HANDLE_HOVER_COLOR)
              target.getLayer()?.batchDraw()
              const container = e.target.getStage()?.container()
              if (container) {
                container.style.cursor = div.dir === 'v' ? 'col-resize' : 'row-resize'
              }
            }}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const target = e.target as Konva.Rect
              target.fill(DIVIDER_HANDLE_COLOR)
              target.getLayer()?.batchDraw()
              const container = e.target.getStage()?.container()
              if (container) container.style.cursor = cursorStyle
            }}
            // dragBoundFunc: restricts the drag to the axis perpendicular to the divider.
            // It receives and returns the ABSOLUTE position of the node (screen px, with
            // the Stage transform applied: absX = logicalX * scale + view.x).
            // Conversion: logicalX = (absX - view.x) / view.scale.
            // Assumption: the Stage has no additional transforms beyond
            // view.scale/view.x/view.y (the only ones applied in this component).
            dragBoundFunc={(pos: { x: number; y: number }) => {
              const { scale, x: tx, y: ty } = view
              if (div.dir === 'v') {
                // Moves only in X; Y fixed at the logical coordinate of the top edge.
                const fixedAbsY = div.y * scale + ty
                // Logical position of the handle center: (pos.x - tx) / scale + hw
                // where pos.x is the absolute left edge of the handle.
                const logicalCenterX = (pos.x - tx) / scale + hw
                const minCenter = div.nodeRect.x + 0.1 * div.nodeRect.width
                const maxCenter = div.nodeRect.x + 0.9 * div.nodeRect.width
                const clampedCenter = Math.max(minCenter, Math.min(maxCenter, logicalCenterX))
                return {
                  x: (clampedCenter - hw) * scale + tx,
                  y: fixedAbsY,
                }
              } else {
                // Moves only in Y; X fixed at the logical coordinate of the left edge.
                const fixedAbsX = div.x * scale + tx
                const logicalCenterY = (pos.y - ty) / scale + hw
                const minCenter = div.nodeRect.y + 0.1 * div.nodeRect.height
                const maxCenter = div.nodeRect.y + 0.9 * div.nodeRect.height
                const clampedCenter = Math.max(minCenter, Math.min(maxCenter, logicalCenterY))
                return {
                  x: fixedAbsX,
                  y: (clampedCenter - hw) * scale + ty,
                }
              }
            }}
            // LIVE resize: reflow on every onDragMove + commit on onDragEnd.
            // node.x() / node.y() return the logical position of the handle edge
            // in the layer coordinate system (= logical canvas coords).
            // The undo snapshot is taken once per gesture (first delta).
            onDragStart={() => { areaResizeSnapshotTaken.current = false }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target
              const ratio = div.dir === 'v'
                ? (node.x() + hw - div.nodeRect.x) / div.nodeRect.width
                : (node.y() + hw - div.nodeRect.y) / div.nodeRect.height
              const snapshot = !areaResizeSnapshotTaken.current
              areaResizeSnapshotTaken.current = true
              onResizeArea?.(div.splitId, ratio, snapshot)
              // The new tree repositions the line/handle via props; resetting the
              // node offset avoids double-applying it with Konva's state.
              node.x(handleX)
              node.y(handleY)
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target
              const ratio = div.dir === 'v'
                ? (node.x() + hw - div.nodeRect.x) / div.nodeRect.width
                : (node.y() + hw - div.nodeRect.y) / div.nodeRect.height
              const snapshot = !areaResizeSnapshotTaken.current
              areaResizeSnapshotTaken.current = true
              onResizeArea?.(div.splitId, ratio, snapshot)
              node.x(handleX)
              node.y(handleY)
            }}
          />
          </Group>
        )
      })}
    </Layer>
  )
}

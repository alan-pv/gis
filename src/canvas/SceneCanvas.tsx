/**
 * Main canvas component: renders the scene on Konva.
 *
 * Principles:
 * - LIVE objects: draggable, click selects (subtle dotted border).
 * - Roughened paths: hand-drawn look, deterministic seed per id.
 * - Text: handwriting-style fontFamily.
 * - Labels: Konva.Text next to the object according to placement.
 * - Connections: paths computed by connection-geometry.
 * - Nodes mount invisible; the animation reveals them in order.
 *
 * No render tests (Konva is not testable in happy-dom).
 */
import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { IDENTITY_VIEWPORT, type Viewport } from './viewport.js'
import { Stage, Layer, Group, Text, Rect, Line, Circle } from 'react-konva'
import { resolveObject, type Color, type Library } from '@/library/index.js'
import type { Scene } from '@/scene/index.js'
import type { AnimationStep } from '@/animation/timeline.js'
import { computeAreaRects, computeBodyRect, STANDARD_MARGIN, TITLE_BAND_HEIGHT, type BBox, type AreaTree } from '@/layout/index.js'
import type { InkLayer, SelectionRect } from '@/ink/index.js'
import { sceneForDisplay } from '@/scene/open-question.js'
import { assignConnectionAnchors } from './connection-anchors.js'
import { useAnimationPlayer, type NodeResolver } from './useAnimationPlayer.js'
import { colorHex } from './palette.js'
import { INK_COLOR, sectionColorOf } from './board-colors.js'
import { RunsText } from './RunsText.js'
import { isRunsNode, REVEAL_ATTR } from './runs-layout.js'
import { FONT_FAMILY } from './font.js'
import { resizeHandles, cursorFor } from './resize.js'
import { TEXT_LINE_HEIGHT, TEXT_PADDING, ROLE_STYLE, TEXT_BG_COLOR } from '@/scene/text-measure.js'
import { formatBoardDate } from './board-date.js'
import { DATE_FONT_SIZE, LABEL_FONT_SIZE, STROKE_COLOR, STROKE_WIDTH, SELECTION_PAD, SELECTION_COLOR, RESIZE_HANDLE_SIZE } from './canvas-style.js'
import { ObjectNode } from './ObjectNode.js'
import { labelPos, selectionAnchors } from './scene-hit.js'
import { ConnectionNode } from './ConnectionNode.js'
import { HighlightLayer } from './HighlightLayer.js'
import { AreaDividerLayer } from './AreaDividerLayer.js'
import { useStageSnapshot } from './useStageSnapshot.js'
import { useBoardPointer } from './useBoardPointer.js'
import Konva from 'konva'

/** Active canvas tool. */
export type CanvasTool = 'select' | 'pen' | 'eraser'

export interface SceneCanvasProps {
  scene: Scene
  library: Library
  /** Animation steps pending playback (cleared once consumed). */
  pendingSteps: AnimationStep[]
  /** Callback to notify that the steps were consumed. */
  onStepsConsumed?: () => void
  width?: number
  height?: number
  /**
   * Size in px of the <Stage> element (visible area on screen). Separate from
   * `width`/`height`: the board still measures the logical
   * canvas size (background, connection anchors, layout, hit-testing); only the
   * Konva canvas is cropped/scaled to the space available in the window.
   * Default: `width`/`height`.
   */
  viewportWidth?: number
  /** See `viewportWidth`. */
  viewportHeight?: number
  onObjectMoved?: (id: string, newBox: BBox) => void
  onAnimationDone?: () => void
  /**
   * Page thumbnail taken from the REAL render of the Stage: a JPEG data URL of the whole
   * board. Emitted with a debounce after the scene changes and when each animation ends;
   * skipped while there is a selection or a marquee (so their handles are not captured).
   */
  onSnapshot?: (dataUrl: string) => void
  /** Active tool; 'select' by default. */
  tool?: CanvasTool
  /** Ink layer of the active page. */
  ink?: InkLayer
  /** Called when the teacher finishes drawing a stroke (points in px). */
  onInkStrokeAdded?: (points: number[]) => void
  /** Called when the eraser touches a stroke; passes the id of the stroke to delete. */
  onInkStrokeErased?: (id: string) => void
  /** Called when the eraser touches an object (agent or promoted) with a deliberate tap; passes the object id. */
  onObjectErased?: (id: string) => void
  /** Called when the eraser touches a highlight; passes the id of the highlight. */
  onHighlightErased?: (id: string) => void
  /** Called when an ink stroke finishes dragging; passes id and delta (dx, dy). */
  onInkStrokeMoved?: (id: string, dx: number, dy: number) => void
  /** Called when a selection marquee is released with ≥1 captured ink stroke. */
  onMarqueeSelect?: (strokeIds: string[], rect: SelectionRect) => void
  /** Id of the selected object (null = none). Only relevant with the select tool. */
  selectedId?: string | null
  /** Called when an object is selected by click (id) or deselected (null). */
  onSelectObject?: (id: string | null) => void
  /** Active pen color. */
  penColor?: Color
  /**
   * Double click on an empty area with the select tool: requests opening a
   * text box at that point.
   */
  onRequestTextBox?: (point: { x: number; y: number }) => void
  /**
   * Double click on an existing text object: requests editing that object.
   * The caller must open the overlay pre-filled with the current text.
   */
  onRequestEditText?: (objectId: string) => void
  /** Text object being edited in place: its text is hidden while editing. */
  editingId?: string | null
  /** Fixed Stage view (scale + centering, derived from the window; ephemeral UI state). Default: identity. */
  view?: Viewport
  /**
   * Partition tree of the body areas.
   * Used to paint the faint per-area background when showAreas=true.
   */
  areaTree?: AreaTree
  /**
   * Area visibility toggle: if true, draws the dividing lines between areas
   * (always draggable in select mode) instead of the old faint per-area
   * background. On by default.
   */
  showAreas?: boolean
  /**
   * Id of the area whose context menu is open: it is highlighted with a
   * border to show which area divide/delete act on.
   */
  selectedAreaId?: string | null
  /**
   * Right click on an area: requests opening the areas context menu
   * (split V/H, delete). `screen` is in px of the Stage container
   * (same system as canvasToScreen), ready to position the HTML overlay.
   */
  onRequestAreaMenu?: (areaId: string, screen: { x: number; y: number }) => void
  /**
   * Callback when dragging an area divider (LIVE: onDragMove + onDragEnd).
   * Called with the splitId, the new ratio computed on the perpendicular axis, and
   * `snapshot` (true only on the first delta of the gesture, so one undo per resize,
   * not per pixel). The caller must invoke resizeSplit and setAreaTree.
   */
  onResizeArea?: (splitId: string, ratio: number, snapshot: boolean) => void
}

// ── Main component ────────────────────────────────────────────────────────────

export function SceneCanvas({
  scene: fullScene,
  library,
  pendingSteps,
  onStepsConsumed,
  width = 1200,
  height = 900,
  viewportWidth,
  viewportHeight,
  onObjectMoved,
  onAnimationDone,
  onSnapshot,
  tool = 'select',
  ink,
  onInkStrokeAdded,
  onInkStrokeErased,
  onObjectErased,
  onHighlightErased,
  onInkStrokeMoved,
  onMarqueeSelect,
  selectedId,
  onSelectObject,
  penColor,
  onRequestTextBox,
  onRequestEditText,
  editingId,
  view = IDENTITY_VIEWPORT,
  areaTree,
  showAreas = true,
  selectedAreaId,
  onRequestAreaMenu,
  onResizeArea,
}: SceneCanvasProps) {
  // Registry of Konva nodes: key -> node
  const registry = useRef<Map<string, Konva.Node>>(new Map())
  const player = useAnimationPlayer()

  // Live resize: marks whether the area divider drag gesture already took its
  // undo snapshot. Reset on onDragStart; the first onDragMove consumes it.
  const areaResizeSnapshotTaken = useRef(false)

  // Keys of nodes already revealed by the animation.
  // Persistent across renders (stable state, never reassigned) so re-renders do not re-hide
  // nodes that already animated nor prematurely reveal the pending ones.
  const [revealed] = useState<Set<string>>(() => new Set())

  // Register / unregister a Konva node in the registry.
  // The open question lives in the scene but is neither drawn nor selectable.
  const scene = useMemo(() => sceneForDisplay(fullScene), [fullScene])
  const reg = useCallback((key: string, node: Konva.Node | null) => {
    if (node) {
      registry.current.set(key, node)
    } else {
      registry.current.delete(key)
    }
  }, [])

  // When the scene changes (clear / remove), prune revealed by removing the
  // keys whose root id no longer exists in the scene. After a clear or an object
  // delete its ids leave the map and can be reused; without this
  // pruning, a new node with a recycled id would mount already visible and the
  // flash we want to avoid would reappear.
  useEffect(() => {
    for (const key of Array.from(revealed)) {
      // Extract the root id: strip the __label suffix and cut at the first '/'
      const rootId = key.replace(/__label$/, '').split('/')[0] ?? key
      if (
        !scene.objects.has(rootId) &&
        !scene.connections.has(rootId) &&
        !scene.groups.has(rootId) &&
        !scene.highlights.has(rootId)
      ) {
        revealed.delete(key)
      }
    }
  }, [scene, revealed])

  // NodeResolver for the player: resolves the node AND marks it as revealed
  // so later re-renders leave it visible.
  const resolver: NodeResolver = useCallback((targetId: string, pathId?: string) => {
    const key = pathId ? `${targetId}/${pathId}` : targetId
    const node = registry.current.get(key)
    if (node) {
      revealed.add(key)
    }
    return node
  }, [revealed])

  // On mount (page change), objects already in the scene are shown in full:
  // the animation belongs to the moment of dictation and does not replay on return.
  // On the first mount of the app the scene is empty and the effect does nothing.
  useEffect(() => {
    let layer: Konva.Layer | null = null
    for (const [key, node] of registry.current) {
      revealed.add(key)
      node.opacity(1)
      if (!layer) layer = node.getLayer()
    }
    layer?.batchDraw()

    // Cancel the player timeouts on unmount (page change) so we do not
    // advance steps over destroyed nodes.
    return () => player.cancel()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasTitle = Array.from(scene.objects.values()).some(
    (o) => o.object === 'texto' && o.role === 'titulo',
  )

  const { currentStroke, marqueeRect, cursorStyle, handlePointerDown, handlePointerMove, handlePointerUp, handleWheel, handleContextMenu } = useBoardPointer({
    tool, ink, scene, library, hasTitle, width, height, selectedId,
    onObjectMoved, onInkStrokeAdded, onInkStrokeErased, onObjectErased, onHighlightErased, onMarqueeSelect,
    onSelectObject, onRequestTextBox, onRequestEditText, showAreas, areaTree, onRequestAreaMenu,
  })
  const { stageRef, snapshotSoon } = useStageSnapshot({ scene, onSnapshot, width, height, view, selectedId, marqueeRect })

  // Play when pending steps arrive (after the Konva render)
  useEffect(() => {
    if (pendingSteps.length === 0) return

    // Small delay so Konva has mounted the new nodes
    const id = setTimeout(() => {
      player.play(pendingSteps, resolver, () => {
        // Safety net: ensures no node stays invisible
        // if some step did not cover it (e.g. a node unresolved during the animation).
        let layer: Konva.Layer | null = null
        for (const [key, node] of registry.current) {
          revealed.add(key)
          node.opacity(1)
          if (isRunsNode(node)) node.setAttr(REVEAL_ATTR, undefined)
          if (!layer) layer = node.getLayer()
        }
        layer?.batchDraw()
        onAnimationDone?.()
        snapshotSoon(150)
      })
      onStepsConsumed?.()
    }, 16)

    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSteps])

  // Global connection anchor spreading (pre-pass): looks at all arrows
  // so those touching the same object do not pile up on one point. It is
  // recomputed when the scene changes (including live dragging).
  const connectionAnchors = useMemo(
    () => assignConnectionAnchors(scene, { x: 0, y: 0, width, height }),
    [scene, width, height],
  )

  return (
    <Stage
      ref={stageRef}
      // Size in px of the Stage itself: the visible viewport, not the logical canvas.
      // Everything else in this file (background, anchors, layout,
      // hit-testing) keeps using width/height unchanged.
      width={viewportWidth ?? width}
      height={viewportHeight ?? height}
      // Viewport transform: scale and offset
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      // Right click: suppresses the browser menu and, over an area, opens the
      // areas context menu (split/delete).
      onContextMenu={handleContextMenu}
    >
      <Layer>
        {/* Slightly warm board background; listening=false so the
            pointerdown on an empty area reaches the Stage and triggers the marquee */}
        <Rect x={0} y={0} width={width} height={height} fill="#fafaf8" listening={false} />

        {/* ── Highlight of the context menu area ─────────────────────────────
            A per-area background color is NO longer painted (it was a debugging aid):
            areas are seen by their dividing lines (layer below). Only the area
            whose context menu is open is highlighted with a border. */}
        {showAreas && areaTree && selectedAreaId && (() => {
          const selRect = computeAreaRects(areaTree, computeBodyRect({ width, height }, hasTitle))
            .find((r) => r.id === selectedAreaId)
          if (!selRect) return null
          return (
            <Rect
              x={selRect.box.x}
              y={selRect.box.y}
              width={selRect.box.width}
              height={selRect.box.height}
              fill="rgba(37, 99, 235, 0.06)"
              stroke={SELECTION_COLOR}
              strokeWidth={2}
              dash={[10, 5]}
              listening={false}
            />
          )
        })()}

        {/* Objects: only draggable in select mode */}
        {Array.from(scene.objects.values()).map(obj =>
          <ObjectNode
            key={obj.id}
            obj={obj}
            library={library}
            reg={reg}
            revealed={revealed}
            section={sectionColorOf(scene, obj.id)}
            editing={editingId === obj.id}
            onMoved={tool === 'select' ? onObjectMoved : undefined}
          />,
        )}

        {/* Automatic date: app chrome, not a scene object. Only painted if there
            is a title band (same gate as the computeBodyRect reservation).
            Right-aligned in the band, with the same yellow background as the
            title (TEXT_BG_COLOR) to read as a visual sibling.
            listening=false: not selectable. */}
        {hasTitle && (() => {
          const dateText = formatBoardDate(new Date())
          const dateWidth = Math.ceil(dateText.length * DATE_FONT_SIZE * 0.55) + 2 * TEXT_PADDING
          const dateHeight = Math.ceil(DATE_FONT_SIZE * TEXT_LINE_HEIGHT) + 2 * TEXT_PADDING
          const dateX = width - STANDARD_MARGIN - dateWidth
          // Vertically centered in the title band (the same band the
          // title occupies, of fixed height TITLE_BAND_HEIGHT starting at y=MARGIN).
          const dateY = STANDARD_MARGIN + (TITLE_BAND_HEIGHT - dateHeight) / 2
          return (
            <Group x={dateX} y={dateY} listening={false}>
              <Rect width={dateWidth} height={dateHeight} fill={TEXT_BG_COLOR} cornerRadius={6} />
              <RunsText
                lines={[{ segments: [{ text: dateText, bold: true, start: 0, width: 0 }], width: 0 }]}
                fontSize={DATE_FONT_SIZE}
                roleBold={ROLE_STYLE.subtitulo.fontStyle === 'bold'}
                color={INK_COLOR}
                centerWidth={dateWidth}
                centerHeight={dateHeight}
                opacity={1}
              />
            </Group>
          )
        })()}

        {/* Object labels (above the paths) */}
        {Array.from(scene.objects.values())
          .filter(obj => obj.label && obj.object !== 'concepto')
          .map(obj => {
            const labelKey = `${obj.id}__label`
            // placeholder without inkGeometry -> label centered inside the bbox
            let isPlaceholder = false
            try {
              if (!obj.inkGeometry) isPlaceholder = resolveObject(library, obj.object).isPlaceholder
            } catch { /* broken library: treat as a non-placeholder */ }

            let x: number, y: number, width: number, align: string
            if (isPlaceholder) {
              // Centered inside the object bbox
              x = obj.box.x
              y = obj.box.y + obj.box.height / 2 - LABEL_FONT_SIZE / 2
              width = obj.box.width
              align = 'center'
            } else {
              const pos = labelPos(obj.box)
              x = pos.x; y = pos.y; width = pos.width; align = pos.align
            }
            return (
              <Text
                key={labelKey}
                ref={node => reg(labelKey, node)}
                text={obj.label ?? ''}
                x={x} y={y}
                width={width}
                align={align}
                fontSize={LABEL_FONT_SIZE}
                fontFamily={FONT_FAMILY}
                fill={STROKE_COLOR}
                opacity={revealed.has(labelKey) ? 1 : 0}
              />
            )
          })
        }

        {/* Connections */}
        {Array.from(scene.connections.values()).map(conn =>
          <ConnectionNode key={conn.id} conn={conn} scene={scene} reg={reg} revealed={revealed} bounds={{ x: 0, y: 0, width, height }} anchorOverride={connectionAnchors.get(conn.id)} />,
        )}

      </Layer>

      <HighlightLayer
        scene={scene}
        width={width}
        height={height}
        reg={reg}
        revealed={revealed}
        connectionAnchors={connectionAnchors}
      />

      {/* Ink layer: in hand mode (select) it listens to events to drag strokes */}
      <Layer listening={tool === 'select'}>
        {/* Saved strokes of the active page */}
        {(ink?.strokes ?? []).map(stroke => (
          <Line
            key={stroke.id}
            points={stroke.points}
            stroke={colorHex(stroke.color)}
            strokeWidth={STROKE_WIDTH}
            lineCap="round"
            lineJoin="round"
            tension={0.5}
            draggable={tool === 'select'}
            onDragEnd={(e) => {
              // The displaced node has its position in node.x()/node.y(); the model
              // is the source of truth, so we reset the node offset to (0,0)
              // and notify the delta to the reducer.
              const node = e.target
              const dx = node.x()
              const dy = node.y()
              node.x(0)
              node.y(0)
              onInkStrokeMoved?.(stroke.id, dx, dy)
            }}
          />
        ))}
        {/* Stroke in progress (while the teacher draws): not draggable */}
        {currentStroke.length >= 4 && (
          <Line
            points={currentStroke}
            stroke={colorHex(penColor)}
            strokeWidth={STROKE_WIDTH}
            lineCap="round"
            lineJoin="round"
            tension={0.5}
          />
        )}
      </Layer>

      {/* Selection layer: highlighted outline + anchor points.
          Above the objects, below the marquee; does not listen to events. */}
      <Layer listening={false}>
        {(() => {
          if (!selectedId) return null
          const sel = scene.objects.get(selectedId)
          if (!sel) return null
          const { box } = sel
          const anchors = selectionAnchors(sel, library)
          return (
            <>
              {/* Dotted selection rectangle around the box */}
              <Rect
                x={box.x - SELECTION_PAD}
                y={box.y - SELECTION_PAD}
                width={box.width + 2 * SELECTION_PAD}
                height={box.height + 2 * SELECTION_PAD}
                stroke={SELECTION_COLOR}
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
              {/* Anchor points: top / bottom / left / right */}
              {anchors.map((pt, i) => (
                <Circle
                  key={i}
                  x={pt.x}
                  y={pt.y}
                  radius={4}
                  fill={SELECTION_COLOR}
                  listening={false}
                />
              ))}
            </>
          )
        })()}
      </Layer>

      {showAreas && areaTree && tool === 'select' && (
        <AreaDividerLayer
          areaTree={areaTree}
          width={width}
          height={height}
          hasTitle={hasTitle}
          scene={scene}
          view={view}
          cursorStyle={cursorStyle}
          areaResizeSnapshotTaken={areaResizeSnapshotTaken}
          onResizeArea={onResizeArea}
        />
      )}

      {/* Resize handles layer:
          above the selection; listens to events to change the cursor.
          The Rects are NOT draggable; the gesture is driven from handlePointerDown. */}
      <Layer>
        {(() => {
          if (!selectedId || tool !== 'select' || !onObjectMoved) return null
          const sel = scene.objects.get(selectedId)
          if (!sel) return null
          const pts = resizeHandles(sel.box)
          return pts.map(pt => (
            <Rect
              key={pt.handle}
              x={pt.x - RESIZE_HANDLE_SIZE / 2}
              y={pt.y - RESIZE_HANDLE_SIZE / 2}
              width={RESIZE_HANDLE_SIZE}
              height={RESIZE_HANDLE_SIZE}
              fill="white"
              stroke={SELECTION_COLOR}
              strokeWidth={1.5}
              draggable={false}
              onMouseEnter={(e) => {
                const c = e.target.getStage()?.container()
                if (c) c.style.cursor = cursorFor(pt.handle)
              }}
              onMouseLeave={(e) => {
                const c = e.target.getStage()?.container()
                if (c) c.style.cursor = cursorStyle
              }}
            />
          ))
        })()}
      </Layer>

      {/* Marquee layer: above everything, does not listen to events */}
      <Layer listening={false}>
        {marqueeRect && (
          <Rect
            x={marqueeRect.width >= 0 ? marqueeRect.x : marqueeRect.x + marqueeRect.width}
            y={marqueeRect.height >= 0 ? marqueeRect.y : marqueeRect.y + marqueeRect.height}
            width={Math.abs(marqueeRect.width)}
            height={Math.abs(marqueeRect.height)}
            stroke="#2563eb"
            strokeWidth={1}
            dash={[4, 4]}
            fill="rgba(37, 99, 235, 0.05)"
          />
        )}
      </Layer>
    </Stage>
  )
}

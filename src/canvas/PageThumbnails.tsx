/**
 * PageThumbnails.tsx — thumbnail strip for the page selector.
 *
 * Canva-style thumbnail strip for the page selector.
 * Each page is previewed with a static inline SVG render that draws every object
 * (texts as plain strings, concepts as a circle with their name), the connection
 * lines, and also the freehand ink (InkLayer strokes), all without Konva and
 * without animation, so it does not compete with the live animation of SceneCanvas.
 *
 * Structure per card:
 *   - <ScenePreview>: static SVG with a shape per object, lines per
 *     connection, and polylines for ink strokes (on top of everything).
 *   - "Page {number}" label below the preview.
 *   - × button overlaid (top-right corner) if there is more than one page.
 *   - Click on the card → onSelect(index).
 *
 * At the end of the strip: a "+" button card to add a page.
 * The component is purely presentational: it does not call window.confirm nor
 * touch the reducer. The confirmation when deleting a page with content lives in
 * the handleRemovePage handler of App.tsx.
 */
import type { CSSProperties } from 'react'
import type { Page } from '@/document/model.js'
import { sceneForDisplay } from '@/scene/open-question.js'
import type { Scene, SceneObject } from '@/scene/model.js'
import type { InkLayer } from '@/ink/index.js'
import { colorHex } from '@/canvas/palette.js'
import { FONT_FAMILY } from './font.js'
import { INK_COLOR } from './board-colors.js'

// ── Props of the main component ───────────────────────────────────────────────

export interface PageThumbnailsProps {
  pages: Page[]
  activeIndex: number
  /** Width of the logical canvas (px), e.g. 1200. */
  canvasWidth: number
  /** Height of the logical canvas (px), e.g. 900. */
  canvasHeight: number
  /** If true, no handler is invoked and the buttons are disabled. */
  disabled?: boolean
  onSelect: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  /** Strip direction. 'horizontal' (default) or 'vertical' (side rail). */
  orientation?: 'horizontal' | 'vertical'
  /**
   * Captures of the real canvas render, by page number (data URL). If present, the
   * thumbnail is that image (faithful: colors, bold, concepts, paragraphs). Without a capture
   * (page not shown yet) the simplified fallback SVG is used.
   */
  snapshots?: Readonly<Record<number, string>>
}

// ── Thumbnail dimensions (screen px) ──────────────────────────────────────────

const THUMB_W = 132
const THUMB_H = 74 // 16:9 ratio identical to the canvas (1440x810)

// ── Sub-component: static SVG preview of the scene ────────────────────────────

interface ScenePreviewProps {
  scene: Scene
  ink: InkLayer
  canvasWidth: number
  canvasHeight: number
}

/**
 * Converts a flat array [x0,y0,x1,y1,...] to the <polyline> points format
 * "x0,y0 x1,y1 ...".
 */
function flatToPoints(pts: number[]): string {
  const out: string[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`)
  return out.join(' ')
}

/**
 * Static render of a scene:
 * - For each SceneObject: a text string, or a circle with the concept name,
 *   in flat SVG, without animation.
 * - A <line> for each SceneConnection, from the center of the from object
 *   to the center of the to object (if either is missing, the line is omitted).
 * - Polylines for each ink stroke (InkLayer), drawn
 *   on top of objects and connections, like in SceneCanvas.
 * No animation, no Konva.
 */
function ScenePreview({ scene: fullScene, ink, canvasWidth, canvasHeight }: ScenePreviewProps) {
  // The open question does not appear in thumbnails.
  const scene = sceneForDisplay(fullScene)
  /** Geometric center of a SceneObject. */
  function centerOf(obj: SceneObject): { cx: number; cy: number } {
    return {
      cx: obj.box.x + obj.box.width / 2,
      cy: obj.box.y + obj.box.height / 2,
    }
  }

  const objectNodes = Array.from(scene.objects.values()).map((obj) => {
    const box = obj.box

    // Text -> render the string centered in the box
    if (obj.object === 'texto') {
      return (
        <text
          key={obj.id}
          x={box.x + box.width / 2}
          y={box.y + box.height / 2}
          fontSize={Math.max(12, Math.round(box.height * 0.55))}
          fontFamily={FONT_FAMILY}
          fill={INK_COLOR}
          textAnchor="middle"
          dominantBaseline="central"
        >{obj.text ?? ''}</text>
      )
    }

    // Concept -> the circle (5-95 % of the box) with its name centered inside
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    return (
      <g key={obj.id}>
        <ellipse
          cx={cx}
          cy={cy}
          rx={box.width * 0.45}
          ry={box.height * 0.45}
          fill="none"
          stroke={INK_COLOR}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={cx}
          y={cy}
          fontSize={Math.max(20, Math.round(box.height * 0.28))}
          fontFamily={FONT_FAMILY}
          fill={INK_COLOR}
          textAnchor="middle"
          dominantBaseline="central"
        >{obj.label ?? ''}</text>
      </g>
    )
  })

  const connectionLines = Array.from(scene.connections.values()).flatMap((conn) => {
    const fromObj = scene.objects.get(conn.from)
    const toObj = scene.objects.get(conn.to)
    if (!fromObj || !toObj) return []
    const { cx: x1, cy: y1 } = centerOf(fromObj)
    const { cx: x2, cy: y2 } = centerOf(toObj)
    return [
      <line
        key={conn.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#9ca3af"
        strokeWidth={4}
      />,
    ]
  })

  // Ink: strokes in absolute canvas coords, drawn on top.
  const inkNodes = ink.strokes.map((stroke) => (
    <polyline
      key={stroke.id}
      points={flatToPoints(stroke.points)}
      fill="none"
      stroke={colorHex(stroke.color)}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  ))

  return (
    <svg
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      width={THUMB_W}
      height={THUMB_H}
      style={{ display: 'block', background: '#fafaf8' }}
    >
      {objectNodes}
      {connectionLines}
      {inkNodes}
    </svg>
  )
}

// ── Main component: thumbnail strip ───────────────────────────────────────────

/**
 * Horizontal strip of Canva-style page thumbnails.
 * Presentational: does not touch the store nor call browser dialogs.
 */
export function PageThumbnails({
  pages,
  activeIndex,
  canvasWidth,
  canvasHeight,
  disabled = false,
  onSelect,
  onAdd,
  onRemove,
  orientation = 'horizontal',
  snapshots,
}: PageThumbnailsProps) {
  const stripStyle: CSSProperties = orientation === 'vertical'
    ? {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
        overflowX: 'hidden',
        gap: 8,
        padding: '6px',
      }
    : {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        overflowX: 'auto',
        gap: 8,
        padding: '6px 0',
      }

  // Common card styles
  function cardStyle(isActive: boolean): CSSProperties {
    return {
      position: 'relative',
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 3,
      padding: 3,
      border: isActive ? '2px solid #2563eb' : '2px solid #d1d5db',
      borderRadius: 6,
      background: isActive ? '#eff6ff' : '#ffffff',
      cursor: disabled ? 'default' : 'pointer',
      flexShrink: 0,
    }
  }

  const labelStyle: CSSProperties = {
    fontSize: 10,
    color: '#374151',
    lineHeight: 1,
    userSelect: 'none',
  }

  function removeButtonStyle(): CSSProperties {
    return {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 14,
      height: 14,
      padding: 0,
      background: '#f3f4f6',
      border: '1px solid #d1d5db',
      borderRadius: 3,
      cursor: disabled ? 'default' : 'pointer',
      color: '#6b7280',
      fontSize: 10,
      lineHeight: '14px',
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }
  }

  const addCardStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: THUMB_W + 6,  // same width as the cards (padding 3px × 2)
    height: THUMB_H + 6 + 16, // thumb height + padding + label
    border: '2px dashed #d1d5db',
    borderRadius: 6,
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    color: '#6b7280',
    fontSize: 18,
    flexShrink: 0,
  }

  return (
    <div style={stripStyle}>
      {pages.map((page, index) => {
        const isActive = index === activeIndex
        return (
          <div
            key={page.number}
            style={cardStyle(isActive)}
            onClick={() => { if (!disabled) onSelect(index) }}
            role="button"
            aria-label={`Page ${page.number}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {/* Capture of the real render; fallback: simplified static SVG */}
            {snapshots?.[page.number] ? (
              <img
                src={snapshots[page.number]}
                width={THUMB_W}
                height={THUMB_H}
                alt=""
                draggable={false}
                data-testid="page-snapshot"
                style={{ display: 'block', background: '#fafaf8', objectFit: 'contain' }}
              />
            ) : (
              <ScenePreview
                scene={page.scene}
                ink={page.ink}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            )}

            {/* Page number label */}
            <span style={labelStyle}>Page {page.number}</span>

            {/* × delete button: only if there is more than one page */}
            {pages.length > 1 && (
              <button
                aria-label={`Delete page ${page.number}`}
                title={`Delete page ${page.number}`}
                disabled={disabled}
                style={removeButtonStyle()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled) onRemove(index)
                }}
              >
                ×
              </button>
            )}
          </div>
        )
      })}

      {/* Button card to add a new page */}
      <button
        aria-label="Add page"
        title="Add page"
        disabled={disabled}
        style={addCardStyle}
        onClick={() => { if (!disabled) onAdd() }}
      >
        +
      </button>
    </div>
  )
}

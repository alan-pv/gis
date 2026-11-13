/**
 * HighlightLayer — the emphasis gestures (underline / ellipse / arrow) of the scene,
 * drawn above objects and connections as hand-drawn roughened paths. Does not listen
 * to events; the opacity is revealed by the animation like any other stroke.
 */
import { Layer, Path } from 'react-konva'
import type { Scene } from '@/scene/index.js'
import { highlightPath, HIGHLIGHT_COLOR, HIGHLIGHT_STROKE_WIDTH } from './highlight-geometry.js'
import { roughenPath, hashId } from './rough.js'
import { connectionGeometryFor, type ConnAnchorOverride } from './connection-anchors.js'
import { labelBoxOrigin } from './connection-geometry.js'
import { LABEL_FONT_SIZE } from './canvas-style.js'
import { highlightTargetBox, measureWordRange } from './scene-hit.js'
import Konva from 'konva'

interface HighlightLayerProps {
  scene: Scene
  width: number
  height: number
  reg: (key: string, node: Konva.Node | null) => void
  /** Keys already revealed by the animation. */
  revealed: Set<string>
  connectionAnchors: Map<string, ConnAnchorOverride>
}

export function HighlightLayer({ scene, width, height, reg, revealed, connectionAnchors }: HighlightLayerProps) {
  return (
    <Layer listening={false}>
          {Array.from(scene.highlights.values()).map(hl => {
            // Special case: highlight of a CONNECTION. It emphasizes the RELATION,
            // not the space between its ends: if the arrow has a label, that text
            // is underlined; otherwise its own line is traced over in highlight color.
            const conn = scene.connections.get(hl.ref)
            let rawPath: string
            if (conn) {
              const cgeom = connectionGeometryFor(scene, conn, { x: 0, y: 0, width, height }, connectionAnchors.get(conn.id))
              if (!cgeom) return null
              if (conn.label) {
                // Underline the label text (no box), where it is actually painted.
                const lw = Math.max(24, conn.label.length * LABEL_FONT_SIZE * 0.6)
                const lo = labelBoxOrigin(cgeom.labelAnchor, cgeom.labelTangent, lw, LABEL_FONT_SIZE)
                const ly = lo.y + LABEL_FONT_SIZE + 2
                rawPath = `M ${lo.x} ${ly} L ${lo.x + lw} ${ly}`
              } else {
                // Trace over the arrow's own line.
                rawPath = cgeom.linePath
              }
            } else {
              const box = highlightTargetBox(scene, hl.ref)
              if (!box) return null
              // Horizontal range of the word (if any)
              const wordRange = hl.word
                ? measureWordRange(scene, hl.ref, hl.word)
                : undefined
              rawPath = highlightPath(wordRange?.box ?? box, hl.gesture, wordRange, { x: 0, y: 0, width, height })
            }
  
            // Apply rough jitter for a hand-drawn look
            const roughed = roughenPath(rawPath, hashId(hl.id))
            // Red is reserved for emphasis: every highlight uses HIGHLIGHT_COLOR.
            const strokeColor = HIGHLIGHT_COLOR
  
            return (
              <Path
                key={hl.id}
                ref={node => reg(hl.id, node)}
                data={roughed}
                stroke={strokeColor}
                strokeWidth={HIGHLIGHT_STROKE_WIDTH}
                lineCap="round"
                lineJoin="round"
                fillEnabled={false}
                opacity={revealed.has(hl.id) ? 1 : 0}
                listening={false}
              />
            )
          })}
        </Layer>
  )
}

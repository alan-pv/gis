/** ConnectionNode — one connection (arrow or line) on the Konva board, with its label. */
import { Group, Path, Text } from 'react-konva'
import type { Scene, SceneConnection } from '@/scene/index.js'
import type { BBox } from '@/layout/index.js'
import { roughenPath, hashId } from './rough.js'
import { connectionGeometryFor, type ConnAnchorOverride } from './connection-anchors.js'
import { labelBoxOrigin } from './connection-geometry.js'
import { FONT_FAMILY } from './font.js'
import { STROKE_COLOR, STROKE_WIDTH, LABEL_FONT_SIZE } from './canvas-style.js'
import Konva from 'konva'

interface ConnectionNodeProps {
  conn: SceneConnection
  scene: Scene
  reg: (key: string, node: Konva.Node | null) => void
  /** Set of already revealed keys; determines the initial opacity of animatable nodes. */
  revealed: Set<string>
  /** Board rectangle: bounds the orthogonal detour so it does not leave the canvas. */
  bounds: BBox
  /** Anchors already spread by the global pass (keeps arrows from piling up on one point). */
  anchorOverride?: ConnAnchorOverride
}

export function ConnectionNode({ conn, scene, reg, revealed, bounds, anchorOverride }: ConnectionNodeProps) {
  const seed = hashId(conn.id)
  // Full geometry (single source, shared with the connection highlight).
  const geom = connectionGeometryFor(scene, conn, bounds, anchorOverride)
  if (!geom) return null

  // Connections use the content ink (they do not inherit a group color).
  const strokeColor = STROKE_COLOR

  // Midpoint of the ACTUAL stroke (follows the arrow, including the orthogonal
  // detour). The label has no box and sits apart from the stroke, perpendicular to it.
  const labelText = conn.label ?? ''
  const labelW = Math.max(24, labelText.length * LABEL_FONT_SIZE * 0.6)
  const labelOrigin = labelBoxOrigin(geom.labelAnchor, geom.labelTangent, labelW, LABEL_FONT_SIZE)

  // Group with opacity 1: pulse/fade_out target the group, not the children.
  // Each animatable child mounts invisible until the animation reveals it.
  const lineKey    = `${conn.id}/line`
  const arrowToKey = `${conn.id}/arrowTo`
  const arrowFromKey = `${conn.id}/arrowFrom`
  const labelKey   = `${conn.id}__label`

  return (
    <Group ref={node => reg(conn.id, node)}>
      {/* fillEnabled={false} is mandatory: fill="none" does not disable the fill in Konva
          (it reads it as an invalid color and leaves fillEnabled=true), so open paths
          would get filled by being implicitly closed. */}
      <Path
        ref={node => reg(lineKey, node)}
        data={roughenPath(geom.linePath, seed)}
        stroke={strokeColor}
        strokeWidth={STROKE_WIDTH}
        lineCap="round"
        lineJoin="round"
        fillEnabled={false}
        opacity={revealed.has(lineKey) ? 1 : 0}
      />
      {geom.arrowTo && (
        <Path
          ref={node => reg(arrowToKey, node)}
          data={geom.arrowTo}
          stroke={strokeColor}
          strokeWidth={STROKE_WIDTH}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          opacity={revealed.has(arrowToKey) ? 1 : 0}
        />
      )}
      {geom.arrowFrom && (
        <Path
          ref={node => reg(arrowFromKey, node)}
          data={geom.arrowFrom}
          stroke={strokeColor}
          strokeWidth={STROKE_WIDTH}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          opacity={revealed.has(arrowFromKey) ? 1 : 0}
        />
      )}
      {conn.label && (
        <>
          <Text
            ref={node => reg(labelKey, node)}
            text={conn.label}
            x={labelOrigin.x} y={labelOrigin.y}
            width={labelW}
            align="center"
            fontSize={LABEL_FONT_SIZE}
            fontFamily={FONT_FAMILY}
            fill={STROKE_COLOR}
            opacity={revealed.has(labelKey) ? 1 : 0}
          />
        </>
      )}
    </Group>
  )
}

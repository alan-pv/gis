/**
 * Immutable-ish scene model of the canvas engine.
 *
 * The scene engine is pure: no Konva, no React, no DOM.
 * All geometry lives in logical BBoxes resolved by the layout engine.
 */
import type { BBox } from '@/layout/index.js'
import type { ConnectStyle, Role } from '@/contract/index.js'
import type { Color, Fill } from '@/library/index.js'

// ── Scene object ──────────────────────────────────────────────────────────────

/**
 * Object instantiated in the scene.
 * The box is resolved by the layout engine.
 */
export interface SceneObject {
  id: string
  /** Library type: "sol", "nube", "texto", etc. */
  object: string
  /** Visible label of the object; null if none. */
  label: string | null
  /** Text of the object; only meaningful for object === "texto". */
  text: string | null
  /** Effective color of the object. Optional so existing constructors keep working. */
  color?: Color
  /** Effective fill of the object. Optional so existing constructors keep working. */
  fill?: Fill
  /**
   * Semantic role of the object.
   * Only meaningful for object === 'texto'; null for non-text.
   * Read-only in the agent state.
   */
  role: Role | null
  /** Bounding box resolved by the layout engine (logical pixels). */
  box: BBox
  /**
   * Font size computed at insertion time.
   * Only relevant for object === 'texto' with role === 'titulo' (auto-fit).
   * Internal engine field: it is NOT in the contract nor in the agent state
   * (like inkGeometry). Rendering falls back to ROLE_STYLE[role].fontSize.
   */
  fontSize?: number
  /**
   * Original ink strokes of the teacher (from promotion), flattened points
   * [x0,y0,...] RELATIVE to the box origin. If present, rendering uses THESE
   * strokes instead of the library SVG and the anchors are the midpoints of the
   * bounding box. Internal engine field: it is NOT in the contract nor in the
   * agent state.
   */
  inkGeometry?: number[][]
  /**
   * Id of the group this LOOSE figure is attached to FOR LAYOUT ONLY (a late member of
   * the block). Set once, when processing a `connect` in the same batch in which the figure
   * was born, and never changed afterwards (a later connect does not move an already drawn
   * figure). Internal engine field: it is NOT in the contract nor in the agent state
   * (real group membership does not change).
   */
  layoutAttach?: string
  /**
   * Id of the target object next to which this LOOSE figure is placed when attaching it to the
   * group's block was reverted by the layout guard. Set once (same batch) and only affects
   * layout: the figure takes the free slot nearest to the target without moving anything already
   * placed. Internal to the engine; not in the contract nor in the agent state.
   */
  layoutNear?: string
  /**
   * Number of the first item of a numbered list: position of the object among the consecutive
   * `enumeracion` items of its group. Set by the app after each layout; absent = 1.
   * Internal to the engine: NOT in the contract nor in the agent state.
   */
  listStart?: number
  /**
   * Fragments of a paragraph split across columns: boxes of the SAME object with their
   * line range (`fromLine` inclusive, `toLine` exclusive, over the lines of `layoutRuns`
   * at the width of `box`). The first matches `box`. Absent = the object fits whole.
   * Internal to the engine: NOT in the contract nor in the agent state.
   */
  fragments?: import('@/layout/index.js').TextFragment[]
}

// ── Scene connection ──────────────────────────────────────────────────────────

/**
 * Connection (arrow or line) between two objects or groups.
 * Stroke geometry is the renderer's responsibility.
 */
export interface SceneConnection {
  id: string
  from: string
  to: string
  style: ConnectStyle
  label: string | null
}

// ── Scene group ───────────────────────────────────────────────────────────────

/**
 * Logical group of objects. Groups are not nested.
 * Groups take no space of their own; their bbox is the union of their members.
 */
export interface SceneGroup {
  id: string
  label: string | null
  /** IDs of the member objects (never groups, only objects). */
  members: string[]
  /**
   * The group's block has already widened to the full row (grow rightwards before downwards).
   * Sticky and monotonic: never goes back to `false`. Internal engine field: NOT in the
   * contract nor in the agent state.
   */
  wide?: boolean
}

// ── Scene highlight ───────────────────────────────────────────────────────────

/**
 * Highlight tracked by the scene, tied to the id of the object it refers to.
 *
 * Invisible to the LLM agent (sceneToAgentState ignores it).
 * Not draggable on its own (it belongs to the object).
 * Deleted in cascade when its referent is deleted.
 */
export interface SceneHighlight {
  id: string
  /** Id of the highlighted object/group/connection. */
  ref: string
  /** Gesture chosen by the app (not by the agent). */
  gesture: 'underline' | 'ellipse' | 'arrow'
  /** Word selector; absent = the whole box. */
  word?: string
}

// ── Full scene ────────────────────────────────────────────────────────────────

/**
 * Full scene state of a page.
 * Maps give O(1) access by id.
 */
export interface Scene {
  objects: Map<string, SceneObject>
  connections: Map<string, SceneConnection>
  groups: Map<string, SceneGroup>
  /** Highlights tracked by the scene (invisible to the LLM agent). */
  highlights: Map<string, SceneHighlight>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates an empty scene (no objects, connections, groups or highlights).
 */
export function emptyScene(): Scene {
  return {
    objects: new Map(),
    connections: new Map(),
    groups: new Map(),
    highlights: new Map(),
  }
}

/**
 * Returns all IDs present in the scene (objects + connections + groups + highlights).
 */
export function allIds(scene: Scene): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const id of scene.objects.keys()) ids.add(id)
  for (const id of scene.connections.keys()) ids.add(id)
  for (const id of scene.groups.keys()) ids.add(id)
  for (const id of scene.highlights.keys()) ids.add(id)
  return ids
}

/**
 * Computes a group's bounding box as the union of its members' boxes.
 *
 * Returns null if the group does not exist or has no members with resolved boxes.
 */
export function groupBBox(scene: Scene, groupId: string): BBox | null {
  const group = scene.groups.get(groupId)
  if (!group || group.members.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const memberId of group.members) {
    const obj = scene.objects.get(memberId)
    if (!obj) continue
    found = true
    minX = Math.min(minX, obj.box.x)
    minY = Math.min(minY, obj.box.y)
    maxX = Math.max(maxX, obj.box.x + obj.box.width)
    maxY = Math.max(maxY, obj.box.y + obj.box.height)
  }

  if (!found) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

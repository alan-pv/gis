/**
 * Connection anchor spreading, a layer above connection-geometry.
 *
 * Orchestrates the routing of ALL connections of the scene in THREE phases:
 *
 * 1. **Side**: for each connection (in insertion order, which is the narrative
 *    arrival order) the side of each end is chosen with
 *    `chooseConnectionAnchors` (cheapest orthogonal route).
 * 2. **Spreading**: ends that share an (object, side) are distributed along that
 *    side so arrows touching the same object do not pile up on one point,
 *    ordered by the position of the OTHER end (to minimize trivial crossings
 *    next to the object).
 * 3. **Sequential routing**: with the final points already spread, each
 *    connection is routed (same insertion order) with `buildRoute`, passing the
 *    polylines of the connections ALREADY routed (`existingRoutes`) so the
 *    router penalizes crossings and overlaps with them and prefers to keep apart.
 */
import type { BBox } from '@/layout/index.js'
import type { Scene, SceneConnection } from '@/scene/index.js'
import type { Anchor } from './anchors.js'
import type { Point } from './anchors.js'
import { chooseConnectionAnchors, connectionGeometry, buildRoute } from './connection-geometry.js'
import type { ConnectionGeometry } from './connection-geometry.js'

/**
 * Final anchors (point + outgoing direction) of a connection, already spread.
 * `route`, if present, is the final polyline already computed with crossing
 * avoidance (phase 3 of `assignConnectionAnchors`): `connectionGeometry` uses it
 * AS IS, without re-routing.
 */
export interface ConnAnchorOverride {
  from: { pt: Point; dir: Point }
  to: { pt: Point; dir: Point }
  route?: Point[]
}

/** Point on a side of the box at fraction `frac` ∈ (0,1) of its length. */
function pointOnSide(box: BBox, side: Anchor, frac: number): Point {
  switch (side) {
    case 'top':    return { x: box.x + frac * box.width, y: box.y }
    case 'bottom': return { x: box.x + frac * box.width, y: box.y + box.height }
    case 'left':   return { x: box.x, y: box.y + frac * box.height }
    case 'right':  return { x: box.x + box.width, y: box.y + frac * box.height }
  }
}

/** Boxes of the objects the connection must route around (all but its two ends). */
function obstaclesFor(scene: Scene, conn: SceneConnection): BBox[] {
  const out: BBox[] = []
  for (const [oid, obj] of scene.objects) {
    if (oid === conn.from || oid === conn.to) continue
    if (obj.box.width > 0 && obj.box.height > 0) out.push(obj.box)
  }
  return out
}

/**
 * Full geometry of a connection (routed line + arrowheads + labelAnchor),
 * resolving obstacles. SINGLE source used by the connection render and by the
 * connection highlight (so they never diverge). Returns null if an end is missing.
 */
export function connectionGeometryFor(
  scene: Scene,
  conn: SceneConnection,
  bounds: BBox,
  override?: ConnAnchorOverride,
): ConnectionGeometry | null {
  const fromObj = scene.objects.get(conn.from)
  const toObj = scene.objects.get(conn.to)
  if (!fromObj || !toObj) return null
  return connectionGeometry(
    fromObj.box, toObj.box,
    conn.style,
    obstaclesFor(scene, conn),
    bounds,
    override,
  )
}

/**
 * Computes the spread anchors of every connection in the scene.
 *
 * @param scene    Scene with objects and connections.
 * @param bounds   Board rectangle (bounds the orthogonal routing).
 * @returns        Map connId -> anchor override; connections whose objects do
 *                 not exist are skipped.
 */
export function assignConnectionAnchors(
  scene: Scene,
  bounds: BBox,
): Map<string, ConnAnchorOverride> {
  // ── Phase 1: choose the side of each end (best route) and the initial override. ──
  interface Entry { fromId: string; toId: string; fromSide: Anchor; toSide: Anchor; override: ConnAnchorOverride }
  const entries = new Map<string, Entry>()

  for (const [id, conn] of scene.connections) {
    const fromObj = scene.objects.get(conn.from)
    const toObj = scene.objects.get(conn.to)
    if (!fromObj || !toObj) continue

    const ch = chooseConnectionAnchors(
      fromObj.box, toObj.box,
      obstaclesFor(scene, conn), bounds,
    )

    entries.set(id, {
      fromId: conn.from, toId: conn.to,
      fromSide: ch.from.side, toSide: ch.to.side,
      override: {
        from: { pt: ch.from.pt, dir: ch.from.dir },
        to: { pt: ch.to.pt, dir: ch.to.dir },
      },
    })
  }

  // ── Phase 2: group ends by (object, side) and spread those that share a side. ──
  // Stable key: "objId|side".
  const groups = new Map<string, Array<{ connId: string; end: 'from' | 'to' }>>()
  const add = (objId: string, side: Anchor, connId: string, end: 'from' | 'to') => {
    const key = `${objId}|${side}`
    const arr = groups.get(key) ?? []
    arr.push({ connId, end })
    groups.set(key, arr)
  }
  for (const [id, e] of entries) {
    add(e.fromId, e.fromSide, id, 'from')
    add(e.toId, e.toSide, id, 'to')
  }

  for (const [key, members] of groups) {
    if (members.length <= 1) continue
    const sep = key.lastIndexOf('|')
    const objId = key.slice(0, sep)
    const side = key.slice(sep + 1) as Anchor
    const box = scene.objects.get(objId)?.box
    if (!box) continue

    // Order by the coordinate of the OTHER end of each connection, projected on
    // the axis of the side (top/bottom -> x; left/right -> y): the spread then
    // follows the direction each arrow goes and avoids trivial crossings right
    // next to the object. Stable tie-break by connId+end.
    const axis: 'x' | 'y' = (side === 'top' || side === 'bottom') ? 'x' : 'y'
    const otherCoord = (m: { connId: string; end: 'from' | 'to' }): number => {
      const ov = entries.get(m.connId)!.override
      const otherPt = m.end === 'from' ? ov.to.pt : ov.from.pt
      return otherPt[axis]
    }
    members.sort((a, b) => {
      const da = otherCoord(a), db = otherCoord(b)
      if (da !== db) return da - db
      const ka = a.connId + a.end, kb = b.connId + b.end
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    members.forEach((m, i) => {
      const frac = (i + 1) / (members.length + 1)
      const pt = pointOnSide(box, side, frac)
      const ov = entries.get(m.connId)!.override
      ov[m.end] = { pt, dir: ov[m.end].dir }
    })
  }

  // ── Phase 3: route sequentially (insertion order), accumulating crossing avoidance. ──
  const existingRoutes: Point[][] = []
  for (const [id, conn] of scene.connections) {
    const e = entries.get(id)
    if (!e) continue
    const route = buildRoute(e.override.from, e.override.to, obstaclesFor(scene, conn), bounds, existingRoutes)
    e.override.route = route
    existingRoutes.push(route)
  }

  const out = new Map<string, ConnAnchorOverride>()
  for (const [id, e] of entries) out.set(id, e.override)
  return out
}

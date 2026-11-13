/**
 * Connection geometry (pure module, no Konva or DOM).
 *
 * Computes the SVG `d` paths of a connection between two objects. EVERY
 * connection is routed orthogonally (horizontal/vertical runs with 90° bends,
 * Manhattan style): never a straight diagonal or a curve, even when both ends
 * are already aligned in X or Y (the route then degenerates into a single
 * straight segment because `simplify` collapses collinear vertices). Every
 * vertex is clamped to the board rectangle (`bounds`) so the stroke never
 * leaves the canvas, and `obstacles` are routed around.
 * Arrowheads are produced for the `arrow` and `double_arrow` styles. Routing
 * also penalizes crossings and overlaps with routes of other connections
 * already computed (`existingRoutes`); see `assignConnectionAnchors` in
 * connection-anchors.ts, which routes sequentially and accumulates the routes.
 */
import type { BBox } from '@/layout/index.js'
import type { ConnectStyle } from '@/contract/index.js'
import type { Anchor } from './anchors.js'
import type { Point } from './anchors.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** Length of the arrowhead wings (px). */
const ARROW_SIZE = 10

/** Half-angle of the arrowhead wings (radians). */
const ARROW_ANGLE = Math.PI / 6  // 30°

/** Sample points per SEGMENT when testing for obstacle hits. */
const SEGMENT_SAMPLES = 24

/**
 * Padding (px) added to each obstacle before routing. The stroke is computed to
 * clear the enlarged box, leaving a visible margin around the text and absorbing
 * rough.js jitter without touching the edge again.
 */
const OBSTACLE_PAD = 8

/** Gap (px) between orthogonal corridors and the board edge. */
const ROUTE_GAP = 6

/**
 * Length (px) of the perpendicular "stub" where the stroke LEAVES the source box
 * and ENTERS the target box. It makes the arrow take off and land at a right
 * angle to the anchored side (clean look) before turning into the corridor.
 */
const STUB = 16

/**
 * Cost penalty per bend (direction change) of the route. Deliberately high:
 * among collision-free routes we prefer the one with the FEWEST bends (cleaner),
 * then the shortest. A clean side exit beats a bottom exit that forces a zigzag,
 * and a route crossing half the board loses.
 */
const BEND_PENALTY = 90

/**
 * Cost penalty per CROSSING between the candidate route and a segment of an
 * already computed route of another connection (`existingRoutes`). Higher than a
 * bend (BEND_PENALTY): crossing is still allowed when the alternative is worse
 * (e.g. going all the way around the board), but it is penalized heavily so
 * sequential routing prefers to keep routes apart.
 */
const CROSSING_PENALTY = 180

/**
 * Cost penalty per px of collinear OVERLAP (two parallel segments running on the
 * same row/column) with an already computed route. Keeps two arrows from
 * travelling on top of each other along the same corridor.
 */
const OVERLAP_PENALTY_PER_PX = 1.5

/**
 * Inset (px) applied to obstacles to avoid false positives when a segment merely
 * grazes the edge of a neighboring bbox.
 */
const BOX_INSET = 2

/**
 * Distance (px) between a candidate corridor derived from an EXISTING route
 * (row/column at ± this offset around each H/V run of that route) and the route
 * itself: leaves room for sequential routing to dodge it instead of merely
 * crossing it or hugging it.
 */
const EXISTING_ROUTE_CORRIDOR_OFFSET = 12

/** Cap on candidate rows/columns derived from existing routes (avoids a combinatorial explosion). */
const MAX_DERIVED_CORRIDORS = 24

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConnectionGeometry {
  /** Path `d` of the main stroke. */
  linePath: string
  /** Path `d` of the arrowhead at `to` (undefined if style === 'line'). */
  arrowTo?: string
  /** Path `d` of the arrowhead at `from` (only for 'double_arrow'). */
  arrowFrom?: string
  /** Midpoint of the ACTUAL stroke (by arc length): where to place the label. */
  labelAnchor: Point
  /** Unit tangent of the stroke at `labelAnchor` (to offset the label perpendicular to the stroke). */
  labelTangent: Point
}

// ── Main function ─────────────────────────────────────────────────────────

/**
 * Computes the full geometry of a connection.
 *
 * @param fromBox     Box of the source object.
 * @param toBox       Box of the target object.
 * @param style       Style: 'line' | 'arrow' | 'double_arrow'.
 * @param obstacles   Boxes of intermediate objects to route around (the caller
 *                    excludes from/to).
 * @param bounds      Board rectangle; the vertices of the orthogonal detour are
 *                    clamped to it so the stroke does not leave the canvas.
 * @param override    Anchors already chosen (point + direction) by the upper
 *                    layer to SPREAD several arrows over the same side. If it
 *                    carries `route`, that polyline was already computed (with
 *                    crossing avoidance against other connections) and is used
 *                    AS IS, without re-routing. If it only has `from`/`to`
 *                    (no `route`), it routes between those points as a fallback
 *                    (ignoring other connections).
 */
export function connectionGeometry(
  fromBox: BBox,
  toBox: BBox,
  style: ConnectStyle,
  obstacles: readonly BBox[] = [],
  bounds?: BBox,
  override?: { from: { pt: Point; dir: Point }; to: { pt: Point; dir: Point }; route?: Point[] },
): ConnectionGeometry {
  // The final polyline: the one already computed by the upper layer (with
  // crossing avoidance), or routed from scratch between the anchors (imposed by
  // `override` or chosen by chooseConnectionAnchors) as a fallback.
  let points: Point[]
  if (override?.route) {
    points = override.route
  } else {
    const choice = override ?? chooseConnectionAnchors(fromBox, toBox, obstacles, bounds)
    points = buildRoute(choice.from, choice.to, obstacles, bounds)
  }

  const linePath = polylinePath(points)
  // Vertices adjacent to each end, to orient the arrowheads.
  const from = points[0] ?? { x: 0, y: 0 }
  const to = points[points.length - 1] ?? from
  const beforeTo: Point = points[points.length - 2] ?? from
  const afterFrom: Point = points[1] ?? to
  const labelAnchor = polylineMidpoint(points)
  const labelTangent = polylineTangentAtMidpoint(points)

  // Arrowheads: oriented by the last/first run of the stroke.
  const result: ConnectionGeometry = { linePath, labelAnchor, labelTangent }

  if (style === 'arrow' || style === 'double_arrow') {
    result.arrowTo = arrowPath(to, dirFrom(beforeTo, to))
  }

  if (style === 'double_arrow') {
    result.arrowFrom = arrowPath(from, dirFrom(afterFrom, from))
  }

  return result
}

// ── Orthogonal routing ─────────────────────────────────────────────────────────

/** Midpoint of one side of the box. */
function sideMidpoint(box: BBox, side: Anchor): Point {
  switch (side) {
    case 'top':    return { x: box.x + box.width / 2, y: box.y }
    case 'bottom': return { x: box.x + box.width / 2, y: box.y + box.height }
    case 'left':   return { x: box.x, y: box.y + box.height / 2 }
    case 'right':  return { x: box.x + box.width, y: box.y + box.height / 2 }
  }
}

/** Unit direction pointing out of the box for a side. */
function outwardDir(side: Anchor): Point {
  switch (side) {
    case 'top':    return { x: 0, y: -1 }
    case 'bottom': return { x: 0, y: 1 }
    case 'left':   return { x: -1, y: 0 }
    case 'right':  return { x: 1, y: 0 }
  }
}

const SIDES: readonly Anchor[] = ['top', 'bottom', 'left', 'right']

/** Anchor chosen for one end of the connection: side + point + outgoing direction. */
export interface AnchorChoice {
  side: Anchor
  pt: Point
  dir: Point
}

/** Exit/entry candidates of a box for orthogonal routing: its 4 sides (the best route wins). */
function anchorCandidates(box: BBox): AnchorChoice[] {
  return SIDES.map(side => ({ side, pt: sideMidpoint(box, side), dir: outwardDir(side) }))
}

/**
 * Chooses the anchors (side/point/direction) of BOTH ends of a connection: every
 * pair of candidates (the 4 sides of each box) is evaluated by routing
 * orthogonally between them (`routeBetween`), and the cheapest wins,
 * lexicographically by (obstacle hits, route score). The score includes length,
 * bends and, if `existingRoutes` is given, crossings/overlaps with connections
 * already routed.
 *
 * Spreading several anchors over the same side (so entry and exit do not
 * overlap) is done by the upper layer using these `side` values (see
 * assignConnectionAnchors).
 */
export function chooseConnectionAnchors(
  fromBox: BBox,
  toBox: BBox,
  obstacles: readonly BBox[] = [],
  bounds?: BBox,
  existingRoutes: readonly Point[][] = [],
): { from: AnchorChoice; to: AnchorChoice } {
  const padded = obstacles.map(b => expandBox(b, OBSTACLE_PAD))

  const fromCands = anchorCandidates(fromBox)
  const toCands   = anchorCandidates(toBox)

  let bestFrom = fromCands[0]!, bestTo = toCands[0]!
  let bestHits = Infinity, bestScore = Infinity
  for (const fc of fromCands) {
    for (const tc of toCands) {
      const pts = routeBetween(fc.pt, fc.dir, tc.pt, tc.dir, padded, bounds, existingRoutes)
      const hits = polylineHits(pts, padded)
      const score = routeScore(pts, existingRoutes)
      if (hits < bestHits || (hits === bestHits && score < bestScore)) {
        bestHits = hits; bestScore = score; bestFrom = fc; bestTo = tc
      }
    }
  }
  return { from: bestFrom, to: bestTo }
}

/**
 * Builds the final orthogonal route between two already chosen anchors (point +
 * exit/entry direction), padding the obstacles by `OBSTACLE_PAD`. Single source
 * used by `connectionGeometry` (fallback without `existingRoutes`, i.e. ignoring
 * other connections) and by `assignConnectionAnchors` (phase 3, with accumulated
 * `existingRoutes` to minimize crossings).
 */
export function buildRoute(
  from: { pt: Point; dir: Point },
  to: { pt: Point; dir: Point },
  obstacles: readonly BBox[],
  bounds?: BBox,
  existingRoutes: readonly Point[][] = [],
): Point[] {
  const padded = obstacles.map(b => expandBox(b, OBSTACLE_PAD))
  return routeBetween(from.pt, from.dir, to.pt, to.dir, padded, bounds, existingRoutes)
}

/**
 * Builds the best orthogonal polyline between two anchors with their exit/entry
 * directions (`d0`, `d1`). The stroke takes off from `p0` in a straight line
 * along `d0` (stub) and lands on `p1` along `d1`, so the arrow enters/leaves at
 * a right angle to the anchored side. Between the two stubs it tries corridors
 * (L and Z shapes) derived from the obstacle union, fractions of the span, the
 * board edges and, if `existingRoutes` is given, corridors next to the H/V runs
 * of already computed routes (so they can be dodged instead of merely crossed).
 * All interior vertices are clamped to `bounds`. Returns the cheapest route
 * (hits first, then the score with crossing avoidance).
 */
function routeBetween(
  p0: Point, d0: Point,
  p1: Point, d1: Point,
  obstacles: readonly BBox[],
  bounds?: BBox,
  existingRoutes: readonly Point[][] = [],
): Point[] {
  const lo = bounds ? { x: bounds.x, y: bounds.y } : undefined
  const hi = bounds ? { x: bounds.x + bounds.width, y: bounds.y + bounds.height } : undefined
  const clampPt = (p: Point): Point => (lo && hi
    ? { x: Math.max(lo.x, Math.min(hi.x, p.x)), y: Math.max(lo.y, Math.min(hi.y, p.y)) }
    : p)

  // Stubs: the stroke leaves p0 and enters p1 perpendicular to the anchored side.
  const s0: Point = clampPt({ x: p0.x + d0.x * STUB, y: p0.y + d0.y * STUB })
  const s1: Point = clampPt({ x: p1.x + d1.x * STUB, y: p1.y + d1.y * STUB })

  // Union of obstacles -> detour corridors.
  let uminX = Infinity, uminY = Infinity, umaxX = -Infinity, umaxY = -Infinity
  for (const b of obstacles) {
    uminX = Math.min(uminX, b.x); uminY = Math.min(uminY, b.y)
    umaxX = Math.max(umaxX, b.x + b.width); umaxY = Math.max(umaxY, b.y + b.height)
  }
  const hasObstacles = Number.isFinite(uminX)

  const rows: number[] = []
  const cols: number[] = []
  if (hasObstacles) {
    rows.push(uminY - ROUTE_GAP, umaxY + ROUTE_GAP)
    cols.push(uminX - ROUTE_GAP, umaxX + ROUTE_GAP)
  }
  rows.push((s0.y + s1.y) / 2)
  cols.push((s0.x + s1.x) / 2)
  if (lo && hi) {
    rows.push(lo.y + ROUTE_GAP, hi.y - ROUTE_GAP)
    cols.push(lo.x + ROUTE_GAP, hi.x - ROUTE_GAP)
  }

  // Corridors derived from EXISTING routes: a row/column at ±offset from each
  // H/V run of an already computed route, so it can be dodged. Capped at
  // MAX_DERIVED_CORRIDORS to keep the combinatorics bounded.
  let derivedRows = 0, derivedCols = 0
  for (const route of existingRoutes) {
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!, b = route[i + 1]!
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
      if (dy < 0.5 && dx > 0.5 && derivedRows < MAX_DERIVED_CORRIDORS) {
        rows.push(a.y - EXISTING_ROUTE_CORRIDOR_OFFSET, a.y + EXISTING_ROUTE_CORRIDOR_OFFSET)
        derivedRows += 2
      } else if (dx < 0.5 && dy > 0.5 && derivedCols < MAX_DERIVED_CORRIDORS) {
        cols.push(a.x - EXISTING_ROUTE_CORRIDOR_OFFSET, a.x + EXISTING_ROUTE_CORRIDOR_OFFSET)
        derivedCols += 2
      }
    }
  }

  // Sets of INTERIOR vertices (between s0 and s1) of each candidate.
  const inners: Point[][] = []
  // L shapes (one bend).
  inners.push([{ x: s1.x, y: s0.y }])
  inners.push([{ x: s0.x, y: s1.y }])
  // Horizontal Z shapes (intermediate row y = my).
  for (const my of rows) inners.push([{ x: s0.x, y: my }, { x: s1.x, y: my }])
  // Vertical Z shapes (intermediate column x = mx).
  for (const mx of cols) inners.push([{ x: mx, y: s0.y }, { x: mx, y: s1.y }])

  let best: Point[] | undefined
  let bestHits = Infinity
  let bestScore = Infinity
  for (const inner of inners) {
    const pts = simplify([p0, s0, ...inner.map(clampPt), s1, p1])
    const hits = polylineHits(pts, obstacles)
    const score = routeScore(pts, existingRoutes)
    if (hits < bestHits || (hits === bestHits && score < bestScore)) {
      bestHits = hits; bestScore = score; best = pts
    }
  }

  return best ?? simplify([p0, s0, s1, p1])
}

/**
 * Cost of a route: total length + a penalty per bend + a penalty per CROSSING
 * and per px of OVERLAP with already computed routes of other connections.
 */
function routeScore(points: Point[], existingRoutes: readonly Point[][] = []): number {
  let length = 0
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y)
  }
  const bends = Math.max(0, points.length - 2)
  let penalty = length + BEND_PENALTY * bends
  if (existingRoutes.length > 0) {
    penalty += CROSSING_PENALTY * countCrossings(points, existingRoutes)
    penalty += OVERLAP_PENALTY_PER_PX * overlapLength(points, existingRoutes)
  }
  return penalty
}

/** Consecutive segments (vertex pairs) of a polyline. */
function toSegments(points: readonly Point[]): Array<{ a: Point; b: Point }> {
  const out: Array<{ a: Point; b: Point }> = []
  for (let i = 0; i < points.length - 1; i++) out.push({ a: points[i]!, b: points[i + 1]! })
  return out
}

/** Counts H×V crossings between the segments of `points` and those of each route in `existingRoutes`. */
function countCrossings(points: readonly Point[], existingRoutes: readonly Point[][]): number {
  const segs = toSegments(points)
  let count = 0
  for (const route of existingRoutes) {
    const otherSegs = toSegments(route)
    for (const s of segs) {
      for (const o of otherSegs) {
        if (segmentsCrossOrthogonal(s.a, s.b, o.a, o.b)) count++
      }
    }
  }
  return count
}

/** Total px of collinear overlap between the segments of `points` and those of each route in `existingRoutes`. */
function overlapLength(points: readonly Point[], existingRoutes: readonly Point[][]): number {
  const segs = toSegments(points)
  let total = 0
  for (const route of existingRoutes) {
    const otherSegs = toSegments(route)
    for (const s of segs) {
      for (const o of otherSegs) {
        total += segmentOverlap(s.a, s.b, o.a, o.b)
      }
    }
  }
  return total
}

/** Px of collinear overlap between two parallel segments (both H on the same y, or both V on the same x). */
function segmentOverlap(a0: Point, a1: Point, b0: Point, b1: Point): number {
  const TOL = 1
  const aHoriz = Math.abs(a0.y - a1.y) < 0.5
  const aVert = Math.abs(a0.x - a1.x) < 0.5
  const bHoriz = Math.abs(b0.y - b1.y) < 0.5
  const bVert = Math.abs(b0.x - b1.x) < 0.5
  if (aHoriz && bHoriz && Math.abs(a0.y - b0.y) < TOL) {
    const lo1 = Math.min(a0.x, a1.x), hi1 = Math.max(a0.x, a1.x)
    const lo2 = Math.min(b0.x, b1.x), hi2 = Math.max(b0.x, b1.x)
    return Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2))
  }
  if (aVert && bVert && Math.abs(a0.x - b0.x) < TOL) {
    const lo1 = Math.min(a0.y, a1.y), hi1 = Math.max(a0.y, a1.y)
    const lo2 = Math.min(b0.y, b1.y), hi2 = Math.max(b0.y, b1.y)
    return Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2))
  }
  return 0
}

/**
 * Do two ORTHOGONAL segments (one horizontal, one vertical) cross at a point
 * interior to both (not at a shared endpoint)? Exact H×V test, with ~0.5px
 * tolerance so endpoint touches are not counted. If the two segments are
 * parallel (H×H or V×V) it returns false (that is an overlap, see
 * `segmentOverlap`, not a crossing).
 *
 * Exported for tests.
 */
export function segmentsCrossOrthogonal(a0: Point, a1: Point, b0: Point, b1: Point): boolean {
  const TOL = 0.5
  const aHoriz = Math.abs(a0.y - a1.y) < TOL
  const aVert = Math.abs(a0.x - a1.x) < TOL
  const bHoriz = Math.abs(b0.y - b1.y) < TOL
  const bVert = Math.abs(b0.x - b1.x) < TOL

  let h0: Point, h1: Point, v0: Point, v1: Point
  if (aHoriz && bVert) { h0 = a0; h1 = a1; v0 = b0; v1 = b1 }
  else if (aVert && bHoriz) { h0 = b0; h1 = b1; v0 = a0; v1 = a1 }
  else return false

  const hy = h0.y
  const hx0 = Math.min(h0.x, h1.x), hx1 = Math.max(h0.x, h1.x)
  const vx = v0.x
  const vy0 = Math.min(v0.y, v1.y), vy1 = Math.max(v0.y, v1.y)
  return vx > hx0 + TOL && vx < hx1 - TOL && hy > vy0 + TOL && hy < vy1 - TOL
}

/**
 * Cleans a polyline: removes consecutive duplicates and collapses collinear
 * vertices (three points in a line: the middle one is dropped). The result has
 * one vertex per real bend.
 */
function simplify(points: Point[]): Point[] {
  const dd = dedupe(points)
  if (dd.length <= 2) return dd
  const out: Point[] = [dd[0]!]
  for (let i = 1; i < dd.length - 1; i++) {
    const a = out[out.length - 1]!
    const b = dd[i]!
    const c = dd[i + 1]!
    // Are a, b, c collinear? (cross product ≈ 0) -> skip b.
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) > 0.01) out.push(b)
  }
  out.push(dd[dd.length - 1]!)
  return out
}

/** Midpoint (by arc length) of a polyline. */
function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  let half = total / 2
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg >= half) {
      const t = seg === 0 ? 0 : half / seg
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    half -= seg
  }
  return points[points.length - 1]!
}

/** Unit tangent of the polyline at its arc-length midpoint. */
function polylineTangentAtMidpoint(points: Point[]): Point {
  if (points.length < 2) return { x: 1, y: 0 }
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  let half = total / 2
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg >= half && seg > 0) return { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg }
    half -= seg
  }
  const a = points[points.length - 2]!, b = points[points.length - 1]!
  const seg = Math.hypot(b.x - a.x, b.y - a.y)
  return seg === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg }
}

/** Gap (px) between an arrow label text and the stroke. */
export const LABEL_LINE_GAP = 4

/**
 * Top-left corner of the text box of an arrow label, of size `w`×`h`, with no
 * background box: the text is pushed away from the stroke in the perpendicular
 * direction so it is not struck through. A mostly horizontal stroke puts the
 * label above it; a mostly vertical one puts it to the right. Pure.
 */
export function labelBoxOrigin(
  anchor: Point,
  tangent: Point,
  w: number,
  h: number,
): Point {
  if (Math.abs(tangent.x) >= Math.abs(tangent.y)) {
    return { x: anchor.x - w / 2, y: anchor.y - h - LABEL_LINE_GAP }
  }
  return { x: anchor.x + LABEL_LINE_GAP + 2, y: anchor.y - h / 2 }
}

// ── Public helpers (exported for tests) ──────────────────────────────────

/**
 * Whether a point is strictly inside a box (with an inset of BOX_INSET px to
 * avoid false positives on the edges).
 */
export function pointInBox(p: Point, box: BBox): boolean {
  return (
    p.x > box.x + BOX_INSET &&
    p.x < box.x + box.width - BOX_INSET &&
    p.y > box.y + BOX_INSET &&
    p.y < box.y + box.height - BOX_INSET
  )
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Formats a number to 2 decimals for the paths. */
function fmt(n: number): string {
  return n.toFixed(2)
}

/** Grows a box by `pad` px on every side. */
function expandBox(box: BBox, pad: number): BBox {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + 2 * pad,
    height: box.height + 2 * pad,
  }
}

/** Removes consecutive vertices that are practically equal (< 0.5 px). */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) {
      out.push(p)
    }
  }
  return out.length >= 2 ? out : points
}

/** SVG path `M…L…L…` for a polyline. */
function polylinePath(points: Point[]): string {
  const [head, ...rest] = points
  const start = head ?? { x: 0, y: 0 }
  let d = `M ${fmt(start.x)} ${fmt(start.y)}`
  for (const p of rest) d += ` L ${fmt(p.x)} ${fmt(p.y)}`
  return d
}

/**
 * Counts how many sampled points of the polyline fall inside some obstacle.
 * Returns 0 if it is completely clear.
 */
function polylineHits(points: Point[], boxes: readonly BBox[]): number {
  let hits = 0
  for (let s = 0; s < points.length - 1; s++) {
    const p0 = points[s]!
    const p1 = points[s + 1]!
    for (let i = 0; i <= SEGMENT_SAMPLES; i++) {
      const t = i / SEGMENT_SAMPLES
      const p: Point = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
      for (const box of boxes) {
        if (pointInBox(p, box)) { hits++; break }
      }
    }
  }
  return hits
}

/** Normalized direction from A to B. */
function dirFrom(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/**
 * Builds the SVG path of the arrowhead triangle.
 *
 * @param tip   Tip of the arrow.
 * @param dir   Arrival direction (normalized, towards the tip).
 */
function arrowPath(tip: Point, dir: Point): string {
  // left wing (rotation +ARROW_ANGLE)
  const cos = Math.cos(Math.PI - ARROW_ANGLE)
  const sin = Math.sin(ARROW_ANGLE)
  const lx = tip.x + ARROW_SIZE * (dir.x * cos - dir.y * sin)
  const ly = tip.y + ARROW_SIZE * (dir.x * sin + dir.y * cos)

  // right wing (rotation -ARROW_ANGLE)
  const cos2 = Math.cos(Math.PI + ARROW_ANGLE)
  const sin2 = Math.sin(-ARROW_ANGLE)
  const rx = tip.x + ARROW_SIZE * (dir.x * cos2 - dir.y * sin2)
  const ry = tip.y + ARROW_SIZE * (dir.x * sin2 + dir.y * cos2)

  return `M ${fmt(lx)} ${fmt(ly)} L ${fmt(tip.x)} ${fmt(tip.y)} L ${fmt(rx)} ${fmt(ry)}`
}

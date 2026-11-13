/**
 * Tests for the bansho geometry (quantized slots): a grid of 6 units per row.
 *
 * Verifies:
 * - Opening strip / title.
 * - Quantum per block type: loose text=6, real group=3 (scales to 6),
 *   singleton loose figure=2.
 * - "Last one stretches" rule when the row remainder is < QUANTUM_FIGURE.
 * - Figures centered in their slot; text left-aligned in the content.
 * - Group subtitle stretched exactly to the slot's contentW.
 * - Vertical rules 1a/1b/1c (atomic group, wrap to the next area, atomic
 *   overflow with an X-only clamp).
 * - Invariants: no overlap, determinism, stability (appending never moves
 *   what is placed), stable quantum when a group grows.
 *
 * KEY ARITHMETIC: with the slot grid, the gaps between blocks live INSIDE the
 * slot (BLOCK_GAP_X/2 on each side), not between pixel cursors. A TEXT member
 * in the first slot of a row therefore starts at
 * `area.box.x + AREA_INSET + BLOCK_GAP_X/2`, not at `area.box.x + AREA_INSET`.
 * The `area1ItemX` / `areaNItemX` helpers in this file return the SLOT edge
 * (unit 0), not the final text x; use `textStartX(...)` for the final x of a
 * text member in unit 0.
 *
 * With defaultAreaTree(3) on a 1200x800 canvas and bodyRect from y=48:
 *   area_1: x=24,  y=48, width=384;  unitW = (384-16)/6 = about 61.333
 *   area_2: x=408, y=48, width=384
 *   area_3: x=792, y=48, width=384
 */
import { describe, it, expect } from 'vitest'
import type { BoardPlan, BoardItem } from './bansho-board.js'
import { planBoard } from './bansho-board.js'
import type { BBox, Size } from './bbox.js'

/** True when the boxes, each expanded by margin/2, intersect. */
function collides(a: BBox, b: BBox, margin: number): boolean {
  const half = margin / 2
  return !(
    a.x + a.width + half <= b.x - half || b.x + b.width + half <= a.x - half ||
    a.y + a.height + half <= b.y - half || b.y + b.height + half <= a.y - half
  )
}
import {
  layoutPlan,
  computeBodyRect,
  AREA_INSET,
  WITHIN_GROUP_GAP,
  GROUP_GAP,
  BLOCK_GAP_X,
  BLOCK_GAP_Y,
  TITLE_BAND_HEIGHT,
  DATE_RESERVE,
  SLOTS_PER_ROW,
  QUANTUM_TEXT,
  QUANTUM_GROUP,
  QUANTUM_FIGURE,
  CONCEPT_ARROW_GAP,
} from './bansho-geometry.js'
import type { AreaTree } from './areas.js'
import { defaultAreaTree, computeAreaRects, fillOrder } from './areas.js'
import { estimateTextSize } from '@/scene/text-measure.js'

const CANVAS = { width: 1200, height: 800 }
const MARGIN = 24

/** Width of each area with defaultAreaTree(3) on this CANVAS (see header). */
const AREA_WIDTH = 384
/** unitW of a 6-slot row in an area of AREA_WIDTH (float, unrounded). */
const UNIT_W = (AREA_WIDTH - 2 * AREA_INSET) / SLOTS_PER_ROW

/** Construye dimsById a partir de tuplas [id, w, h]. */
function dimsOf(...rows: Array<[string, number, number]>): Map<string, Size> {
  const m = new Map<string, Size>()
  for (const [id, width, height] of rows) m.set(id, { width, height })
  return m
}

/**
 * Adapter: turns a Map<string, Size> into layoutPlan's measuring callback.
 * Ignores contentWidth (fixed dims). Useful for tests that need no re-measuring.
 */
function measureFromDims(dims: Map<string, Size>): (id: string, contentWidth: number) => Size {
  return (id: string, _contentWidth: number): Size => dims.get(id) ?? { width: 0, height: 0 }
}

/** x of the SLOT edge at unit 0 of area_1 (not the final x of a text member). */
function area1ItemX(): number {
  return MARGIN + AREA_INSET
}

/** x of the SLOT edge at unit 0 of area N (0-indexed) with defaultAreaTree(3). */
function areaNItemX(canvas: { width: number }, n: number): number {
  const bodyRect = { x: MARGIN, y: 0, width: canvas.width - 2 * MARGIN, height: 800 }
  const areas = fillOrder(computeAreaRects(defaultAreaTree(3), bodyRect))
  return areas[n]!.box.x + AREA_INSET
}

/** Final x of a TEXT member that starts at the slot whose edge is `slotEdgeX`. */
function textStartX(slotEdgeX: number): number {
  return Math.round(slotEdgeX + BLOCK_GAP_X / 2)
}

/** contentW (px) of a slot of `q` units given a unitW. */
function slotContentW(unitW: number, q: number): number {
  return Math.round(q * unitW - BLOCK_GAP_X)
}

describe('bansho-geometry — title block', () => {
  it('title: x = MARGIN, width = the one MEASURED by measure (natural width)', () => {
    const plan: BoardPlan = { title: ['h1'], opening: [], blocks: [] }
    const dims = dimsOf(['h1', 400, 50])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const h1 = placed.get('h1')!
    expect(h1.x).toBe(MARGIN)
    expect(h1.width).toBe(400)
    expect(h1.width).toBeLessThan(CANVAS.width - 2 * MARGIN)
    expect(h1.y).toBe(MARGIN)
    expect(h1.height).toBe(50)
  })

  it('title: dims.width greater than the canvas is clamped to x=0 (defensive clampToCanvas)', () => {
    const plan: BoardPlan = { title: ['h1'], opening: [], blocks: [] }
    const dims = dimsOf(['h1', CANVAS.width + 200, 50])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const h1 = placed.get('h1')!
    expect(h1.x).toBe(0)
    expect(h1.y).toBe(MARGIN)
  })

  it('title with the REAL measurer: natural width < canvas.width - 2*MARGIN for a short title, x=MARGIN', () => {
    const plan: BoardPlan = { title: ['h1'], opening: [], blocks: [] }
    const measure = (_id: string, contentWidth: number): Size =>
      estimateTextSize('El agua', contentWidth, 'titulo')
    const placed = layoutPlan(plan, measure, CANVAS)
    const h1 = placed.get('h1')!
    expect(h1.x).toBe(MARGIN)
    expect(h1.width).toBeLessThan(CANVAS.width - 2 * MARGIN)
  })

  it('maximum auto-fit width of the title excludes DATE_RESERVE (leaves room for the date)', () => {
    const plan: BoardPlan = { title: ['h1'], opening: [], blocks: [] }
    let receivedContentWidth = -1
    const measure = (_id: string, contentWidth: number): Size => {
      receivedContentWidth = contentWidth
      return { width: 100, height: 50 }
    }
    layoutPlan(plan, measure, CANVAS)
    expect(receivedContentWidth).toBe(CANVAS.width - 2 * MARGIN - DATE_RESERVE)
  })

  it('with a title: the body (opening included) starts below the title band', () => {
    const plan: BoardPlan = { title: ['h1'], opening: ['ap1'], blocks: [] }
    const dims = dimsOf(['h1', 400, 50], ['ap1', 200, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const ap1 = placed.get('ap1')!
    expect(ap1.y).toBe(MARGIN + TITLE_BAND_HEIGHT + MARGIN)
    expect(ap1.x).toBe(textStartX(area1ItemX()))
    expect(ap1.width).toBe(200)
  })

  it('without a title: the band stays reserved and the body (opening included) starts below it', () => {
    const plan: BoardPlan = { title: [], opening: ['ap1'], blocks: [] }
    const dims = dimsOf(['ap1', 200, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    expect(placed.get('ap1')!.y).toBe(MARGIN + TITLE_BAND_HEIGHT + MARGIN)
    expect(placed.get('ap1')!.x).toBe(textStartX(area1ItemX()))
  })
})

describe('bansho-geometry — opening / basic body', () => {
  it('the opening flows as the first (ungrouped) block of the body in area 1: text takes the whole slot (6 units)', () => {
    const plan: BoardPlan = { title: [], opening: ['apA', 'apB'], blocks: [] }
    const dims = dimsOf(['apA', 200, 40], ['apB', 200, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)

    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const itemX = textStartX(area1ItemX())
    expect(placed.get('apA')).toEqual({ x: itemX, y: bodyTop, width: 200, height: 40 })
    expect(placed.get('apB')).toEqual({ x: itemX, y: bodyTop + 40 + GROUP_GAP, width: 200, height: 40 })
  })

  it('without an opening strip the body starts under the reserved band (MARGIN + TITLE_BAND_HEIGHT + MARGIN), x = textStartX(area_1)', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['a0'], memberRoles: ['cuerpo'] }] }
    const dims = dimsOf(['a0', 150, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    expect(placed.get('a0')).toEqual({ x: textStartX(area1ItemX()), y: MARGIN + TITLE_BAND_HEIGHT + MARGIN, width: 150, height: 40 })
  })

  it('a single group block: all its members stacked at the same x (WITHIN_GROUP_GAP)', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g0', members: ['a0', 'a1'], memberRoles: ['cuerpo', 'cuerpo'] }] }
    const dims = dimsOf(['a0', 50, 40], ['a1', 50, 60])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)

    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const itemX = textStartX(area1ItemX())

    expect(placed.get('a0')).toEqual({ x: itemX, y: bodyTop, width: 50, height: 40 })
    expect(placed.get('a1')).toEqual({ x: itemX, y: bodyTop + 40 + WITHIN_GROUP_GAP, width: 50, height: 60 })
  })
})

// ── Quantum per block type ──────────────────────────────────────────────────────

describe('bansho-geometry — quantum per block type', () => {
  it('(1) loose text (ungrouped block) takes the WHOLE slot: measure receives contentW = 6*unitW - BLOCK_GAP_X', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['a0'], memberRoles: ['cuerpo'] }] }
    let capturedW = -1
    const measure = (_id: string, contentWidth: number): Size => {
      capturedW = contentWidth
      return { width: 100, height: 40 }
    }
    const placed = layoutPlan(plan, measure, CANVAS)
    expect(capturedW).toBe(slotContentW(UNIT_W, QUANTUM_TEXT))
    const a0 = placed.get('a0')!
    expect(a0.x).toBe(textStartX(area1ItemX()))
  })

  it('(2) a real group takes 3 units by default: two narrow groups share a row', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] },
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] },
      ],
    }
    // Small natural widths (< contentW of 3 units) -> the quantum stays at 3.
    const dims = dimsOf(['a0', 50, 40], ['b0', 50, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const a0 = placed.get('a0')!
    const b0 = placed.get('b0')!

    expect(a0.x).toBe(textStartX(area1ItemX()))
    expect(b0.y).toBe(a0.y) // same row: both 3-unit slots fit in 6
    expect(b0.x).toBe(textStartX(area1ItemX() + QUANTUM_GROUP * UNIT_W))
  })

  it('(3) a real group scales to 6 units if the natural width of members[0] exceeds the contentW of the 3-unit slot', () => {
    const contentW3 = slotContentW(UNIT_W, QUANTUM_GROUP)
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] },
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] },
      ],
    }
    // a0 wider than contentW3 -> its block scales to quantum 6 (whole row):
    // b0 cannot share the row and falls into a new row.
    const dims = dimsOf(['a0', contentW3 + 50, 40], ['b0', 30, 20])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const a0 = placed.get('a0')!
    const b0 = placed.get('b0')!

    expect(a0.x).toBe(textStartX(area1ItemX()))
    expect(b0.y).toBeGreaterThan(a0.y)
    expect(b0.x).toBe(textStartX(area1ItemX())) // restarts at the column edge
  })

  it('(4) a singleton loose figure takes 2 units: THREE figures share a row, the FOURTH drops down', () => {
    const items: BoardItem[] = [
      { id: 'f1', isText: false, group: null, role: null },
      { id: 'f2', isText: false, group: null, role: null },
      { id: 'f3', isText: false, group: null, role: null },
      { id: 'f4', isText: false, group: null, role: null },
    ]
    const plan = planBoard(items)
    const measure = (_id: string, _w: number): Size => ({ width: 120, height: 120 })
    const placed = layoutPlan(plan, measure, CANVAS)

    const f1 = placed.get('f1')!
    const f2 = placed.get('f2')!
    const f3 = placed.get('f3')!
    const f4 = placed.get('f4')!

    expect(f2.y).toBe(f1.y)
    expect(f3.y).toBe(f1.y)
    expect(f4.y).toBeGreaterThan(f1.y)
    expect(f2.x).toBeGreaterThan(f1.x)
    expect(f3.x).toBeGreaterThan(f2.x)
    expect(collides(f1, f2, 0)).toBe(false)
    expect(collides(f2, f3, 0)).toBe(false)
  })
})

// ── "Last one stretches" rule ────────────────────────────────────────────────────

describe('bansho-geometry — "last one stretches" rule', () => {
  it('(5) figure(2 units) + group(3 units): the row remainder (1 unit, < QUANTUM_FIGURE) is absorbed by the group -> 4 units', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: null, members: ['fig1'], memberRoles: [null] },
        { key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] },
      ],
    }
    let lastContentWA0 = -1
    const measure = (id: string, contentW: number): Size => {
      if (id === 'fig1') return { width: 120, height: 120 }
      lastContentWA0 = contentW
      return { width: 50, height: 40 }
    }
    const placed = layoutPlan(plan, measure, CANVAS)
    const fig1 = placed.get('fig1')!
    const a0 = placed.get('a0')!

    expect(a0.y).toBe(fig1.y) // same row
    // The group ended up with contentW of 4 units (2+3=5, remainder=1 < QUANTUM_FIGURE -> absorbs up to 6-2=4).
    expect(lastContentWA0).toBe(slotContentW(UNIT_W, 4))
  })

  it('without "last one stretches": three figures (2+2+2=6) leave NO remainder, nothing stretches', () => {
    const items: BoardItem[] = [
      { id: 'f1', isText: false, group: null, role: null },
      { id: 'f2', isText: false, group: null, role: null },
      { id: 'f3', isText: false, group: null, role: null },
    ]
    const plan = planBoard(items)
    const measure = (_id: string, _w: number): Size => ({ width: 100, height: 100 })
    const placed = layoutPlan(plan, measure, CANVAS)
    const f1 = placed.get('f1')!
    const f2 = placed.get('f2')!
    const f3 = placed.get('f3')!
    expect(f1.y).toBe(f2.y)
    expect(f2.y).toBe(f3.y)
  })
})

// ── Figures: centered in their slot ─────────────────────────────────────────────

describe('bansho-geometry — figures centered in their slot', () => {
  it('(6) a figure narrower than its slot is centered horizontally inside the whole SLOT (not just the contentW)', () => {
    const items: BoardItem[] = [{ id: 'fig1', isText: false, group: null, role: null }]
    const plan = planBoard(items)
    const measure = (_id: string, _w: number): Size => ({ width: 80, height: 80 })
    const placed = layoutPlan(plan, measure, CANVAS)
    const fig1 = placed.get('fig1')!

    const slotW = QUANTUM_FIGURE * UNIT_W
    const expectedX = Math.round(area1ItemX() + (slotW - 80) / 2)
    expect(fig1.x).toBe(expectedX)
  })
})

// ── Subtitle stretched to the slot's contentW ───────────────────────────────────

describe('bansho-geometry — subtitle stretched exactly to the slot contentW', () => {
  it('(7) the subtitle of a GROUP block is stretched exactly to the contentW of the already decided slot (not to the max of natural widths)', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{ key: 'g0', members: ['sub1', 'cuerpo1'], memberRoles: ['subtitulo', 'cuerpo'] }],
    }
    // short sub1 (60px, decides quantum=3 because it is members[0]); wider cuerpo1 (100px, does not decide the quantum).
    const dims = dimsOf(['sub1', 60, 30], ['cuerpo1', 100, 60])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)

    const sub1 = placed.get('sub1')!
    const expectedContentW3 = slotContentW(UNIT_W, QUANTUM_GROUP)
    expect(sub1.width).toBe(expectedContentW3)
    expect(sub1.height).toBe(30) // the measured height is untouched, only the width
  })

  it('a subtitle WITHOUT a group (narrative block, key=null) is not stretched: keeps its natural width', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{ key: null, members: ['sub_1', 'cuerpo_1'], memberRoles: ['subtitulo', 'cuerpo'] }],
    }
    const dims = dimsOf(['sub_1', 80, 30], ['cuerpo_1', 300, 60])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const sub = placed.get('sub_1')!
    expect(sub.width).toBe(80)
  })

  it('a group block with no subtitulo member: nothing stretches', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{ key: 'g0', members: ['a_1', 'b_1'], memberRoles: ['cuerpo', 'cuerpo'] }],
    }
    const dims = dimsOf(['a_1', 40, 30], ['b_1', 60, 60])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    expect(placed.get('a_1')!.width).toBe(40)
    expect(placed.get('b_1')!.width).toBe(60)
  })

  it('BoardBlock without memberRoles (compatibility): does not fail, stretches nothing, is not classified as a figure', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{ key: 'g0', members: ['a_1', 'b_1'] } as unknown as BoardPlan['blocks'][number]],
    }
    const dims = dimsOf(['a_1', 40, 30], ['b_1', 60, 60])
    expect(() => layoutPlan(plan, measureFromDims(dims), CANVAS)).not.toThrow()
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    expect(placed.get('a_1')!.width).toBe(40)
  })
})

// ── Invariants: no overlap / determinism ────────────────────────────────────────

describe('bansho-geometry — slot grid invariants', () => {
  it('(8) no-overlap invariant: no pair of placed blocks overlaps (mix of loose text, group and figures)', () => {
    const items: BoardItem[] = [
      { id: 't1', isText: true, group: null, role: 'cuerpo' },
      { id: 'f1', isText: false, group: null, role: null },
      { id: 'a0', isText: true, group: 'g0', role: 'cuerpo' },
      { id: 'f2', isText: false, group: null, role: null },
      { id: 'b0', isText: true, group: 'g1', role: 'cuerpo' },
    ]
    const plan = planBoard(items)
    const measure = (id: string, contentW: number): Size => {
      if (id === 'f1' || id === 'f2') return { width: 120, height: 120 }
      return { width: Math.min(contentW, 90), height: 40 }
    }
    const placed = layoutPlan(plan, measure, CANVAS)
    const boxes = [...placed.values()]
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(collides(boxes[i]!, boxes[j]!, 0)).toBe(false)
      }
    }
  })

  it('(9) determinism: the same input produces the same boxes (slot grid)', () => {
    const items: BoardItem[] = [
      { id: 't1', isText: true, group: null, role: 'cuerpo' },
      { id: 'f1', isText: false, group: null, role: null },
      { id: 'a0', isText: true, group: 'g0', role: 'cuerpo' },
      { id: 'a1', isText: true, group: 'g0', role: 'cuerpo' },
      { id: 'f2', isText: false, group: null, role: null },
    ]
    const plan = planBoard(items)
    const measure = (id: string, contentW: number): Size => {
      if (id === 'f1' || id === 'f2') return { width: 120, height: 120 }
      return { width: Math.min(contentW, 90), height: 40 }
    }
    const placed1 = layoutPlan(plan, measure, CANVAS)
    const placed2 = layoutPlan(plan, measure, CANVAS)
    expect([...placed1.entries()]).toEqual([...placed2.entries()])
  })
})

// ── Stability and stable quantum under growth ───────────────────────────────────

describe('bansho-geometry — stability and stable quantum', () => {
  it('(10) stability: appending a NEW block at the end does not move the ones already placed', () => {
    const dims = dimsOf(['a0', 50, 40], ['b0', 50, 40])
    const plan1: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] }] }
    const placed1 = layoutPlan(plan1, measureFromDims(dims), CANVAS)

    const plan2: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] },
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] },
      ],
    }
    const placed2 = layoutPlan(plan2, measureFromDims(dims), CANVAS)

    expect(placed2.get('a0')).toEqual(placed1.get('a0'))
  })

  it('STABILITY: adding an item to a single-group block does not move the earlier ones', () => {
    const dims = dimsOf(['titulo', 200, 40], ['a0', 50, 40], ['a1', 50, 40], ['a2', 50, 40])

    const plan1: BoardPlan = { title: [], opening: ['titulo'], blocks: [{ key: 'g0', members: ['a0', 'a1'], memberRoles: ['cuerpo', 'cuerpo'] }] }
    const placed1 = layoutPlan(plan1, measureFromDims(dims), CANVAS)

    const plan2: BoardPlan = { title: [], opening: ['titulo'], blocks: [{ key: 'g0', members: ['a0', 'a1', 'a2'], memberRoles: ['cuerpo', 'cuerpo', 'cuerpo'] }] }
    const placed2 = layoutPlan(plan2, measureFromDims(dims), CANVAS)

    expect(placed2.get('titulo')).toEqual(placed1.get('titulo'))
    expect(placed2.get('a0')).toEqual(placed1.get('a0'))
    expect(placed2.get('a1')).toEqual(placed1.get('a1'))
    const a1 = placed1.get('a1')!
    expect(placed2.get('a2')).toEqual({ x: a1.x, y: a1.y + a1.height + WITHIN_GROUP_GAP, width: 50, height: 40 })
  })

  it('(11) stable quantum: adding a wider member to a 3-unit group does not change its quantum (it wraps, it does not resize)', () => {
    const plan1: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] }] }
    const measure1 = (_id: string, contentW: number): Size => ({ width: Math.min(50, contentW), height: 40 })
    const placed1 = layoutPlan(plan1, measure1, CANVAS)
    const a0Before = placed1.get('a0')!

    const plan2: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g0', members: ['a0', 'a1'], memberRoles: ['cuerpo', 'cuerpo'] }] }
    const measure2 = (id: string, contentW: number): Size =>
      id === 'a0' ? { width: Math.min(50, contentW), height: 40 } : { width: Math.min(400, contentW), height: 200 }
    const placed2 = layoutPlan(plan2, measure2, CANVAS)
    const a0After = placed2.get('a0')!
    const a1After = placed2.get('a1')!

    // a0 (members[0], decides the quantum) neither moves nor changes width.
    expect(a0After.x).toBe(a0Before.x)
    expect(a0After.width).toBe(a0Before.width)

    // a1, much wider naturally, is CAPPED at the contentW of the 3-unit slot:
    // the group did not resize to 6 to fit it (it wraps in height).
    expect(a1After.width).toBe(slotContentW(UNIT_W, QUANTUM_GROUP))
  })
})

// ── Vertical rules: atomic group 1a/1b/1c ───────────────────────────────────────

describe('bansho-geometry — vertical rules (1a/1b/1c)', () => {
  it('1a: a block that starts inside the area is placed there and overflows at the bottom (soft limit)', () => {
    const TALL_CANVAS = { width: 1200, height: 1400 }
    const contentW3 = slotContentW(UNIT_W, QUANTUM_GROUP)
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0', 'a1'], memberRoles: ['cuerpo', 'cuerpo'] },
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] },
      ],
    }
    // Widths that force quantum=6 (whole row) in both blocks -> 1 per row.
    const dims = dimsOf(['a0', contentW3 + 50, 230], ['a1', contentW3 + 50, 230], ['b0', contentW3 + 50, 310])
    const placed = layoutPlan(plan, measureFromDims(dims), TALL_CANVAS)

    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const itemX = textStartX(area1ItemX())

    expect(placed.get('a0')!.x).toBe(itemX)
    expect(placed.get('a0')!.y).toBe(bodyTop)
    expect(placed.get('a1')!.y).toBe(bodyTop + 230 + WITHIN_GROUP_GAP)
    // g1 stays in area 1, in a new row below g0, overflowing the bottom of the AREA
    // but not overflowing the CANVAS (TALL_CANVAS).
    const blockHeightG0 = 230 + 230 + WITHIN_GROUP_GAP
    expect(placed.get('b0')!.x).toBe(itemX)
    expect(placed.get('b0')!.y).toBe(bodyTop + blockHeightG0 + BLOCK_GAP_Y)
  })

  it('1b: atomic group — the second block does not fit from the new row of the SAME column -> it moves WHOLE to the next area', () => {
    const contentW3 = slotContentW(UNIT_W, QUANTUM_GROUP)
    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0', 'a1', 'a2'], memberRoles: ['cuerpo', 'cuerpo', 'cuerpo'] },
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] },
        { key: 'g2', members: ['c0'], memberRoles: ['cuerpo'] },
      ],
    }
    const wide = contentW3 + 50
    const dims = dimsOf(['a0', wide, 200], ['a1', wide, 200], ['a2', wide, 200], ['b0', wide, 120], ['c0', wide, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)

    const area2X = areaNItemX(CANVAS, 1)
    const b0 = placed.get('b0')!
    const c0 = placed.get('c0')!

    expect(placed.get('a0')!.y).toBe(bodyTop)
    // b0: atomic group moved WHOLE to area 2 (it did not fit from the new row of area 1).
    expect(b0.x).toBe(textStartX(area2X))
    // c0: fits in the new row of area 2 after b0 (does not need to jump to area 3).
    expect(c0.x).toBe(textStartX(area2X))
    expect(c0.y).toBeGreaterThan(b0.y)
  })

  it('1c/1d: with no next column (last area) the block overflows downward as a unit (X-only clamp)', () => {
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{ key: 'g0', members: ['a0', 'a1', 'a2', 'a3', 'a4'], memberRoles: ['cuerpo', 'cuerpo', 'cuerpo', 'cuerpo', 'cuerpo'] }],
    }
    // 5 members of 200: blockHeight = 5*200 + 4*(-8) = 968 > area(728) and > canvas(800)
    // -> it does not even fit in an empty column -> placed whole in area 1 and overflows.
    const dims = dimsOf(['a0', 50, 200], ['a1', 50, 200], ['a2', 50, 200], ['a3', 50, 200], ['a4', 50, 200])
    // A single area: there is no next column to continue into.
    const oneArea: AreaTree = { kind: 'leaf', id: 'area_1' }
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS, oneArea)

    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const itemX = MARGIN + AREA_INSET + BLOCK_GAP_X / 2

    expect(placed.get('a0')).toEqual({ x: itemX, y: bodyTop, width: 50, height: 200 })
    expect(placed.get('a4')!.x).toBe(itemX)
    const a4 = placed.get('a4')!
    expect(a4.y + a4.height).toBeGreaterThan(CANVAS.height)
  })

  it('(12) rule 1b: a block moved WHOLE to the next area is re-measured at that area unitW (areas of different width)', () => {
    // Area tree with DIFFERENT widths (30%/70%) so the re-measuring at the
    // new area is observable in the contentWidth passed to measure.
    const customTree: AreaTree = {
      kind: 'split',
      id: 'split_1',
      dir: 'v',
      ratio: 0.3,
      a: { kind: 'leaf', id: 'area_1' },
      b: { kind: 'leaf', id: 'area_2' },
    }
    const bodyRect = computeBodyRect(CANVAS, false)
    const areas = fillOrder(computeAreaRects(customTree, bodyRect))
    const area2 = areas[1]!

    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [
        { key: 'g0', members: ['a0'], memberRoles: ['cuerpo'] }, // fills almost all of area 1 in height
        { key: 'g1', members: ['b0'], memberRoles: ['cuerpo'] }, // does not fit from the new row -> moves to area 2
      ],
    }
    const contentWidthsForB0: number[] = []
    const measure = (id: string, contentW: number): Size => {
      if (id === 'a0') return { width: 300, height: 700 } // width > contentW3 of area 1 -> quantum 6, own row
      contentWidthsForB0.push(contentW)
      return { width: 300, height: 120 }
    }
    const placed = layoutPlan(plan, measure, CANVAS, customTree)
    const b0 = placed.get('b0')!

    // b0 was placed in area 2, at the top.
    expect(b0.x).toBeGreaterThanOrEqual(area2.box.x)
    expect(b0.y).toBe(area2.box.y)
    // The re-measuring used the CONTENT width of area 2 (not that of area 1) at
    // least once (the quantum probe, measure(members[0], areaContentW)).
    const area2ContentW = area2.box.width - 2 * AREA_INSET
    expect(contentWidthsForB0).toContain(area2ContentW)
  })

  it('(13) rule 1c: an atomic block that exceeds the canvas overflows as a unit, X-only clamp', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['a0', 'a1'], memberRoles: ['cuerpo', 'cuerpo'] }] }
    const dims = dimsOf(['a0', 150, 700], ['a1', 150, 200])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const a0 = placed.get('a0')!
    const a1 = placed.get('a1')!
    const bodyTop = MARGIN + TITLE_BAND_HEIGHT + MARGIN
    const itemX = textStartX(area1ItemX())

    expect(a0).toEqual({ x: itemX, y: bodyTop, width: 150, height: 700 })
    expect(a1).toEqual({ x: itemX, y: bodyTop + 700 + GROUP_GAP, width: 150, height: 200 })
    expect(a1.y + a1.height).toBeGreaterThan(CANVAS.height)
    expect(collides(a0, a1, 0)).toBe(false)
  })
})

// ── Generic area flow, re-measuring at the area width ───────────────────────────

describe('bansho-geometry — area flow', () => {
  it('with defaultAreaTree(3): body blocks land inside the slot of area.box.x + AREA_INSET', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['a0'], memberRoles: ['cuerpo'] }] }
    const dims = dimsOf(['a0', 100, 40])
    const placed = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const a0 = placed.get('a0')!
    expect(a0.x).toBe(textStartX(MARGIN + AREA_INSET))
  })

  it('text re-measured at the area width: the callback of an ungrouped block receives contentW = 6*unitW - BLOCK_GAP_X', () => {
    const capturedWidths: number[] = []
    const measureCapture = (_id: string, contentWidth: number): Size => {
      capturedWidths.push(contentWidth)
      return { width: 100, height: 40 }
    }
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['a0'], memberRoles: ['cuerpo'] }] }
    layoutPlan(plan, measureCapture, CANVAS)
    expect(capturedWidths).toContain(slotContentW(UNIT_W, QUANTUM_TEXT))
  })

  it('text in a narrow area wraps more (greater height) than in a wide area', () => {
    let lastContentWidth = 0
    const measureWidthSensitive = (_id: string, contentWidth: number): Size => {
      lastContentWidth = contentWidth
      return { width: Math.min(contentWidth, 100), height: 40 }
    }
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: null, members: ['txt'], memberRoles: ['cuerpo'] }] }

    layoutPlan(plan, measureWidthSensitive, CANVAS)
    const widthWith3cols = lastContentWidth

    const singleAreaTree: AreaTree = { kind: 'leaf', id: 'area_1' }
    layoutPlan(plan, measureWidthSensitive, CANVAS, singleAreaTree)
    const widthWith1area = lastContentWidth

    expect(widthWith3cols).toBeLessThan(widthWith1area)
    expect(widthWith3cols).toBe(slotContentW(UNIT_W, QUANTUM_TEXT))
    const singleAreaUnitW = (1152 - 2 * AREA_INSET) / SLOTS_PER_ROW
    expect(widthWith1area).toBe(slotContentW(singleAreaUnitW, QUANTUM_TEXT))
  })
})

// ── planBoard + layoutPlan end-to-end: loose figures in a row ───────────────────

describe('planBoard + layoutPlan — loose figures flow in a row, not stacked', () => {
  it('two consecutive loose figures end up SIDE BY SIDE (same row): y about equal, x increasing', () => {
    // explicit role: null (as src/scene/apply.ts does for non-text objects):
    // it is the signal layoutPlan uses to recognize a singleton loose figure
    // (see the header comment of bansho-geometry.ts).
    const items: BoardItem[] = [
      { id: 'fig_1', isText: false, group: null, role: null },
      { id: 'fig_2', isText: false, group: null, role: null },
    ]
    const plan = planBoard(items)

    const measure = (_id: string, _contentWidth: number): Size => ({ width: 120, height: 120 })
    const placed = layoutPlan(plan, measure, CANVAS)

    const fig1 = placed.get('fig_1')!
    const fig2 = placed.get('fig_2')!

    expect(fig2.y).toBe(fig1.y)
    expect(fig2.x).toBeGreaterThan(fig1.x)
  })
})

describe('layoutPlan — `near` fallback: loose figure next to its target', () => {
  const FIG = 120
  const measure = (id: string, _w: number): Size =>
    id.startsWith('fig') ? { width: FIG, height: FIG } : { width: 150, height: 40 }
  const txtItem = (id: string, group: string | null): BoardItem => ({ id, isText: true, group, role: 'cuerpo' })
  const figItem = (id: string, nearId?: string): BoardItem => ({
    id, isText: false, group: null, role: null, ...(nearId ? { nearId } : {}),
  })
  const inter = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  const dist = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2)

  it('(a) with room in the target row: the figure lands next to its group and nothing moves', () => {
    const base = [txtItem('a_1', 'gA'), txtItem('a_2', 'gA')]
    const before = layoutPlan(planBoard(base), measure, CANVAS)
    const after = layoutPlan(planBoard([...base, figItem('fig_1', 'a_2')]), measure, CANVAS)
    for (const [id, b] of before) expect(after.get(id)).toEqual(b)
    const f = after.get('fig_1')!
    expect(f.y).toBe(before.get('a_1')!.y) // same row as the group
    expect(f.x).toBeGreaterThan(before.get('a_2')!.x + before.get('a_2')!.width - 1)
    for (const b of before.values()) expect(inter(f, b)).toBe(false)
  })

  it('(b) no vertical room in the target area: goes to the adjacent one, closer than by flow', () => {
    // gA fills column 0 down to the bottom (20 members of 40px) and quantum 6 (large natural width).
    const big = (id: string, _w: number): Size => (id.startsWith('fig') ? { width: FIG, height: FIG } : { width: 330, height: 40 })
    const base: BoardItem[] = []
    for (let i = 1; i <= 17; i++) base.push(txtItem(`a_${i}`, 'gA'))
    const flow = layoutPlan(planBoard([...base, figItem('fig_1')]), big, CANVAS)
    const near = layoutPlan(planBoard([...base, figItem('fig_1', 'a_17')]), big, CANVAS)
    for (const [id] of flow) if (id !== 'fig_1') expect(near.get(id)).toEqual(flow.get(id))
    const f = near.get('fig_1')!
    const d = near.get('a_17')!
    expect(dist(f, d)).toBeLessThanOrEqual(dist(flow.get('fig_1')!, d))
    for (const [id, b] of near) if (id !== 'fig_1') expect(inter(f, b)).toBe(false)
    expect(f.y + f.height).toBeLessThanOrEqual(CANVAS.height)
  })

  it('the block that arrives later flows after the figure without overlapping it', () => {
    const items = [txtItem('a_1', 'gA'), figItem('fig_1', 'a_1'), txtItem('b_1', 'gB'), txtItem('b_2', 'gB')]
    const placed = layoutPlan(planBoard(items), measure, CANVAS)
    const f = placed.get('fig_1')!
    for (const [id, b] of placed) if (id !== 'fig_1') expect(inter(f, b)).toBe(false)
  })

  it('target not placed (nonexistent): falls back to the normal loose-figure flow', () => {
    const a = layoutPlan(planBoard([txtItem('a_1', 'gA'), figItem('fig_1', 'nadie')]), measure, CANVAS)
    const b = layoutPlan(planBoard([txtItem('a_1', 'gA'), figItem('fig_1')]), measure, CANVAS)
    expect(a).toEqual(b)
  })
})

// ── A paragraph grows to the right before growing downward ──────────────────────

describe('bansho-geometry — widening the group to the right', () => {
  const LONG = 'The water rises as vapor and then it cools down high in the sky until it forms little clouds that drift over the land.'
  const texts: Record<string, { text: string; role: 'subtitulo' | 'cuerpo' }> = {}
  const measure = (id: string, w: number): Size => {
    const t = texts[id]!
    return estimateTextSize(t.text, w, t.role)
  }
  const block = (key: string, paragraph: string, pid = `${key}_p`): BoardPlan['blocks'][number] => {
    texts[`${key}_s`] = { text: 'Cycle', role: 'subtitulo' }
    texts[pid] = { text: paragraph, role: 'cuerpo' }
    return { key, members: [`${key}_s`, pid], memberRoles: ['subtitulo', 'cuerpo'] }
  }
  const plan = (...blocks: BoardPlan['blocks']): BoardPlan => ({ title: [], opening: [], blocks })
  const tree = defaultAreaTree(3)

  it('widens to the full row with the right side free, without moving anyone origin', () => {
    const p = plan(block('g', LONG))
    const narrow = layoutPlan(p, measure, CANVAS, tree)
    const wide = new Set<string>()
    const widened = layoutPlan(p, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.has('g')).toBe(true)
    for (const id of ['g_s', 'g_p']) {
      expect(widened.get(id)!.x).toBe(narrow.get(id)!.x)
      expect(widened.get(id)!.width).toBeGreaterThan(narrow.get(id)!.width)
    }
    expect(widened.get('g_s')!.y).toBe(narrow.get('g_s')!.y)
    // the widened paragraph is shorter than wrapping downward
    expect(widened.get('g_p')!.height).toBeLessThan(narrow.get('g_p')!.height)
  })

  it('without `wideGroups` there is no widening (stateless behavior)', () => {
    const p = plan(block('g', LONG))
    const a = layoutPlan(p, measure, CANVAS, tree)
    const b = layoutPlan(p, measure, CANVAS, tree, {})
    expect(b).toEqual(a)
  })

  it('does NOT widen if another block is to its right; nothing moves', () => {
    const p = plan(block('g', LONG), block('h', 'Short note'))
    const legacy = layoutPlan(p, measure, CANVAS, tree)
    const wide = new Set<string>()
    const placed = layoutPlan(p, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.size).toBe(0)
    expect(placed).toEqual(legacy)
    // h is to the right of g, in the same row
    expect(placed.get('h_s')!.x).toBeGreaterThan(placed.get('g_s')!.x + placed.get('g_s')!.width - 1)
  })

  it('monotonic: an already widened group does not go back to 3 when another block arrives; the new one goes below', () => {
    const wide = new Set<string>()
    const p1 = plan(block('g', LONG))
    const t1 = layoutPlan(p1, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.has('g')).toBe(true)

    const p2 = plan(block('g', LONG), block('h', 'Short note'))
    const t2 = layoutPlan(p2, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.has('g')).toBe(true)
    for (const id of ['g_s', 'g_p']) expect(t2.get(id)).toEqual(t1.get(id))
    const g = t2.get('g_p')!
    expect(t2.get('h_s')!.y).toBeGreaterThanOrEqual(g.y + g.height)
  })

  it('once another block is placed to its right, growing the paragraph does not move what is already placed', () => {
    const wide = new Set<string>()
    const short = plan(block('g', 'Water rises.'), block('h', 'Short note'))
    const t1 = layoutPlan(short, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.size).toBe(0)
    const grown = plan(block('g', LONG), block('h', 'Short note'))
    const t2 = layoutPlan(grown, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.size).toBe(0) // h is to the right: g only wraps downward
    for (const id of ['g_s', 'h_s', 'h_p']) {
      expect(t2.get(id)!.x).toBe(t1.get(id)!.x)
      expect(t2.get(id)!.y).toBe(t1.get(id)!.y)
    }
    expect(t2.get('g_p')!.x).toBe(t1.get('g_p')!.x)
    expect(t2.get('g_p')!.y).toBe(t1.get('g_p')!.y)
  })

  it('does not widen if there are blocks below that would move up (nothing already placed changes)', () => {
    const wide = new Set<string>()
    const single = plan(block('g', 'Water rises.'))
    layoutPlan(single, measure, CANVAS, tree, { wideGroups: wide })
    // a full-row block (opening) below forces g not to change height
    texts['o_1'] = { text: 'A full width opening paragraph that takes a whole row by itself in the area', role: 'cuerpo' }
    const p: BoardPlan = {
      title: [], opening: [],
      blocks: [block('g', LONG), { key: null, members: ['o_1'], memberRoles: ['cuerpo'] }],
    }
    const placed = layoutPlan(p, measure, CANVAS, tree, { wideGroups: wide })
    expect(wide.size).toBe(0)
    expect(placed).toEqual(layoutPlan(p, measure, CANVAS, tree))
  })
})

// ── Concepts in a row inside a group ────────────────────────────────────────────

describe('bansho-geometry — concepts in a row with room for arrows', () => {
  const D = 120
  /** Group g with a wide subtitle (-> 6 units) and `n` concepts, plus optional text at the end. */
  function conceptPlan(n: number, withTail = false): { plan: BoardPlan; dims: Map<string, Size> } {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`)
    const members = ['sub', ...ids, ...(withTail ? ['tail'] : [])]
    const plan: BoardPlan = {
      title: [],
      opening: [],
      blocks: [{
        key: 'g',
        members,
        memberRoles: members.map((m) => (m === 'sub' ? 'subtitulo' : m === 'tail' ? 'cuerpo' : null)),
        memberConcepts: members.map((m) => m.startsWith('c')),
      }],
    }
    const dims = dimsOf(['sub', 250, 30], ['tail', 100, 40], ...ids.map((id): [string, number, number] => [id, D, D]))
    return { plan, dims }
  }

  it('consecutive concepts go in a row with CONCEPT_ARROW_GAP between them; when they do not fit, they open another row', () => {
    const { plan, dims } = conceptPlan(4)
    const p = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const [c0, c1, c2, c3] = ['c0', 'c1', 'c2', 'c3'].map((id) => p.get(id)!)
    expect(c1!.y).toBe(c0!.y)
    expect(c1!.x - (c0!.x + D)).toBe(CONCEPT_ARROW_GAP)
    // 3 do not fit in 336 px of content (3*120 + 2*88 = 536): 2 per row.
    expect(c2!.x).toBe(c0!.x)
    expect(c2!.y - (c0!.y + D)).toBe(CONCEPT_ARROW_GAP)
    expect(c3!.y).toBe(c2!.y)
    expect(c3!.x).toBe(c1!.x)
  })

  it('text that arrives later goes below the concept row, without overlap', () => {
    const { plan, dims } = conceptPlan(3, true)
    const p = layoutPlan(plan, measureFromDims(dims), CANVAS)
    const c2 = p.get('c2')!
    const tail = p.get('tail')!
    expect(tail.y).toBeGreaterThanOrEqual(c2.y + D)
    for (const id of ['c0', 'c1', 'c2']) expect(collides(p.get(id)!, tail, 0)).toBe(false)
  })

  it('stability: adding a concept (or text) never moves the ones already placed', () => {
    let prev = layoutPlan(conceptPlan(1).plan, measureFromDims(conceptPlan(1).dims), CANVAS)
    for (let n = 2; n <= 5; n++) {
      const { plan, dims } = conceptPlan(n)
      const cur = layoutPlan(plan, measureFromDims(dims), CANVAS)
      for (const [id, box] of prev) expect(cur.get(id), `${id} with ${n} concepts`).toEqual(box)
      prev = cur
    }
    const withTail = layoutPlan(conceptPlan(5, true).plan, measureFromDims(conceptPlan(5, true).dims), CANVAS)
    for (const [id, box] of prev) expect(withTail.get(id)).toEqual(box)
  })

  it('in a 3-unit slot (152 px of content) only one fits per row: they stack with a gap', () => {
    const plan: BoardPlan = {
      title: [], opening: [],
      blocks: [{ key: 'g', members: ['c0', 'c1'], memberRoles: [null, null], memberConcepts: [true, true] }],
    }
    const dims = dimsOf(['c0', D, D], ['c1', D, D])
    const p = layoutPlan(plan, measureFromDims(dims), CANVAS)
    expect(p.get('c1')!.y - (p.get('c0')!.y + D)).toBe(CONCEPT_ARROW_GAP)
    expect(p.get('c1')!.x).toBe(p.get('c0')!.x)
  })

  it('a loose concept (without a group) keeps the centered figure slot', () => {
    const plan: BoardPlan = {
      title: [], opening: [],
      blocks: [{ key: null, members: ['c0'], memberRoles: [null], memberConcepts: [true] }],
    }
    const p = layoutPlan(plan, measureFromDims(dimsOf(['c0', D, D])), CANVAS)
    const slotW = QUANTUM_FIGURE * UNIT_W
    expect(p.get('c0')!.x).toBe(Math.round(area1ItemX() + (slotW - D) / 2))
  })
})

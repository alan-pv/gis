// @vitest-environment node
/**
 * Sections split across columns like on a real board, without moving anything
 * already placed. Canvas 1200x800, defaultAreaTree(3): body starts at y=104, area bottom = 776.
 */
import { describe, it, expect } from 'vitest'
import type { BoardPlan } from './bansho-board.js'
import type { Size } from './bbox.js'
import { layoutPlan, AREA_INSET, BLOCK_GAP_X, WITHIN_GROUP_GAP, TITLE_BAND_HEIGHT } from './bansho-geometry.js'
import type { TextFragment } from './bansho-geometry.js'
import { computeAreaRects, defaultAreaTree, fillOrder } from './areas.js'
import { computeBodyRect } from './bansho-geometry.js'

const CANVAS = { width: 1200, height: 800 }
const MARGIN = 24
const BODY_TOP = MARGIN + TITLE_BAND_HEIGHT + MARGIN
const areas = fillOrder(computeAreaRects(defaultAreaTree(3), computeBodyRect(CANVAS)))
const BOTTOM = areas[0]!.box.y + areas[0]!.box.height
const X1 = Math.round(areas[0]!.box.x + AREA_INSET + BLOCK_GAP_X / 2)
const X2 = Math.round(areas[1]!.box.x + AREA_INSET + BLOCK_GAP_X / 2)
const WIDE = 300 // wider than a 3-unit slot => quantum 6 (full row)

const LINE_H = 18 * 1.3
const PAD = 8
const lineInfo = (id: string) => (id.startsWith('p') ? { lineHeight: LINE_H, padding: PAD } : null)

/** Paragraph of n lines (height as the real measurer would give). */
const para = (lines: number): Size => ({ width: WIDE, height: Math.ceil(lines * LINE_H) + 2 * PAD })

function run(plan: BoardPlan, dims: Record<string, Size>) {
  const fragments = new Map<string, TextFragment[]>()
  const placed = layoutPlan(plan, (id) => dims[id] ?? { width: 0, height: 0 }, CANVAS, defaultAreaTree(3), { wideGroups: new Set(), lineInfo, fragments })
  return { placed, fragments }
}

describe('member granularity', () => {
  const dims = { s: { width: WIDE, height: 40 }, a: { width: WIDE, height: 300 }, b: { width: WIDE, height: 300 }, c: { width: WIDE, height: 300 }, d: { width: WIDE, height: 100 } }

  it('a member that does not fit continues at the top of the next column, without repeating the subtitle', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'a', 'b', 'c'], memberRoles: ['subtitulo', 'cuerpo', 'cuerpo', 'cuerpo'] }] }
    const { placed } = run(plan, dims)
    expect(placed.get('s')!.y).toBe(BODY_TOP)
    expect(placed.get('a')!.x).toBe(X1)
    expect(placed.get('b')!.x).toBe(X1)
    // c no longer fits (40 - 8 + 300 + 300 - 8 + 300 > 672): it continues at the top of column 2
    const c = placed.get('c')!
    expect(c.x).toBe(X2)
    expect(c.y).toBe(BODY_TOP)
  })

  it('stability: adding members (and triggering the split) moves nothing already placed', () => {
    const base: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'a', 'b'], memberRoles: ['subtitulo', 'cuerpo', 'cuerpo'] }] }
    const before = run(base, dims).placed
    const grown: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'a', 'b', 'c', 'd'], memberRoles: ['subtitulo', 'cuerpo', 'cuerpo', 'cuerpo', 'cuerpo'] }] }
    const after = run(grown, dims).placed
    for (const [id, box] of before) expect(after.get(id), id).toEqual(box)
    // d stays below the continuation, in column 2
    expect(after.get('d')!.x).toBe(X2)
    expect(after.get('d')!.y).toBeGreaterThan(after.get('c')!.y)
  })

  it('a NEW section whose head does not fit is placed whole at the top of the next column', () => {
    const plan: BoardPlan = {
      title: [], opening: [],
      blocks: [
        { key: 'g', members: ['a', 'b'], memberRoles: ['cuerpo', 'cuerpo'] },
        { key: 'h', members: ['s2', 'x'], memberRoles: ['subtitulo', 'cuerpo'] },
      ],
    }
    const d = { a: { width: WIDE, height: 300 }, b: { width: WIDE, height: 330 }, s2: { width: WIDE, height: 40 }, x: { width: WIDE, height: 120 } }
    const { placed } = run(plan, d)
    // g takes 300 + 330 - 8 = 622 of 672; h: subtitle (40) + body do not fit in what remains
    expect(placed.get('s2')!.x).toBe(X2)
    expect(placed.get('s2')!.y).toBe(BODY_TOP)
    expect(placed.get('x')!.x).toBe(X2)
  })

  it('subtitle without body yet: room for one line is required, it is not left alone at the bottom', () => {
    const plan: BoardPlan = {
      title: [], opening: [],
      blocks: [
        { key: 'g', members: ['a', 'b'], memberRoles: ['cuerpo', 'cuerpo'] },
        { key: 'h', members: ['s2'], memberRoles: ['subtitulo'] },
      ],
    }
    // g reaches 696 - 8... leaving 24 px: a 22 px subtitle fits but not the one-line reserve
    const d = { a: { width: WIDE, height: 350 }, b: { width: WIDE, height: 330 }, s2: { width: WIDE, height: 22 } }
    const { placed } = run(plan, d)
    expect(placed.get('s2')!.x).toBe(X2)
  })

  it('last area: overflows downward', () => {
    const one = { kind: 'leaf', id: 'area_1' } as const
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g', members: ['a', 'b', 'c'], memberRoles: ['cuerpo', 'cuerpo', 'cuerpo'] }] }
    const placed = layoutPlan(plan, (id) => dims[id as 'a'] ?? { width: 0, height: 0 }, CANVAS, one)
    expect(placed.get('c')!.y + placed.get('c')!.height).toBeGreaterThan(BOTTOM)
  })
})

describe('line granularity', () => {
  it('a paragraph that grows past the bottom is split: same id, two fragments with line ranges', () => {
    const mk = (lines: number) => run(
      { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'p1'], memberRoles: ['subtitulo', 'cuerpo'] }] },
      { s: { width: WIDE, height: 40 }, p1: para(lines) },
    )
    const small = mk(10)
    expect(small.fragments.size).toBe(0)
    const beforeBox = small.placed.get('p1')!

    const big = mk(30) // 30 lines * 23.4 + 16 = 718 > what remains
    const frs = big.fragments.get('p1')!
    expect(frs.length).toBe(2)
    expect(frs[0]!.fromLine).toBe(0)
    expect(frs[1]!.fromLine).toBe(frs[0]!.toLine)
    expect(frs[1]!.toLine).toBe(30)
    // the first fragment is the placed box: it starts where it was and reaches the column bottom
    expect(big.placed.get('p1')).toEqual(frs[0]!.box)
    expect(frs[0]!.box.x).toBe(beforeBox.x)
    expect(frs[0]!.box.y).toBe(beforeBox.y)
    expect(frs[0]!.box.y + frs[0]!.box.height).toBeLessThanOrEqual(BOTTOM)
    // the continuation is at the top of the next column, with the same width
    expect(frs[1]!.box.x).toBe(X2)
    expect(frs[1]!.box.y).toBe(BODY_TOP)
    expect(frs[1]!.box.width).toBe(frs[0]!.box.width)
    // each fragment's height = its lines
    expect(frs[1]!.box.height).toBe(Math.ceil((30 - frs[1]!.fromLine) * LINE_H) + 2 * PAD)
    // the subtitle did not move
    expect(big.placed.get('s')).toEqual(small.placed.get('s'))
  })

  it('a member after a split paragraph goes below the continuation', () => {
    const { placed, fragments } = run(
      { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'p1', 'p2'], memberRoles: ['subtitulo', 'cuerpo', 'cuerpo'] }] },
      { s: { width: WIDE, height: 40 }, p1: para(30), p2: para(2) },
    )
    const cont = fragments.get('p1')![1]!.box
    expect(placed.get('p2')!.x).toBe(X2)
    expect(placed.get('p2')!.y).toBe(cont.y + cont.height + WITHIN_GROUP_GAP)
  })

  it('without lineInfo nothing is split by lines (the member goes through whole)', () => {
    const plan: BoardPlan = { title: [], opening: [], blocks: [{ key: 'g', members: ['s', 'p1'], memberRoles: ['subtitulo', 'cuerpo'] }] }
    const fr = new Map<string, TextFragment[]>()
    const placed = layoutPlan(plan, (id) => (id === 's' ? { width: WIDE, height: 40 } : para(30)), CANVAS, defaultAreaTree(3), { fragments: fr })
    expect(fr.size).toBe(0)
    expect(placed.get('p1')!.x).toBe(X1) // head does not fit without splitting... placed whole
  })
})

/**
 * Tests for bansho-board: pure board structure.
 * Checks the deterministic mapping objects → opening strip / blocks
 * (contiguous runs by group key, null for ungrouped items).
 */
import { describe, it, expect } from 'vitest'
import { planBoard } from './bansho-board.js'
import type { BoardItem } from './bansho-board.js'

/** Concise helper to build BoardItems. */
function text(id: string, group: string | null = null): BoardItem {
  return { id, isText: true, group }
}
function nonText(id: string, group: string | null = null): BoardItem {
  return { id, isText: false, group }
}
/** Helper for items with role === 'titulo'. */
function titulo(id: string): BoardItem {
  return { id, isText: true, group: null, role: 'titulo' }
}

describe('planBoard — golden examples', () => {
  it('golden #1 (water cycle): title in opening strip, each loose figure is its own singleton block', () => {
    // sol/mar/nube/lluvia are consecutive loose figures (ungrouped); they are not
    // merged into one 4-member null block (stacked): each is its own singleton
    // block (they flow in a row, see bansho-metrics.test.ts).
    const items: BoardItem[] = [
      text('titulo_1'),
      nonText('sol_1'),
      nonText('mar_1'),
      nonText('nube_1'),
      nonText('lluvia_1'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: ['titulo_1'],
      blocks: [
        { key: null, members: ['sol_1'], memberRoles: [undefined] },
        { key: null, members: ['mar_1'], memberRoles: [undefined] },
        { key: null, members: ['nube_1'], memberRoles: [undefined] },
        { key: null, members: ['lluvia_1'], memberRoles: [undefined] },
      ],
    })
  })

  it('golden #2 (animals): title + question in opening strip, 2 blocks gathered by membership', () => {
    // Items arrive interleaved: verteb_1, inverteb_1, verteb_def_1, verteb_ej_1, …
    // Real groups are GATHERED: a single block per group with all its members,
    // in arrival order. Block order = first appearance.
    const items: BoardItem[] = [
      text('titulo_1'),
      text('pregunta_1'),
      text('verteb_1', 'col_verteb'),
      text('inverteb_1', 'col_inverteb'),
      text('verteb_def_1', 'col_verteb'),
      text('verteb_ej_1', 'col_verteb'),
      text('inverteb_def_1', 'col_inverteb'),
      text('inverteb_ej_1', 'col_inverteb'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: ['titulo_1', 'pregunta_1'],
      blocks: [
        { key: 'col_verteb', members: ['verteb_1', 'verteb_def_1', 'verteb_ej_1'], memberRoles: [undefined, undefined, undefined] },
        { key: 'col_inverteb', members: ['inverteb_1', 'inverteb_def_1', 'inverteb_ej_1'], memberRoles: [undefined, undefined, undefined] },
      ],
    })
  })
})

describe('planBoard — unit cases', () => {
  it('empty list → empty plan', () => {
    expect(planBoard([])).toEqual({ title: [], opening: [], blocks: [] })
  })

  it('no opening: first item grouped → empty opening, one block with its group', () => {
    const items: BoardItem[] = [
      text('a_1', 'g1'),
      text('b_1', 'g1'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [{ key: 'g1', members: ['a_1', 'b_1'], memberRoles: [undefined, undefined] }],
    })
  })

  it('no opening: first item non-text → empty opening, singleton figure + text block', () => {
    // A loose figure is not merged with the following loose text; it forms
    // its own singleton block and resets the null run.
    const items: BoardItem[] = [nonText('fig_1'), text('t_1')]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: null, members: ['fig_1'], memberRoles: [undefined] },
        { key: null, members: ['t_1'], memberRoles: [undefined] },
      ],
    })
  })

  it('the opening is not "reopened": ungrouped text after the body goes to a null block', () => {
    const items: BoardItem[] = [
      text('titulo_1'),     // opening
      text('x_1', 'g1'),   // starts the body
      text('tarde_1'),      // ungrouped text, but AFTER the body → null block
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: ['titulo_1'],
      blocks: [
        { key: 'g1', members: ['x_1'], memberRoles: [undefined] },
        { key: null, members: ['tarde_1'], memberRoles: [undefined] },
      ],
    })
  })

  it('gather: non-contiguous group → ONE gathered block', () => {
    // gA, gB, gA: the second gA arrives late but is from the same real group →
    // gather: it is GATHERED into gA's block (order = first appearance).
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      text('b_1', 'gB'),
      text('a_2', 'gA'), // late → gathered into the existing gA block
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['a_1', 'a_2'], memberRoles: [undefined, undefined] }, // gathered, arrival order
        { key: 'gB', members: ['b_1'], memberRoles: [undefined] },
      ],
    })
  })

  it('gather: interleaved groups → one block per group', () => {
    // Gather collects all members of each group into a single block.
    // Block order = first appearance: gA (pos 0), gB (pos 1), gC (pos 3).
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      text('b_1', 'gB'),
      text('a_2', 'gA'),
      text('c_1', 'gC'),
      text('b_2', 'gB'),
      text('c_2', 'gC'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['a_1', 'a_2'], memberRoles: [undefined, undefined] },
        { key: 'gB', members: ['b_1', 'b_2'], memberRoles: [undefined, undefined] },
        { key: 'gC', members: ['c_1', 'c_2'], memberRoles: [undefined, undefined] },
      ],
    })
  })

  it('narrative only: two loose figures → TWO distinct singleton blocks', () => {
    // Each loose figure is its own singleton block (they flow in a row, not
    // stacked).
    const items: BoardItem[] = [
      text('titulo_1'), // opening
      nonText('fig_1'),
      nonText('fig_2'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: ['titulo_1'],
      blocks: [
        { key: null, members: ['fig_1'], memberRoles: [undefined] },
        { key: null, members: ['fig_2'], memberRoles: [undefined] },
      ],
    })
  })

  it('gather with narrative: real groups gathered; nulls remain runs', () => {
    // gX is gathered into a single block (its 2 members, though non-contiguous).
    // Ungrouped (null) items remain contiguous runs: n_1 and n_2 form SEPARATE
    // null blocks because a gX item interrupts the null run.
    // Block order = first appearance: null(n_1), gX, null(n_2).
    // Note: g_2 is gathered into gX's block, which is already at position 1,
    // so n_2 ends up at position 2 (after gX in the array).
    const items: BoardItem[] = [
      text('titulo_1'),   // opening
      nonText('n_1'),     // opens a null block
      text('g_1', 'gX'), // real group → new gX block; interrupts the null run
      nonText('n_2'),     // new null run (currentNullBlock was null)
      text('g_2', 'gX'), // gathered into the existing gX block; interrupts the null run
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: ['titulo_1'],
      blocks: [
        { key: null, members: ['n_1'], memberRoles: [undefined] },
        { key: 'gX', members: ['g_1', 'g_2'], memberRoles: [undefined, undefined] }, // gathered
        { key: null, members: ['n_2'], memberRoles: [undefined] },
      ],
    })
  })

  it('group appears before the narrative: group block goes first', () => {
    const items: BoardItem[] = [
      text('g_1', 'gX'),  // body starts with a group
      nonText('n_1'),     // narrative afterwards
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gX', members: ['g_1'], memberRoles: [undefined] },
        { key: null, members: ['n_1'], memberRoles: [undefined] },
      ],
    })
  })
})

// ── Gather tests ────────────────────────────

describe('planBoard — gather', () => {
  it('gather: [A(gA), B(null), A(gA)] → block gA gathers both A items; null block for B; gA first', () => {
    // Canonical case: a grouped item interleaved with a null item, then another of the same group.
    // Result: gather collects A1 and A2 into a single gA block (first appearance = first position).
    // null is a contiguous run → a block of its own.
    const items: BoardItem[] = [
      text('A1', 'gA'),
      text('B1', null),
      text('A2', 'gA'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['A1', 'A2'], memberRoles: [undefined, undefined] }, // gA first (first appearance)
        { key: null, members: ['B1'], memberRoles: [undefined] },
      ],
    })
  })

  it('non-contiguous ungrouped (null) items are NOT gathered (null is not a real group)', () => {
    // A grouped item between two ungrouped non-text items: the nulls form two separate blocks.
    // nonText is used so the first item does not go to the opening strip.
    const items: BoardItem[] = [
      nonText('n_1'),    // non-text → body, null block
      text('g_1', 'gX'), // real group → new gX block; interrupts the null run
      nonText('n_2'),    // new null block (new run)
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: null, members: ['n_1'], memberRoles: [undefined] },
        { key: 'gX', members: ['g_1'], memberRoles: [undefined] },
        { key: null, members: ['n_2'], memberRoles: [undefined] },
      ],
    })
  })

  it('gather: block order = first appearance of the group', () => {
    // gB appears after gA → block gB goes after gA even if gB has more late members.
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      text('b_1', 'gB'),
      text('b_2', 'gB'),
      text('a_2', 'gA'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['a_1', 'a_2'], memberRoles: [undefined, undefined] }, // gA appears first
        { key: 'gB', members: ['b_1', 'b_2'], memberRoles: [undefined, undefined] },
      ],
    })
  })

  it('title and opening are unaffected by gather (they are not part of the body)', () => {
    // Title and opening follow their own logic; gather only affects the body.
    const items: BoardItem[] = [
      titulo('h_1'),
      text('ap_1'),
      text('c_1', 'gA'),
      text('c_2', 'gB'),
      text('c_3', 'gA'),
    ]
    expect(planBoard(items)).toEqual({
      title: ['h_1'],
      opening: ['ap_1'],
      blocks: [
        { key: 'gA', members: ['c_1', 'c_3'], memberRoles: [undefined, undefined] },
        { key: 'gB', members: ['c_2'], memberRoles: [undefined] },
      ],
    })
  })
})

// ── Tests for role 'titulo' ───────────────────────────────────

describe('planBoard — late title', () => {
  it('a title that arrives mid-lesson goes to the band and does not alter the rest of the plan', () => {
    const noTitle: BoardItem[] = [text('a_1'), text('a_2'), nonText('fig_1')]
    const withTitle: BoardItem[] = [text('a_1'), text('a_2'), titulo('h1_1'), nonText('fig_1')]
    const base = planBoard(noTitle)
    const plan = planBoard(withTitle)
    expect(plan.title).toEqual(['h1_1'])
    expect(plan.opening).toEqual(base.opening)
    expect(plan.blocks).toEqual(base.blocks)
  })

  it('a second late title (one already exists) flows as normal text', () => {
    const plan = planBoard([titulo('h1_1'), text('a_1'), titulo('h1_2')])
    expect(plan.title).toEqual(['h1_1'])
    expect([...plan.opening, ...plan.blocks.flatMap((b) => b.members)]).toContain('h1_2')
  })
})

describe('planBoard — role titulo', () => {
  it('a single titulo goes to title, the rest follows the normal logic', () => {
    const items: BoardItem[] = [
      titulo('h1_1'),
      text('def_1'),
      nonText('fig_1'),
    ]
    expect(planBoard(items)).toEqual({
      title: ['h1_1'],
      opening: ['def_1'],
      blocks: [{ key: null, members: ['fig_1'], memberRoles: [undefined] }],
    })
  })

  it('two consecutive titulos: only the 1st goes to the band; the 2nd goes to the opening strip', () => {
    const items: BoardItem[] = [
      titulo('h1_1'),
      titulo('h1_2'),
      text('cuerpo_1'),
    ]
    expect(planBoard(items)).toEqual({
      title: ['h1_1'],
      opening: ['h1_2', 'cuerpo_1'],
      blocks: [],
    })
  })

  it('no titulo: empty title', () => {
    const items: BoardItem[] = [text('texto_1'), nonText('fig_1')]
    const plan = planBoard(items)
    expect(plan.title).toEqual([])
    expect(plan.opening).toEqual(['texto_1'])
  })

  it('titulo followed by a grouped item (no opening): empty opening', () => {
    const items: BoardItem[] = [
      titulo('h1_1'),
      text('a_1', 'gA'),
    ]
    expect(planBoard(items)).toEqual({
      title: ['h1_1'],
      opening: [],
      blocks: [{ key: 'gA', members: ['a_1'], memberRoles: [undefined] }],
    })
  })

  it('titulo goes neither to opening nor to blocks: only to title', () => {
    const items: BoardItem[] = [titulo('h1_1')]
    const plan = planBoard(items)
    expect(plan.title).toEqual(['h1_1'])
    expect(plan.opening).toEqual([])
    expect(plan.blocks).toEqual([])
  })
})

// ── Tests for loose figures in a row ────────────────────────

describe('planBoard — loose figures in a row', () => {
  it('two consecutive loose figures → TWO distinct singleton blocks (not one 2-member block)', () => {
    const items: BoardItem[] = [nonText('fig_1'), nonText('fig_2')]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: null, members: ['fig_1'], memberRoles: [undefined] },
        { key: null, members: ['fig_2'], memberRoles: [undefined] },
      ],
    })
  })

  it('text | figure (singleton) | text: the figure breaks the run → three blocks', () => {
    // Force the first text out of the opening strip by prepending a grouped
    // item (the body starts before the loose texts appear).
    const items: BoardItem[] = [
      text('g_1', 'gX'),   // starts the body (group block)
      text('t_1'),          // loose text #1 → opens a null block
      nonText('fig_1'),      // loose figure → its own singleton block, breaks the run
      text('t_2'),          // loose text #2 → opens a NEW null block (the run was reset)
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gX', members: ['g_1'], memberRoles: [undefined] },
        { key: null, members: ['t_1'], memberRoles: [undefined] },
        { key: null, members: ['fig_1'], memberRoles: [undefined] },
        { key: null, members: ['t_2'], memberRoles: [undefined] },
      ],
    })
  })

  it('consecutive loose text STILL merges into a single null block (no regression)', () => {
    const items: BoardItem[] = [
      text('g_1', 'gX'), // starts the body
      text('t_1'),
      text('t_2'),
      text('t_3'),
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gX', members: ['g_1'], memberRoles: [undefined] },
        { key: null, members: ['t_1', 't_2', 't_3'], memberRoles: [undefined, undefined, undefined] },
      ],
    })
  })

  it('real groups unchanged: gather intact even with interleaved loose figures', () => {
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      nonText('fig_1'),   // loose figure → singleton, does not affect gA's gather
      text('a_2', 'gA'),  // late → gathered into the existing gA block
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['a_1', 'a_2'], memberRoles: [undefined, undefined] },
        { key: null, members: ['fig_1'], memberRoles: [undefined] },
      ],
    })
  })
})

// ── Loose figure attached to a group's block ────────────────

describe('planBoard — attachGroup', () => {
  it('a figure with attachGroup is appended at the end of the block of the group (late member)', () => {
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      text('b_1', 'gB'),
      { ...nonText('fig_1'), attachGroup: 'gA' },
    ]
    expect(planBoard(items)).toEqual({
      title: [],
      opening: [],
      blocks: [
        { key: 'gA', members: ['a_1', 'fig_1'], memberRoles: [undefined, null], attached: [1] },
        { key: 'gB', members: ['b_1'], memberRoles: [undefined] },
      ],
    })
  })

  it('a member arriving after the attach ends up after the figure (arrival order)', () => {
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      { ...nonText('fig_1'), attachGroup: 'gA' },
      text('a_2', 'gA'),
    ]
    expect(planBoard(items).blocks).toEqual([
      { key: 'gA', members: ['a_1', 'fig_1', 'a_2'], memberRoles: [undefined, null, undefined], attached: [1] },
    ])
  })

  it('if the block of the group does not exist in the plan yet, the figure flows loose (fallback)', () => {
    const items: BoardItem[] = [
      { ...nonText('fig_1'), attachGroup: 'gA' }, // gA appears AFTER
      text('a_1', 'gA'),
      { ...nonText('fig_2'), attachGroup: 'gInexistente' },
    ]
    expect(planBoard(items).blocks).toEqual([
      { key: null, members: ['fig_1'], memberRoles: [undefined] },
      { key: 'gA', members: ['a_1'], memberRoles: [undefined] },
      { key: null, members: ['fig_2'], memberRoles: [undefined] },
    ])
  })

  it('attachGroup on text or on a grouped item is ignored', () => {
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      { ...text('t_1'), attachGroup: 'gA' },
      { ...nonText('f_1', 'gB'), attachGroup: 'gA' },
    ]
    expect(planBoard(items).blocks).toEqual([
      { key: 'gA', members: ['a_1'], memberRoles: [undefined] },
      { key: null, members: ['t_1'], memberRoles: [undefined] },
      { key: 'gB', members: ['f_1'], memberRoles: [undefined] },
    ])
  })

  it('an attached figure does not interrupt the loose-text run', () => {
    const items: BoardItem[] = [
      text('a_1', 'gA'),
      text('s_1'),
      { ...nonText('fig_1'), attachGroup: 'gA' },
      text('s_2'),
    ]
    expect(planBoard(items).blocks).toEqual([
      { key: 'gA', members: ['a_1', 'fig_1'], memberRoles: [undefined, null], attached: [1] },
      { key: null, members: ['s_1', 's_2'], memberRoles: [undefined, undefined] },
    ])
  })
})

describe('planBoard — nearId (fallback)', () => {
  it('a loose figure with nearId carries `near` in its singleton block and is not attached', () => {
    const items: BoardItem[] = [text('a_1', 'gA'), { ...nonText('fig_1'), nearId: 'a_1' }, text('s_1')]
    expect(planBoard(items).blocks).toEqual([
      { key: 'gA', members: ['a_1'], memberRoles: [undefined] },
      { key: null, members: ['fig_1'], memberRoles: [undefined], near: 'a_1' },
      { key: null, members: ['s_1'], memberRoles: [undefined] },
    ])
  })

  it('nearId on text or on a grouped item is ignored', () => {
    const items: BoardItem[] = [text('a_1', 'gA'), { ...text('t_1'), nearId: 'a_1' }, { ...nonText('f_1', 'gB'), nearId: 'a_1' }]
    for (const b of planBoard(items).blocks) expect(b.near).toBeUndefined()
  })
})

/**
 * Pure bansho board structure.
 *
 * Maps a list of objects, in arrival order, to the board's structural regions:
 * the title block, the opening strip and the body blocks.
 *
 * Items with role === 'titulo' in the initial run go to the `title` block
 * (horizontally centered at the top). The rest is opening strip + body blocks.
 *
 * Body grouping is by MEMBERSHIP, not contiguity. Members of a group with
 * key != null are GATHERED into a single block anchored at the group's first
 * appearance. A late member is appended to its group's block instead of
 * creating a second one. Ungrouped items (null) still form blocks by CONTIGUOUS
 * runs (null is not a real group).
 * Consequence: adding a late member to an existing group reflows the whole
 * block and pushes later content down (a deliberate exception to "never move
 * what is already placed").
 *
 * Among ungrouped items (key === null), a loose FIGURE (isText === false) is
 * NOT merged into the contiguous null run: it forms its own SINGLETON block
 * (one member) and RESETS the run, like a grouped item does. This way loose
 * figures flow in a row (side by side) like group blocks, instead of stacking
 * under one another inside a single null block. Loose TEXT (isText === true)
 * keeps merging into the contiguous null run (bansho paragraphs stack).
 *
 * This phase is STRUCTURE, not geometry: it computes no BBoxes, packing or wrap.
 *
 * Guaranteed properties:
 * - Deterministic: same input gives the same BoardPlan.
 * - Pure: no Konva, no React, no DOM.
 * - Block order = order of each group's first appearance.
 */
import type { Role } from '@/contract/index.js'

/** An object candidate for placement, in arrival order. */
export interface BoardItem {
  id: string
  /** true if the object is of type 'texto' (object === 'texto'). */
  isText: boolean
  /** Group id if the object was born grouped (add.group), or null. */
  group: string | null
  /**
   * Semantic role of the object. Only meaningful when role === 'titulo':
   * those items go to the centered block at the top of the board.
   * null for non-text or when no role was given.
   */
  role?: Role | null
  /**
   * true if the object is a CONCEPT (a circle with its name). Layout only:
   * consecutive concepts of a group form a row.
   */
  isConcept?: boolean
  /**
   * Only for loose FIGURES (group === null, isText === false).
   * Id of the group whose block should receive the figure as a late member
   * (appended at the end, like the group gather). The scene sets it ONCE, when
   * the figure gets a `connect` in its own batch toward a member of that group
   * or toward the group. Layout only: real membership (`group`) does not change.
   * If the group's block does not exist yet in the plan (unknown group, or its
   * first appearance comes after the figure), it is ignored and the figure
   * flows loose.
   */
  attachGroup?: string | null
  /**
   * Fallback: id of the target object of a `connect` in the same batch, for a
   * loose figure whose attachment to the group was reverted. Layout places it
   * in the free gap nearest to that object (see `layoutPlan`). If the target
   * is not placed yet, it is ignored.
   */
  nearId?: string | null
  /**
   * The open question lives in the scene but is neither drawn nor given space.
   * `planBoard` drops it as if it did not exist (it gets no box).
   */
  hidden?: boolean
}

/**
 * A body block of the board.
 *
 * For groups with key != null, a block gathers ALL the group's members (even
 * if they arrived non-contiguously). For ungrouped items (key === null), a
 * block is still a contiguous run.
 */
export interface BoardBlock {
  /**
   * Id of the group the members belong to, or null for ungrouped items.
   * Narrative blocks have key = null.
   */
  key: string | null
  /** Member ids in arrival order (top to bottom within the block). */
  members: string[]
  /**
   * Semantic role of each member, parallel to `members` (same index).
   * `undefined`/`null` if the member has no known role.
   *
   * Propagated from `BoardItem.role` so `layoutPlan` can treat some roles
   * specially (e.g. stretch the subtitle to the block width) without needing
   * the scene: the structural plan already carries it.
   */
  memberRoles: (Role | null | undefined)[]
  /** Parallel to `members`: true if the member is a concept. Absent = none. */
  memberConcepts?: boolean[]
  /**
   * Indices (in `members`) of loose figures ATTACHED to the block as late
   * members. Only present if there are any. Layout separates them from their
   * neighbor with a positive gap (not the group's text-padding overlap).
   */
  attached?: number[]
  /** Fallback: id of the target object next to which the singleton figure is placed. */
  near?: string
}

/** Structural plan of the board (no geometry). */
export interface BoardPlan {
  /**
   * Ids of the initial run of items with role === 'titulo'.
   * Placed horizontally centered in the board's top strip.
   * Empty if no item with role === 'titulo' comes first.
   */
  title: string[]
  /** Ids in the opening strip, in arrival order. */
  opening: string[]
  /**
   * Body blocks, in order of first appearance.
   *
   * - Groups with key != null: a single block per group with ALL its members
   *   (gather, even if they arrived non-contiguously).
   * - Ungrouped items (key === null): blocks by CONTIGUOUS runs (no gather;
   *   null is not a real group).
   *
   * Each block carries `memberRoles` parallel to `members`: each member's role
   * travels with the structural plan so `layoutPlan` can give it special
   * geometric treatment (e.g. stretch the subtitle to the block width)
   * without depending on the scene.
   */
  blocks: BoardBlock[]
}

/**
 * Resolves the bansho board structure from arrival order.
 *
 * Deterministic algorithm:
 * 0. Title block: initial run of items with role === 'titulo'. Placed
 *    centered at the top. Stops at the first item without role 'titulo'.
 * 1. Opening strip: the next run of items that are text AND ungrouped (and
 *    not titles). Stops at the first grouped or non-text item.
 * 2. Body, grouped by MEMBERSHIP:
 *    - Item with key != null (real group): if a block already exists for that
 *      key, APPEND the id to it (gather). Otherwise create a new block and
 *      register it in the map. Block order = first appearance.
 *    - Item with key === null (ungrouped): CONTIGUOUS runs (null is not a
 *      real group; non-contiguous null items are not gathered).
 *      A grouped item interrupts the current null run.
 *
 * @param items  Candidate objects in arrival order.
 * @returns      Structural plan of the board (no geometry).
 */
export function planBoard(rawItems: readonly BoardItem[]): BoardPlan {
  const allItems = rawItems.some((it) => it.hidden === true) ? rawItems.filter((it) => it.hidden !== true) : rawItems
  const title: string[] = []
  const opening: string[] = []

  // LATE title: the agent may write it mid-lesson, once it understands the topic.
  // If the first item with role 'titulo' does not open the list, it is pulled out
  // of the flow into the reserved band (nothing already placed moves: the body
  // is computed the same without it).
  let items: readonly BoardItem[] = allItems
  const lateTitleAt = allItems.findIndex((it) => it.role === 'titulo')
  if (lateTitleAt > 0) {
    title.push(allItems[lateTitleAt]!.id)
    items = allItems.filter((_, i) => i !== lateTitleAt)
  }

  // 0. Initial 'titulo' run: centered at the top.
  //
  // The title band has a FIXED height (TITLE_BAND_HEIGHT; `computeBodyRect` is
  // a pure function of the canvas), so only ONE title fits. A 2nd title of the
  // run stacked in the band overflowed into the body and overlapped the first
  // opening-strip item. Extra titles go to the opening strip, which stacks
  // without colliding with the flow.
  let bodyStart = 0
  for (; bodyStart < items.length && lateTitleAt <= 0; bodyStart++) {
    const item = items[bodyStart]
    if (item === undefined) break
    if (item.role !== 'titulo') break
    if (title.length === 0) title.push(item.id)
    else if (item.isText && item.group === null) opening.push(item.id)
    else break
  }

  // 1. Opening strip: next run of text + ungrouped + non-title.
  for (; bodyStart < items.length; bodyStart++) {
    const item = items[bodyStart]
    if (item === undefined) break
    if (!item.isText || item.group !== null) break
    opening.push(item.id)
  }

  // 2. Body: gather by membership.
  //
  // For groups with key != null: map of key to existing block (gather).
  // The block is registered the first time the group appears.
  // For null items: contiguous runs. A grouped item resets the null block.
  const blocks: BoardBlock[] = []
  const groupBlocks = new Map<string, BoardBlock>()
  let currentNullBlock: BoardBlock | null = null

  for (let i = bodyStart; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    const key = item.group // null for ungrouped items

    if (key !== null) {
      // Item with a real group: gather into that key's block.
      const existing = groupBlocks.get(key)
      if (existing !== undefined) {
        // Block already exists: append (gather).
        existing.members.push(item.id)
        existing.memberRoles.push(item.role)
        existing.memberConcepts!.push(item.isConcept === true)
      } else {
        // First appearance of the group: create and register the block.
        const newBlock: BoardBlock = { key, members: [item.id], memberRoles: [item.role], memberConcepts: [item.isConcept === true] }
        blocks.push(newBlock)
        groupBlocks.set(key, newBlock)
      }
      // A grouped item interrupts the null run.
      currentNullBlock = null
    } else if (!item.isText && item.attachGroup != null && groupBlocks.has(item.attachGroup)) {
      // Loose figure attached to a group's block (layout-only late member).
      // It does not interrupt the null run: for the flow it is not an item of its own.
      const target = groupBlocks.get(item.attachGroup)!
      ;(target.attached ??= []).push(target.members.length)
      target.members.push(item.id)
      target.memberRoles.push(item.role ?? null)
      target.memberConcepts!.push(item.isConcept === true)
    } else if (!item.isText) {
      // Loose figure: its own SINGLETON block, flowing in a row like a real
      // group. It interrupts the null run (like a grouped item) so the next
      // loose text opens a new run.
      blocks.push({
        key: null,
        members: [item.id],
        memberRoles: [item.role],
        memberConcepts: [item.isConcept === true],
        ...(item.nearId != null ? { near: item.nearId } : {}),
      })
      currentNullBlock = null
    } else {
      // Loose text: contiguous runs (no gather).
      if (currentNullBlock === null) {
        currentNullBlock = { key: null, members: [], memberRoles: [], memberConcepts: [] }
        blocks.push(currentNullBlock)
      }
      currentNullBlock.members.push(item.id)
      currentNullBlock.memberRoles.push(item.role)
      currentNullBlock.memberConcepts!.push(false)
    }
  }

  // `memberConcepts` only travels if the block has some concept (other plans stay unchanged).
  for (const b of blocks) {
    if (b.memberConcepts !== undefined && !b.memberConcepts.some(Boolean)) delete b.memberConcepts
  }

  return { title, opening, blocks }
}

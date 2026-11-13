/**
 * Deterministic geometry of the bansho board, based on QUANTIZED SLOTS.
 *
 * Turns a `BoardPlan` (structure only, no geometry) into real boxes (`BBox`):
 * the title on the left at its natural width, and the body blocks flowing in
 * the fill order of an `AreaTree`, packed in ROWS inside each area.
 *
 * QUANTIZED SLOT ALGORITHM:
 *
 * Each row of an area is divided into a GRID of `SLOTS_PER_ROW` (6) equal
 * units: `unitW = (area.box.width - 2*AREA_INSET) / 6` (a float; rounding is
 * only applied to the FINAL placement coordinates, never to `unitW` itself, so
 * no drift accumulates between blocks of the same row).
 *
 * Each block claims a whole number of units, its QUANTUM, determined PURELY by
 * its content:
 *   - An ungrouped block (`key === null`) that is a SINGLETON LOOSE FIGURE
 *     (a single non-text member) -> `QUANTUM_FIGURE` (2).
 *   - Any other ungrouped block (opening/narrative, text members)
 *     -> `QUANTUM_TEXT` (6): it claims the whole row.
 *   - A real GROUP block (`key !== null`) -> `QUANTUM_GROUP` (3) by default;
 *     it scales to `QUANTUM_TEXT` (6) if the NATURAL width of `members[0]`
 *     (measured with `measure(members[0], area.box.width - 2*AREA_INSET)`, a
 *     generous maximum width) EXCEEDS the content width of a 3-unit slot
 *     (`3*unitW - BLOCK_GAP_X`). Since this depends ONLY on `members[0]`
 *     (stable: members are always appended at the end), the quantum is
 *     effectively fixed at the group's first appearance without extra code.
 *     Later growth of the group (more members) never changes its quantum:
 *     text that does not fit WRAPS (grows taller) instead of resizing the slot.
 *
 * TEXT/FIGURE DETECTION WITHOUT TOUCHING `planBoard`: `BoardBlock` has no
 * explicit `isText` field. The available signal is `memberRoles[i]`, which in
 * the production path (`src/scene/apply.ts`) is ALWAYS a non-null `Role` for
 * text objects and ALWAYS an explicit `null` for non-text objects.
 * `memberRoles[i] === null` (STRICT comparison, no `??`) is therefore the
 * "non-text member" signal: `undefined` (missing/short memberRoles, e.g. the
 * synthetic opening block or hand-built BoardPlans without roles) is treated
 * as "not a figure" (safe default: falls into QUANTUM_TEXT, never produces a
 * phantom 2-unit figure). It is the same field the subtitle stretching uses.
 *
 * GAPS INSIDE THE SLOT: a slot of `q` units starting at unit `u` of the row
 * occupies `slotX = area.box.x + AREA_INSET + u*unitW`, `slotW = q*unitW`. The
 * block's CONTENT width is `contentW = slotW - BLOCK_GAP_X` (BLOCK_GAP_X/2 of
 * implicit air on each side; gaps between blocks live INSIDE the slot, so the
 * row arithmetic closes exactly in units, with no pixel cursor).
 *   - TEXT members: measured with `measure(id, contentW)`, left-aligned at
 *     `x = slotX + BLOCK_GAP_X/2`.
 *   - A member with `role === 'subtitulo'` inside a GROUP block is STRETCHED
 *     to EXACTLY `contentW` (the slot is decided by the quantum before the
 *     subtitle is measured). Without a group it is not stretched.
 *   - NON-text members (figures) INSIDE any block (singleton or member of a
 *     mixed real group) keep their fixed normalized size (measure returns the
 *     same regardless of `contentW`) and are CENTERED horizontally in the
 *     whole SLOT: `x = slotX + (slotW - w)/2`. A figure is never scaled or
 *     deformed; if wider than `contentW` it may symmetrically eat into the
 *     slot's inner air (accepted: figures carry no group outline, see
 *     BLOCK_GAP_X).
 *
 * ROW PACKING (per area), cursor `(rowUsedUnits, rowY, rowH)`:
 *   - ADMISSION: if `rowUsedUnits + q <= 6` the block is placed at unit
 *     `u = rowUsedUnits`. Otherwise a new row opens (`rowY += rowH +
 *     BLOCK_GAP_Y`, `rowUsedUnits = 0`, `rowH = 0`) and the block starts it
 *     (it always fits: `q <= 6`, so there is no infinite loop).
 *   - "LAST ONE STRETCHES" RULE: after deciding which row the block lands in,
 *     if the units left free in that row after admitting it
 *     (`6 - rowUsedUnits - q`) are `> 0` but `< QUANTUM_FIGURE` (2), the block
 *     ABSORBS the remainder: `q = 6 - rowUsedUnits`. Deterministic: it depends
 *     only on the blocks already placed in the row. E.g. figure(2)+group(3):
 *     the group gets 4 (no orphan 1-unit gap, smaller than a figure); three
 *     figures 2+2+2 fill the row exactly, no stretching.
 *   - Horizontal overlap is IMPOSSIBLE by construction (each block occupies
 *     exactly its declared units within the row), so no collision avoidance
 *     is needed.
 *
 * VERTICAL RULES. A section is split across columns like on a real board, and
 * an object that is already placed is NEVER moved:
 *   1a. If the segment (the block, or the continuation still to place) fits
 *       from the cursor in what remains of the column, it is placed there.
 *   1b. The HEAD of the segment (subtitles + first member) that does not fit
 *       from the cursor, but would fit in an empty column, is placed WHOLE at
 *       the top of the next area (it is the first placement of a new section;
 *       a subtitle is never left alone at the bottom, and a subtitle with no
 *       body yet requires room for one line: `HEAD_RESERVE`).
 *   1b'. MEMBER granularity: if the head fits but a later member does not, the
 *       earlier ones stay and that member (and those after it) CONTINUE at the
 *       top of the next area as the same group (without repeating the
 *       subtitle). Whatever the layout places later in that column goes below
 *       the continuation (the column cursor already includes it).
 *   1b''. LINE granularity: a paragraph (`LayoutOptions.lineInfo`) whose first
 *       line fits but whose last lines pass the bottom is split: the lines
 *       that fit stay and the rest is a FRAGMENT of the same object at the top
 *       of the next area (`LayoutOptions.fragments`; same width, the lines are
 *       already wrapped to it). This is a pure rule over the content: a
 *       paragraph that grows via `update` keeps its box and only adds a
 *       fragment. If not even one line fits, the member moves whole (1b').
 *   1c. If the head does not fit even in an empty column, it is placed anyway
 *       and overflows.
 *   1d. In the LAST area there is no next column: the segment is placed whole
 *       and overflows downward (the canvas clamp does NOT touch the Y of these
 *       members, only the X).
 *   Widening to the right does not apply to a section that was already split.
 *   Known exception: when an earlier section grows and its continuation takes
 *   the top of a column, what was already below it in that column is placed
 *   again (reflow by growth).
 *
 * Fill order: area by area (`fillOrder`); inside each area, rows from top to
 * bottom; inside each row, blocks from left to right (by increasing grid
 * unit).
 *
 * WIDENING TO THE RIGHT: a GROUP block with quantum 3 that opens its row may
 * widen to 6 (a full row) when its content grows, ONLY if doing so does not
 * change the box of ANY other object (the units to its right are free in all
 * its rows and nothing later shifts). It is monotonic and sticky:
 * `LayoutOptions.wideGroups` is kept by the scene between batches
 * (`SceneGroup.wide`) and a widened group never goes back to 3. Without that
 * option there is no widening. The block re-wrapping its own lines when it
 * widens is accepted (it is the same object growing); the origin (x, y) of
 * what is already drawn does not change.
 * The title band is always reserved (`computeBodyRect`), so a late title lands
 * at the top left without moving anything.
 *
 * Stability property: filling is append-only ONLY for a new block with no
 * prior growth. Reflow of later blocks in the same row/area when an earlier
 * block grows is kept: growing in HEIGHT pushes `rowH`/`rowY` of the following
 * rows; growing in WIDTH is no longer possible (the quantum is fixed), so that
 * reflow axis disappears.
 *
 * Guaranteed properties:
 * - Deterministic: same input -> same boxes.
 * - Pure: no Konva, no React, no DOM.
 * - No collisions BETWEEN MEMBERS of the same block (atomic, never split,
 *   never squashed by the clamp).
 * - No collisions BETWEEN distinct blocks: guaranteed BY CONSTRUCTION (the
 *   slot grid never overlaps between blocks of the same row; rows never
 *   overlap because `rowY` only advances). Inside a block, the intentional
 *   "overlap" of the negative WITHIN_GROUP_GAP (text boxes that overlap on
 *   purpose because of padding) does not count as a collision between blocks.
 *
 * Design decisions:
 * - Opening measured at COLUMN_WIDTH: preserves the look of the opening strip
 *   (measured at the same width as before, regardless of the areas).
 * - Title measured at canvas.width - 2*MARGIN.
 *
 * @deprecated COLUMN_WIDTH / COLUMN_GAP: no longer used for the body.
 *   Kept as exports for compatibility with external code that imports them.
 */
import type { BBox, Canvas, Size } from './bbox.js'
import { clampToCanvas } from './bbox.js'
import type { BoardPlan, BoardBlock } from './bansho-board.js'
import type { AreaTree } from './areas.js'
import { defaultAreaTree, computeAreaRects, fillOrder } from './areas.js'

/** Standard margin between adjacent objects and against the board edge (logical px). */
export const STANDARD_MARGIN = 24
const MARGIN = STANDARD_MARGIN

/**
 * Inner indent of each area (logical px): space between the area edge (or the
 * divider) and the text/figure content. Keeps text from touching the edges or
 * the dividers between areas.
 */
export const AREA_INSET = 8

/**
 * Vertical step between stacked objects (logical px).
 * Smaller than MARGIN for more compact reading.
 * Used by the title and the opening strip; the body uses WITHIN_GROUP_GAP / GROUP_GAP.
 */
export const VERTICAL_STACK_GAP = 12

/**
 * TUNEABLE: vertical step INSIDE a real group block (logical px).
 *
 * Negative on purpose: it cancels the inner vertical padding of the text box
 * (TEXT_PADDING = 8 px top + 8 px bottom) so the items of one group read as a
 * continuous block of text with no visual jump between boxes.
 *
 * Line spacing arithmetic:
 *   upper_box.paddingBottom (8 px) + WITHIN_GROUP_GAP (-8) + lower_box.paddingTop (8 px)
 *   = 8 px of real line spacing between the last text line above and the
 *     first text line of the box below.
 * Glyphs do not overlap because the 8 px inner padding absorbs it.
 */
export const WITHIN_GROUP_GAP = -8

/**
 * TUNEABLE: vertical separation between distinct blocks and between items of
 * an ungrouped block (block.key === null) (logical px).
 *
 * Clear visual cue of thematic separation: more room than VERTICAL_STACK_GAP
 * to mark the change of group (or of independent item).
 */
export const GROUP_GAP = 16

/**
 * TUNEABLE: horizontal air reserved INSIDE each slot of the row grid:
 * `contentW = slotW - BLOCK_GAP_X`, split BLOCK_GAP_X/2 on each side. With the
 * slot grid horizontal overlap is already impossible by construction; this
 * value's job is visual: separating the color outlines of neighboring blocks.
 *
 * Each grouped block is drawn with a color outline that extends
 * GROUP_OUTLINE_PADDING (6px, SceneCanvas) OUTWARD from the bbox on each side.
 * If this value equaled GROUP_GAP (16), the real air between two neighboring
 * outlines would be only 16 - 2*6 = 4px, so they would look stuck together.
 * 32 (about 2*GROUP_GAP) gives 32 - 2*6 = 20px of real air between outlines,
 * roomy and visually clear.
 */
export const BLOCK_GAP_X = 32

/**
 * TUNEABLE: vertical separation between rows of blocks inside an area
 * (logical px).
 *
 * Same arithmetic and value as BLOCK_GAP_X (see its comment): guarantees
 * about 20px of real air between the outlines of two neighboring rows.
 */
export const BLOCK_GAP_Y = 32

/**
 * Number of units the WIDTH of each area row is divided into (quantized slot
 * grid). `unitW = (area.box.width - 2*AREA_INSET) / SLOTS_PER_ROW`.
 */
export const SLOTS_PER_ROW = 6

/**
 * Quantum (in `SLOTS_PER_ROW` units) of an ungrouped TEXT block
 * (opening/narrative), and the quantum a GROUP block scales to when its
 * `members[0]` does not fit in a `QUANTUM_GROUP` slot. Claims the whole row.
 */
export const QUANTUM_TEXT = 6

/**
 * Default quantum (units) of a real GROUP block (`key !== null`). Scales to
 * `QUANTUM_TEXT` if `members[0]` does not fit in its slot.
 */
export const QUANTUM_GROUP = 3

/**
 * Quantum (units) of a singleton loose FIGURE (`key === null`, a single
 * non-text member). It is also the MINIMUM quantum of the grid: the threshold
 * of the "last one stretches" rule uses this value (a row remainder smaller
 * than `QUANTUM_FIGURE` could not hold even the smallest possible unit, so it
 * is absorbed by the previous block).
 */
export const QUANTUM_FIGURE = 2

/**
 * Minimum gap (px) between two concepts of the same group, in a row and
 * between rows: what an arrow with a short label needs. The `connect` label is
 * drawn at 14 px (`LABEL_FONT_SIZE`, width about 0.6 * 14 = 8.4 px per
 * character), so about 2 words (about 12 characters, about 100 px) fit in the
 * 88 px gap plus the roughly 12 px of air the drawn circle (0.9 of the box)
 * adds at each end.
 */
export const CONCEPT_ARROW_GAP = 88
/**
 * Fixed height of the top band reserved for the title (logical px).
 *
 * The title is treated as its own **band/area** at the top: the column divider
 * lines do NOT cross it (the body starts below). The band has a FIXED height so
 * `computeBodyRect` is a pure function of the canvas (independent of the
 * measured title height), letting the canvas derive exactly the same body
 * region as the layout engine.
 */
export const TITLE_BAND_HEIGHT = 56

/**
 * TUNEABLE: width reserved at the right of the title band for the automatic
 * date. The title font-size auto-fit uses `canvas.width - 2*MARGIN -
 * DATE_RESERVE` as its maximum width, so a long title does not push its box
 * until it overlaps the date (which SceneCanvas paints as app chrome, outside
 * the scene; it is not a contract object).
 *
 * Conservative estimate: "dd/mm/yyyy" (10 characters) at the date font size
 * (18px, see DATE_FONT_SIZE in SceneCanvas) with the model
 * chars*fontSize*0.55 (about 99px) + 2*TEXT_PADDING (16px) + a visual
 * separation gap (about 25px) = about 140px.
 */
export const DATE_RESERVE = 140

/**
 * Region of the board body (below the title band).
 *
 * SINGLE source of truth for where the body flows and where the areas are
 * partitioned/drawn. Used by both `layoutPlan` (engine) and `SceneCanvas`
 * (dividers and context menu), so the column lines match the real flow.
 *
 * The title band is ALWAYS reserved, with or without a title, so a late title
 * (which the agent writes once it understands what the class is about, midway
 * through it) lands at the top left without moving anything already placed.
 * `hasTitle` is kept in the signature for compatibility and no longer changes
 * the result.
 *
 * @param canvas    Logical canvas space.
 * @param _hasTitle Ignored (the band is always reserved).
 */
export function computeBodyRect(canvas: Canvas, _hasTitle?: boolean): BBox {
  const top = MARGIN + TITLE_BAND_HEIGHT + MARGIN
  return {
    x: MARGIN,
    y: top,
    width: canvas.width - 2 * MARGIN,
    height: canvas.height - MARGIN - top,
  }
}

/**
 * Is `block` a singleton loose FIGURE? Signal used for the quantum (see the
 * file header, "TEXT/FIGURE DETECTION"): no group, a single member, and a
 * STRICT `memberRoles[0] === null` (not `undefined`), which is how
 * `src/scene/apply.ts` marks a non-text object in the structural plan.
 */
function isFigureSingletonBlock(block: BoardBlock): boolean {
  if (block.key !== null) return false
  if (block.members.length !== 1) return false
  const roles = block.memberRoles ?? []
  return roles[0] === null
}

/**
 * Is member `i` of `block` a NON-text member (figure)? Same signal as
 * `isFigureSingletonBlock`, but per member; used to position (left vs
 * centered) inside a GROUP block that may mix text members and a figure.
 */
function isFigureMember(block: BoardBlock, i: number): boolean {
  const roles = block.memberRoles ?? []
  return roles[i] === null
}

/**
 * Is member `i` a CONCEPT inside a GROUP block? Only inside a group do
 * consecutive concepts form a row; a loose concept keeps the figure slot.
 */
function isConceptMember(block: BoardBlock, i: number): boolean {
  return block.key !== null && block.memberConcepts?.[i] === true
}

/**
 * Minimum room (px) that must remain under a subtitle with no body so it is
 * not left alone at the bottom of a column: one body line (18 * 1.3 + 2 * 8 =
 * 40) minus the padding overlap of `WITHIN_GROUP_GAP` (8). This way the first
 * member that arrives later fits without having to move the subtitle, which
 * is already drawn.
 */
export const HEAD_RESERVE = 32

/**
 * A fragment of a paragraph split across columns: a box of the SAME object
 * with its line range (`fromLine` inclusive, `toLine` exclusive) over the text
 * lines wrapped to the width of the first fragment. The first fragment matches
 * the object's placed box.
 */
export interface TextFragment {
  box: BBox
  fromLine: number
  toLine: number
}

/** Pending continuation of a split paragraph. */
interface Carry {
  /** Width (box) of the first fragment: the lines are already wrapped to it. */
  width: number
  /** Lines still to place. */
  remaining: number
  /** First line (index) placed in the next fragment. */
  fromLine: number
  lineHeight: number
  padding: number
}

/** Relative position of a member inside its block. */
interface MemberOffset {
  /** Horizontal offset from the left edge of the content, or null = default rule. */
  dx: number | null
  /** Vertical offset from the top of the block. */
  dy: number
}

/**
 * Places a `BoardPlan` into real boxes: flow through areas with quantized
 * slots inside each row.
 *
 * `measure(id, contentWidth) => Size` lets the engine re-measure each object
 * at the **real width of the slot** where it lands, instead of using
 * dimensions precomputed at a fixed width.
 *
 * - For text objects, `measure` calls the measurer with the given width.
 * - For library objects (figures), `measure` ignores `contentWidth` and
 *   returns the fixed normalized dimensions from the library.
 *
 * @param plan      Board structure (planBoard).
 * @param measure   Measuring callback: `(id, contentWidth) => { width, height }`.
 * @param canvas    Logical canvas space.
 * @param areaTree  Partition tree of the body. Default: `defaultAreaTree(3)`
 *                  (3 equal columns).
 * @returns         Map id -> BBox of each placed object.
 */
export function layoutPlan(
  plan: BoardPlan,
  measure: (id: string, contentWidth: number) => Size,
  canvas: Canvas,
  areaTree: AreaTree = defaultAreaTree(3),
  options?: LayoutOptions,
): Map<string, BBox> {
  const lineInfo = options?.lineInfo
  const finish = (pass: LayoutPassResult): Map<string, BBox> => {
    if (options?.fragments !== undefined) {
      options.fragments.clear()
      for (const [id, list] of pass.fragments) options.fragments.set(id, list)
    }
    return pass.placed
  }
  // Without `wideGroups` there is no widening (deterministic and stateless).
  if (options?.wideGroups === undefined) {
    return finish(layoutPass(plan, measure, canvas, areaTree, new Set<string>(), lineInfo))
  }

  // ── Grow to the right before growing downward ───────────────────────────────
  // `wideGroups` is the STICKY state of groups already widened (kept by the
  // scene between batches). Each new candidate (a group of >=2 members that
  // opens a row at 3 units and gets shorter at 6 units) is tried widened and
  // accepted ONLY if no other box changes: that implies the units to its
  // right were free in all its rows and no later block shifts. A widened
  // group never goes back to 3 (monotonic) and, once another block is placed
  // to its right, widening is no longer acceptable (it would change a box).
  const wide = options.wideGroups
  let pass = layoutPass(plan, measure, canvas, areaTree, wide, lineInfo)
  for (const key of pass.candidates) {
    if (wide.has(key)) continue
    const block = plan.blocks.find((b) => b.key === key)
    if (block === undefined) continue
    const trial = layoutPass(plan, measure, canvas, areaTree, new Set<string>([...wide, key]), lineInfo)
    const own = new Set(block.members)
    let othersUnchanged = true
    for (const [id, box] of pass.placed) {
      if (own.has(id)) continue
      const after = trial.placed.get(id)
      if (after === undefined || after.x !== box.x || after.y !== box.y || after.width !== box.width || after.height !== box.height) {
        othersUnchanged = false
        break
      }
    }
    if (othersUnchanged) {
      // Fragments of other objects must not change either.
      for (const [id, list] of pass.fragments) {
        if (own.has(id)) continue
        if (JSON.stringify(list) !== JSON.stringify(trial.fragments.get(id))) { othersUnchanged = false; break }
      }
    }
    if (othersUnchanged) {
      wide.add(key)
      pass = trial
    }
  }
  return finish(pass)
}

/** Options for `layoutPlan`. */
export interface LayoutOptions {
  /**
   * Keys of groups already widened to `QUANTUM_TEXT` (sticky state). It is READ and
   * EXTENDED in place with the groups widened in this call. If omitted, there is no
   * widening.
   */
  wideGroups?: Set<string>
  /**
   * Line data of a text object that may be SPLIT by lines across columns: line height
   * and vertical padding of its box (height = ceil(lines * lineHeight) + 2 * padding).
   * `null` = not splittable (titles, subtitles, figures, concepts). Without this option
   * no paragraph is split (only whole members move).
   */
  lineInfo?: (id: string) => { lineHeight: number; padding: number } | null
  /**
   * OUTPUT: id -> fragments of paragraphs split across columns (cleared and refilled on
   * each call). The box `layoutPlan` returns for that id is the one of the first fragment.
   */
  fragments?: Map<string, TextFragment[]>
}

/** Result of one placement pass. */
interface LayoutPassResult {
  placed: Map<string, BBox>
  /** Keys of groups that could be widened (see `layoutPlan`). */
  candidates: string[]
  /** Fragments of paragraphs split across columns. */
  fragments: Map<string, TextFragment[]>
}

/** One full placement pass with a fixed set of widened groups. */
function layoutPass(
  plan: BoardPlan,
  measure: (id: string, contentWidth: number) => Size,
  canvas: Canvas,
  areaTree: AreaTree,
  wide: ReadonlySet<string>,
  lineInfo?: (id: string) => { lineHeight: number; padding: number } | null,
): LayoutPassResult {
  const placed = new Map<string, BBox>()
  const candidates: string[] = []
  const fragments = new Map<string, TextFragment[]>()

  const hasTitle = plan.title.length > 0

  // ── Title band: left, natural width ────────────────────────────────────────
  // The title is anchored at x=MARGIN with its MEASURED width (not full-width):
  // the measurer (estimateTextSize/domMeasureText, 'titulo' branch) already
  // returns the natural one-line width of the text, capped at the maximum
  // available width. That maximum excludes DATE_RESERVE to leave room for the
  // date that SceneCanvas paints at the right of the same band (app chrome,
  // outside the scene). The body (and its column lines) still starts BELOW
  // this band (computeBodyRect), so the dividers never cross it.
  if (hasTitle) {
    let tY = MARGIN
    const bandContentWidth = canvas.width - 2 * MARGIN - DATE_RESERVE
    for (const id of plan.title) {
      const dims = measure(id, bandContentWidth)
      placed.set(id, clampToCanvas({ x: MARGIN, y: tY, width: dims.width, height: dims.height }, canvas))
      tY += dims.height + VERTICAL_STACK_GAP
    }
  }

  // ── Body: quantized slots inside a row ─────────────────────────────────────
  //
  // bodyRect: body region, below the title band (computeBodyRect).
  // areas: AreaTree leaves in fill order (fillOrder -> x asc, then y asc).
  // ai: index of the current area. ROW cursor inside the current area:
  //   rowY: top (y) of the current row.
  //   rowUsedUnits: units of the 6-unit grid already used in the current row.
  //   rowH: maximum block height seen in the current row.
  //
  // The opening items do NOT go in a left band: they flow as the FIRST
  // (ungrouped) block of the body, filling the column from the top at the
  // width of the area. This leaves no empty space at the top of the following
  // columns.
  //
  // See the file header comment for the full algorithm.
  const bodyRect = computeBodyRect(canvas, hasTitle)

  const flowBlocks = plan.opening.length > 0
    ? [{ key: null as string | null, members: plan.opening, memberRoles: [] } satisfies BoardBlock, ...plan.blocks]
    : plan.blocks

  const areas = fillOrder(computeAreaRects(areaTree, bodyRect))

  // Ids placed as part of a block that overflowed the CANVAS as an atomic unit
  // (rule 1c): the final defensive clamp must NOT touch their Y (only clamp
  // X) so the block's internal stacking is not squashed.
  const atomicOverflowIds = new Set<string>()

  if (areas.length > 0) {
    let ai = 0
    let rowY = areas[0]!.box.y
    let rowUsedUnits = 0
    let rowH = 0

    // ── Per-area cursors (for `near` placement) ──────────────────────────────
    // The live cursor (ai/rowY/rowUsedUnits/rowH) is the one of the current area. When
    // changing area, the outgoing one is saved and the incoming one is loaded (fresh if
    // never used). Without `near` blocks the behavior is identical to never returning
    // to an area that was left.
    interface Cursor { rowY: number; rowUsedUnits: number; rowH: number }
    const savedCursors = new Map<number, Cursor>()
    const areaOf = new Map<string, number>()
    const freshCursor = (k: number): Cursor => ({ rowY: areas[k]!.box.y, rowUsedUnits: 0, rowH: 0 })
    const cursorOf = (k: number): Cursor =>
      k === ai ? { rowY, rowUsedUnits, rowH } : (savedCursors.get(k) ?? freshCursor(k))
    const setCursor = (k: number, c: Cursor): void => {
      if (k === ai) ({ rowY, rowUsedUnits, rowH } = c)
      else savedCursors.set(k, c)
    }
    const advanceArea = (): void => {
      savedCursors.set(ai, { rowY, rowUsedUnits, rowH })
      ai++
      ;({ rowY, rowUsedUnits, rowH } = savedCursors.get(ai) ?? freshCursor(ai))
    }

    /**
     * Places a singleton figure in the free gap closest (center to center) to the object
     * `block.near`, among the next free position of its area and those of the adjacent
     * areas (in that order of preference; the smallest distance wins, a tie goes to the
     * first). It only uses gaps below/beside what is already placed in each area: it
     * moves nothing. Returns false if the target is not placed or no candidate fits,
     * falling back to the normal flow.
     */
    const placeNear = (block: BoardBlock): boolean => {
      const id = block.members[0]!
      const targetBox = placed.get(block.near!)
      const kt = areaOf.get(block.near!)
      if (targetBox === undefined || kt === undefined) return false
      const tcx = targetBox.x + targetBox.width / 2
      const tcy = targetBox.y + targetBox.height / 2
      let best: { k: number; x: number; y: number; u: number; h: number; w: number; ht: number; dist: number } | null = null
      for (const k of [kt, kt - 1, kt + 1]) {
        if (k < 0 || k >= areas.length) continue
        const a = areas[k]!
        const d = measure(id, a.box.width - 2 * AREA_INSET)
        const c = cursorOf(k)
        let { rowY: y, rowUsedUnits: u, rowH: h } = c
        if (u + QUANTUM_FIGURE > SLOTS_PER_ROW) {
          y += h + BLOCK_GAP_Y
          u = 0
          h = 0
        }
        if (y + d.height > a.box.y + a.box.height) continue
        const unitW = (a.box.width - 2 * AREA_INSET) / SLOTS_PER_ROW
        const slotX = a.box.x + AREA_INSET + u * unitW
        const x = Math.round(slotX + (QUANTUM_FIGURE * unitW - d.width) / 2)
        const dist = Math.hypot(x + d.width / 2 - tcx, y + d.height / 2 - tcy)
        if (best === null || dist < best.dist - 1e-9) best = { k, x, y, u, h, w: d.width, ht: d.height, dist }
      }
      if (best === null) return false
      placed.set(id, { x: best.x, y: best.y, width: best.w, height: best.ht })
      areaOf.set(id, best.k)
      setCursor(best.k, {
        rowY: best.y,
        rowUsedUnits: best.u + QUANTUM_FIGURE,
        rowH: Math.max(best.h, best.ht),
      })
      return true
    }

    for (const block of flowBlocks) {
      const members = block.members
      if (members.length === 0) continue

      if (block.near !== undefined && isFigureSingletonBlock(block) && placeNear(block)) continue

      // Vertical step between members INSIDE the block:
      //   - Real group (block.key !== null): WITHIN_GROUP_GAP (negative, boxes stuck together).
      //   - No group (block.key === null): GROUP_GAP (visible separation between items).
      const memberGap = block.key !== null ? WITHIN_GROUP_GAP : GROUP_GAP
      const roles = block.memberRoles ?? []
      /**
       * Step between member `i` and `i+1` (BLOCK indices). Next to an ATTACHED figure
       * (`block.attached`) the text padding overlap (-8) does not apply: the figure
       * is separated with GROUP_GAP so it does not overlap its text neighbor.
       */
      const gapAfter = (i: number): number =>
        block.key !== null && (block.attached?.includes(i) === true || block.attached?.includes(i + 1) === true)
          ? GROUP_GAP
          : memberGap
      /**
       * Vertical/horizontal arrangement of the block's members `base..`. CONSECUTIVE
       * concepts of a group form a row from left to right while they fit in `contentW`;
       * when they do not fit they open another row below. Between concepts (in a row and
       * between rows) there is a `CONCEPT_ARROW_GAP` gap for an arrow with a label. It is
       * append-only: adding a member does not change the position of the earlier ones.
       * The other members stack as usual. `ds[i]` is member `base + i` of the block (a
       * CONTINUATION in another column is arranged from its top with `base > 0`).
       */
      const arrange = (ds: readonly Size[], contentW: number, base: number): { offsets: MemberOffset[]; height: number } => {
        const offsets: MemberOffset[] = []
        let y = 0 // top of the current member/row
        let rowW = 0 // width used by the current concept row
        let rowHc = 0 // height of the current concept row
        let bottom = 0
        for (let i = 0; i < ds.length; i++) {
          const d = ds[i]!
          const k = base + i
          if (isConceptMember(block, k)) {
            if (i > 0 && isConceptMember(block, k - 1)) {
              if (rowW + CONCEPT_ARROW_GAP + d.width <= contentW + 0.5) {
                offsets.push({ dx: rowW + CONCEPT_ARROW_GAP, dy: y })
                rowW += CONCEPT_ARROW_GAP + d.width
                rowHc = Math.max(rowHc, d.height)
              } else {
                y += rowHc + CONCEPT_ARROW_GAP
                offsets.push({ dx: 0, dy: y })
                rowW = d.width
                rowHc = d.height
              }
            } else {
              y = i === 0 ? 0 : bottom + GROUP_GAP
              offsets.push({ dx: 0, dy: y })
              rowW = d.width
              rowHc = d.height
            }
            bottom = y + rowHc
          } else {
            y = i === 0 ? 0 : bottom + (isConceptMember(block, k - 1) ? GROUP_GAP : gapAfter(k - 1))
            offsets.push({ dx: null, dy: y })
            bottom = y + d.height
          }
        }
        return { offsets, height: bottom }
      }

      const areaIdx = (a: number): number => Math.min(a, areas.length - 1)
      const unitWOf = (a: number): number => (areas[areaIdx(a)]!.box.width - 2 * AREA_INSET) / SLOTS_PER_ROW

      /** Quantum (units) of the block in area `a`; pure. */
      const quantumAt = (a: number): number => {
        if (block.key === null) {
          return isFigureSingletonBlock(block) ? QUANTUM_FIGURE : QUANTUM_TEXT
        }
        // Widened group (sticky): full row, never goes back to 3.
        if (wide.has(block.key)) return QUANTUM_TEXT
        // Real group: default 3, scales to 6 if members[0] does not fit in its slot.
        const areaContentW = areas[areaIdx(a)]!.box.width - 2 * AREA_INSET
        const naturalWidth = measure(members[0]!, areaContentW).width
        const slot3ContentW = Math.round(QUANTUM_GROUP * unitWOf(a) - BLOCK_GAP_X)
        return naturalWidth > slot3ContentW ? QUANTUM_TEXT : QUANTUM_GROUP
      }

      /**
       * Line data of member `k` if it may be split by lines across columns: only paragraph/
       * list/enumeration text (decided by `lineInfo`); never figures or concepts.
       */
      const splitInfo = (k: number): { lineHeight: number; padding: number } | null => {
        if (lineInfo === undefined || isFigureMember(block, k) || isConceptMember(block, k)) return null
        return lineInfo(members[k]!)
      }

      /**
       * Measures the block's members `si..` at the slot of `q` units of area `a`. If the
       * first is the continuation of an already split paragraph (`carry`), it keeps the
       * width of its first fragment (the lines are already wrapped to it) and only counts
       * the lines still missing.
       *
       * Inside a GROUP, the `subtitulo` member(s) are STRETCHED to the EXACT slot
       * `contentW` (width only; the measured height is kept).
       */
      const measureSeg = (a: number, q: number, si: number, carry: Carry | null) => {
        const slotW = q * unitWOf(a)
        const contentW = Math.round(slotW - BLOCK_GAP_X)
        const dims: Size[] = []
        for (let k = si; k < members.length; k++) {
          const id = members[k]!
          let d: Size
          if (carry !== null && k === si) {
            d = { width: carry.width, height: Math.ceil(carry.remaining * carry.lineHeight) + 2 * carry.padding }
          } else {
            d = measure(id, contentW)
          }
          dims.push(block.key !== null && roles[k] === 'subtitulo' ? { width: contentW, height: d.height } : d)
        }
        const { offsets, height } = arrange(dims, contentW, si)
        return { dims, offsets, height }
      }

      /**
       * Writes the boxes of the segment's local members `0..upto-1` (the last one may be a
       * split paragraph: `split`) in row `ry` of area `a`, and advances that area's cursor.
       */
      const commit = (
        a: number, ry: number, ru: number, rh: number, q: number,
        m: { dims: Size[]; offsets: MemberOffset[] },
        si: number, carry: Carry | null, upto: number,
        split: { j: number; n: number; info: { lineHeight: number; padding: number } } | null,
      ): void => {
        const unitW = unitWOf(a)
        const slotX = areas[areaIdx(a)]!.box.x + AREA_INSET + ru * unitW
        const slotW = q * unitW
        let bottom = ry
        const boxes: { id: string; box: BBox; k: number; i: number }[] = []
        for (let i = 0; i < upto; i++) {
          const k = si + i
          const id = members[k]!
          const d = m.dims[i]!
          const off = m.offsets[i]!
          const height = split !== null && split.j === i
            ? Math.ceil(split.n * split.info.lineHeight) + 2 * split.info.padding
            : d.height
          const memberX = off.dx !== null
            ? slotX + BLOCK_GAP_X / 2 + off.dx // concept in a row: to the left, one after another
            : isFigureMember(block, k)
              ? slotX + (slotW - d.width) / 2 // figure: centered in the whole SLOT
              : slotX + BLOCK_GAP_X / 2 // text: left-aligned in the content
          const box = { x: Math.round(memberX), y: ry + off.dy, width: d.width, height }
          boxes.push({ id, box, k, i })
          bottom = Math.max(bottom, box.y + height)
        }
        const overflowsCanvas = bottom > canvas.height
        for (const { id, box, i } of boxes) {
          const isCarry = carry !== null && i === 0
          const isSplit = split !== null && split.j === i
          if (isCarry) {
            // Continuation of an already split paragraph: another fragment of the SAME object.
            const from = carry!.fromLine
            const to = isSplit ? from + split!.n : from + carry!.remaining
            const list = fragments.get(id)
            if (list !== undefined) list.push({ box, fromLine: from, toLine: to })
          } else {
            placed.set(id, box)
            areaOf.set(id, areaIdx(a))
            if (isSplit) fragments.set(id, [{ box, fromLine: 0, toLine: split!.n }])
          }
          if (overflowsCanvas) atomicOverflowIds.add(id)
        }
        // Advance the area row cursor: units used + maximum height seen.
        setCursor(a, { rowY: ry, rowUsedUnits: ru + q, rowH: Math.max(rh, bottom - ry) })
      }

      /**
       * Places the block's members `si..` starting at area `a0`. `initial` = first segment
       * of the block.
       *   - If the HEAD (subtitles + first member) does not fit from the cursor and would
       *     fit in an empty column, the WHOLE segment is placed at the top of the next area
       *     (first placement, not a move).
       *   - If a later member does not fit: a paragraph whose first line fits is split by
       *     lines (fragment); any other member moves whole to the top of the next area as a
       *     CONTINUATION of the same group (without repeating the subtitle).
       *   - In the last area it overflows downward (rule 1d).
       */
      const placeSegment = (a0: number, si: number, carry: Carry | null, initial: boolean): void => {
        let a = a0
        const count = members.length - si
        for (;;) {
          const lastArea = a >= areas.length - 1
          const ar = areas[areaIdx(a)]!
          const areaBottom = ar.box.y + ar.box.height
          const cur = cursorOf(a)
          let ry = cur.rowY
          let ru = cur.rowUsedUnits
          let rh = cur.rowH

          let q = quantumAt(a)
          let m = measureSeg(a, q, si, carry)

          // HORIZONTAL: slot admission. If it does not fit in the remaining units of
          // the row, open a new row (it always fits there: q <= SLOTS_PER_ROW).
          if (ru + q > SLOTS_PER_ROW) {
            ry += rh + BLOCK_GAP_Y
            ru = 0
            rh = 0
          }
          // "Last one stretches" rule: a row remainder smaller than QUANTUM_FIGURE
          // is absorbed by this block.
          const remainingUnits = SLOTS_PER_ROW - ru - q
          if (remainingUnits > 0 && remainingUnits < QUANTUM_FIGURE) {
            q = SLOTS_PER_ROW - ru
            m = measureSeg(a, q, si, carry)
          }

          // Segment head: leading subtitles + the first member that is not a subtitle.
          let h = 0
          while (h < count - 1 && roles[si + h] === 'subtitulo') h++
          const bottomOf = (i: number): number => ry + m.offsets[i]!.dy + m.dims[i]!.height

          // First member that spills out of the column.
          let j = -1
          for (let i = 0; i < count; i++) {
            if (bottomOf(i) > areaBottom) { j = i; break }
          }
          // A subtitle with no body is not left alone at the bottom: room for one body line
          // is required (so the first member that arrives later fits without moving the subtitle).
          if (j < 0 && initial && si === 0 && carry === null && roles[h] === 'subtitulo' && bottomOf(h) + HEAD_RESERVE > areaBottom) {
            j = h
          }

          if (j < 0 || lastArea) {
            // Everything fits, or there are no more columns: the whole segment is placed (1d: overflows downward).
            // Widening candidate: a group whose content has grown (>=2 members), at 3 units,
            // that opens its row and that at 6 would be shorter. Does not apply to an
            // already split section (this path splits nothing).
            if (
              initial && si === 0 && carry === null &&
              block.key !== null && members.length >= 2 && q === QUANTUM_GROUP && ru === 0 &&
              measureSeg(a, QUANTUM_TEXT, 0, null).height < m.height
            ) {
              candidates.push(block.key)
            }
            commit(a, ry, ru, rh, q, m, si, carry, count, null)
            return
          }

          // Can member j be split by lines? (first line fits and lines remain outside)
          const info = splitInfo(si + j)
          if (info !== null) {
            const total = carry !== null && j === 0
              ? carry.remaining
              : Math.floor((m.dims[j]!.height - 2 * info.padding) / info.lineHeight + 1e-6)
            const top = ry + m.offsets[j]!.dy
            const n = Math.floor((areaBottom - top - 2 * info.padding) / info.lineHeight + 1e-6)
            if (n >= 1 && n < total) {
              commit(a, ry, ru, rh, q, m, si, carry, j + 1, { j, n, info })
              const nextCarry: Carry = {
                width: m.dims[j]!.width,
                remaining: total - n,
                fromLine: (carry !== null && j === 0 ? carry.fromLine : 0) + n,
                lineHeight: info.lineHeight,
                padding: info.padding,
              }
              placeSegment(a + 1, si + j, nextCarry, false)
              return
            }
          }

          if (j <= h) {
            // The head does not fit from the cursor: if it would fit in an empty column, the segment is
            // placed whole at the top of the next area (first placement, not a move).
            const fitsEmpty = m.offsets[h]!.dy + m.dims[h]!.height <= ar.box.height
            if (fitsEmpty) {
              if (a === ai) advanceArea()
              a++
              continue
            }
            // It does not even fit in an empty column: placed anyway and overflows as a unit (1c).
            commit(a, ry, ru, rh, q, m, si, carry, count, null)
            return
          }

          // Member granularity: what came before stays; member j and those after it
          // continue at the top of the next area as the same group.
          commit(a, ry, ru, rh, q, m, si, carry, j, null)
          placeSegment(a + 1, si + j, null, false)
          return
        }
      }

      placeSegment(ai, 0, null, true)
    }
  }

  // ── Defensive clamp to the canvas ───────────────────────────────────────────
  // For members of an atomic block that overflowed the CANVAS (rule 1c): the Y is NOT
  // clamped (it would compress/squash the block's internal stacking, reintroducing
  // collisions). Only X is clamped. All other boxes (normal case) are clamped in X
  // and Y as usual.
  for (const [id, box] of placed) {
    if (atomicOverflowIds.has(id)) {
      const x = Math.max(0, Math.min(box.x, canvas.width - box.width))
      placed.set(id, { ...box, x })
    } else {
      placed.set(id, clampToCanvas(box, canvas))
    }
  }

  return { placed, candidates, fragments }
}

/**
 * Scene engine: applies operations to a scene.
 *
 * Takes an immutable scene and a list of validated operations and produces a new
 * scene + the animation script (SceneEvent[]) + warnings.
 *
 * Key rules implemented here:
 * - The input scene is never mutated (Maps are cloned).
 * - Events follow the SAME order as the accepted ops.
 * - Id collision -> silent rename; the alias is resolved within the batch.
 * - Unknown ref after alias resolution -> warning, never a throw.
 * - Never throws; any error becomes a warning.
 *
 * The model never decides position:
 * - `add` places with the board layout geometry. If it carries `op.group`, it
 *   creates or grows that group with declared membership.
 * - op `group` is create-or-grow: re-emitting an existing id merges members.
 */
import { flagOpenQuestion } from './open-question.js'
import type { Operation } from '@/contract/index.js'
import { planBoard, layoutPlan, STANDARD_MARGIN } from '@/layout/index.js'
import type { BoardItem, Size, AreaTree } from '@/layout/index.js'
import { defaultAreaTree } from '@/layout/index.js'
import type { Scene, SceneObject, SceneConnection, SceneGroup, SceneHighlight } from './model.js'
import { estimateTextSize, TEXT_PADDING, fitTitleFontSize } from './text-measure.js'
import { estimateConceptLayout } from './concept-measure.js'
import type { ConceptMeasurer } from './concept-measure.js'
import type { TextMeasurer } from './text-measure.js'
import { extensionSuffix } from './text-extend.js'
import { computeListStarts } from './list-numbering.js'
import { splitLineInfo, withPlacement, withListStart } from './layout-support.js'
import type { TextFragment } from '@/layout/index.js'

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * Environment injected by the caller: canvas, measurers and layout options.
 */
export interface SceneEnv {
  canvas: { width: number; height: number }
  /**
   * Active page number for the canonical id format object_page_n.
   * Defaults to 1 when omitted.
   */
  page?: number
  /**
   * Ids in use on the OTHER pages of the document (ids collide globally).
   * Defaults to empty: no external pages.
   */
  externalIds?: ReadonlySet<string>
  /**
   * Text measurer for 'texto' objects.
   * If omitted, estimateTextSize is used (pure fixed-width-per-character estimate).
   * In the browser, domMeasureText (src/canvas/measure-text.ts) is injected.
   */
  measureText?: TextMeasurer
  /**
   * Concept measurer: a circle with its name inside. If omitted, estimateConceptLayout
   * (pure estimate) is used. In the browser the DOM measurer is injected.
   */
  measureConcept?: ConceptMeasurer
  /**
   * Partition tree of the body areas.
   * If omitted, layoutPlan falls back to defaultAreaTree(3).
   * The agent never sees it; applyToActivePage injects it from the active page.
   */
  areaTree?: AreaTree
  /**
   * Switch for attaching connected figures to their target group (default true).
   * When false the figure flows loose; useful for measuring the "before".
   */
  attachConnectedFigure?: boolean
  /**
   * Measurement only: disables the guard that reverts the attachment when it would move
   * something already placed horizontally. Defaults to false (guard active).
   */
  attachWithoutXGuard?: boolean
  /**
   * Fallback (default true): when the attachment is reverted by the horizontal-move guard,
   * the figure is placed in the free slot nearest the connect target (same or adjacent
   * area) without moving anything already placed. When false it flows loose instead.
   */
  fallbackNearTarget?: boolean
}

/**
 * Animation script: each event corresponds to an accepted op (same order).
 *
 * The renderer interprets these events to animate the canvas.
 */
export type SceneEvent =
  | { type: 'draw_object'; id: string }
  | { type: 'draw_connection'; id: string }
  | { type: 'set_label'; ref: string }
  /** Highlights created in this batch (the ones persisted in scene.highlights). */
  | { type: 'highlight'; highlights: Array<{ id: string; ref: string; word?: string }> }
  | { type: 'group'; id: string }
  | { type: 'ungroup'; id: string }
  | { type: 'remove'; ids: string[] }
  /**
   * `extendedFrom`: previous text when an `update` of `set.text` only APPENDS a suffix.
   * The animation then writes only the suffix.
   */
  | { type: 'update'; id: string; extendedFrom?: string }
  | { type: 'clear' }

/**
 * Result of applyOperations.
 */
export interface ApplyResult {
  /** New scene (the input scene is not modified). */
  scene: Scene
  /** Animation script in the same order as the accepted ops. */
  events: SceneEvent[]
  /** Warnings (invalid refs, nested members, etc.). */
  warnings: string[]
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Applies a list of validated operations to the scene.
 *
 * The input scene is NOT mutated: the Maps are cloned before modifying.
 *
 * @param scene  Current scene (not modified).
 * @param ops    Operations already validated by src/validator.
 * @param env    Environment: canvas, measurers and layout options.
 * @returns      New scene + animation script + warnings.
 */
export function applyOperations(scene: Scene, ops: Operation[], env: SceneEnv): ApplyResult {
  // Clone Maps so the original scene is not mutated
  const objects = new Map(scene.objects)
  const connections = new Map(scene.connections)
  const groups = new Map(scene.groups)
  const highlights = new Map(scene.highlights)

  const events: SceneEvent[] = []
  const warnings: string[] = []

  /**
   * Id alias map within the batch.
   *
   * IMPORTANT: the agent suggests ids; the canvas is the authority.
   * On an id collision in the scene, the engine renames silently.
   * Every LATER reference in the same batch is resolved against this alias map
   * first (the agent refers to what it just created), and against the scene
   * if there is no alias.
   *
   * Canonical id format: <type>_<page>_<n>, where n is the smallest free integer.
   */
  const aliasMap = new Map<string, string>()

  /**
   * Ids of objects created in THIS batch (this call). Only a loose figure born in
   * the batch can be attached in layout to a group by a `connect` of the same
   * batch; a connect from a later batch does not move it.
   */
  const batchNew = new Set<string>()

  /**
   * Resolves a suggested id against the alias map.
   * Returns the same id if there is no alias.
   */
  function resolveAlias(suggestedId: string): string {
    return aliasMap.get(suggestedId) ?? suggestedId
  }

  // Active page number: defaults to 1
  const activePage = env.page ?? 1

  /**
   * Checks whether an id already exists in the scene being built OR on the
   * other pages of the document (ids collide globally).
   */
  function idExists(id: string): boolean {
    return (
      objects.has(id) ||
      connections.has(id) ||
      groups.has(id) ||
      highlights.has(id) ||
      (env.externalIds?.has(id) ?? false)
    )
  }

  /**
   * Generates the smallest free id in the format <type>_<page>_<n>.
   * Considers both the current scene and the external ids.
   */
  function nextFreeId(type: string): string {
    let n = 1
    while (idExists(`${type}_${activePage}_${n}`)) {
      n++
    }
    return `${type}_${activePage}_${n}`
  }

  /**
   * Registers a suggested id and returns the canonical id.
   * On a collision, generates a new one and stores the alias.
   */
  function canonicalId(suggestedId: string, type: string): string {
    if (!idExists(suggestedId)) {
      return suggestedId
    }
    const canonical = nextFreeId(type)
    aliasMap.set(suggestedId, canonical)
    return canonical
  }

  // ── Contiguity of connected objects ───────────────────────────────────────────

  /** Id of the group (in the scene being built) that contains the object, or null. */
  function groupOfObject(id: string): string | null {
    for (const [groupId, grp] of groups) {
      if (grp.members.includes(id)) return groupId
    }
    return null
  }

  /** Size of an object ALREADY inserted in the scene, at the given content width. */
  function measureExisting(id: string, contentWidth: number): Size {
    const existing = objects.get(id)
    if (!existing) return { width: 0, height: 0 }
    if (existing.object === 'texto') {
      return (env.measureText ?? estimateTextSize)(
        existing.text ?? existing.label ?? '',
        contentWidth,
        existing.role ?? 'cuerpo',
        existing.listStart,
      )
    }
    const d = measureConceptLabel(existing.label ?? '', contentWidth)
    return { width: d, height: d }
  }

  /** Side of the (square) box of a concept with that name, capped at `cap`. */
  function measureConceptLabel(label: string, cap: number): number {
    return (env.measureConcept ?? estimateConceptLayout)(label, cap).diameter
  }

  /** Fragments of the split paragraphs from the last `runLayout`. */
  let lastFragments: Map<string, TextFragment[]> = new Map()
  /** Starting list number of an object not yet inserted (the one being added). */
  const pendingListStarts = new Map<string, number>()

  /**
   * Layout with the sticky state of widened groups: groups already widened live in
   * `SceneGroup.wide`; `layoutPlan` extends the set and it is persisted here in
   * `groups` for later batches.
   *
   * `pending` = object being added that is not yet in `objects` (its role/text come
   * from the op). Numbered lists are numbered before measuring: existing objects
   * keep their `listStart` and the new one leaves it in `pendingListStarts`.
   */
  function runLayout(
    plan: ReturnType<typeof planBoard>,
    measure: (id: string, contentWidth: number) => Size,
    pending?: { id: string; isText: boolean; role: SceneObject['role']; text: string },
  ) {
    const wide = new Set<string>()
    for (const [gid, g] of groups) if (g.wide === true) wide.add(gid)
    const roleOf = (id: string) => (pending !== undefined && id === pending.id ? pending.role : objects.get(id)?.role)
    const textOf = (id: string) => (pending !== undefined && id === pending.id ? pending.text : (objects.get(id)?.text ?? objects.get(id)?.label ?? ''))
    const starts = computeListStarts(plan, roleOf, textOf)
    pendingListStarts.clear()
    for (const [id, o] of objects) objects.set(id, withListStart(o, starts.get(id)))
    if (pending !== undefined && starts.has(pending.id)) pendingListStarts.set(pending.id, starts.get(pending.id)!)
    const fragments = new Map<string, TextFragment[]>()
    const lineInfo = (id: string) =>
      pending !== undefined && id === pending.id
        ? splitLineInfo(pending.isText, pending.role)
        : splitLineInfo(objects.get(id)?.object === 'texto', objects.get(id)?.role)
    const placed = layoutPlan(plan, measure, env.canvas, env.areaTree ?? defaultAreaTree(3), { wideGroups: wide, lineInfo, fragments })
    lastFragments = fragments
    for (const gid of wide) {
      const g = groups.get(gid)
      if (g !== undefined && g.wide !== true) groups.set(gid, { ...g, wide: true })
    }
    return placed
  }

  /**
   * Full relayout of the objects already inserted (same reflow as `add`).
   * Only invoked when a figure in the batch changes its layout attachment.
   */
  function relayoutAll(): void {
    const items: BoardItem[] = []
    for (const [id, obj] of objects) {
      items.push({
        id,
        isText: obj.object === 'texto',
        group: groupOfObject(id),
        role: obj.role,
        isConcept: obj.object === 'concepto',
        attachGroup: obj.layoutAttach ?? null,
        nearId: obj.layoutNear ?? null,
      })
    }
    const placed = runLayout(planBoard(flagOpenQuestion(items, (i) => objects.get(i)?.text ?? objects.get(i)?.label)), measureExisting)
    for (const [id, obj] of objects) {
      objects.set(id, withPlacement(obj, placed.get(id), lastFragments))
    }
  }

  /**
   * Fallback: the attachment to the group block was reverted by the horizontal-move
   * guard. The figure is placed in the free slot nearest the connect target (same or
   * adjacent area), without moving ANYTHING already placed (neither x nor y of objects
   * from earlier batches). If the relayout would move something placed, it is reverted
   * and the figure stays in the loose flow.
   */
  function placeNearTarget(figId: string, otherId: string, before: Map<string, SceneObject>): void {
    const targetId = groups.has(otherId) ? (groups.get(otherId)!.members.at(-1) ?? null) : otherId
    if (targetId === null || targetId === figId || !objects.has(targetId)) return
    const fig = objects.get(figId)!
    objects.set(figId, { ...fig, layoutNear: targetId })
    relayoutAll()
    for (const [id, prev] of before) {
      if (id === figId || batchNew.has(id)) continue
      const now = objects.get(id)!.box
      if (now.x !== prev.box.x || now.y !== prev.box.y) {
        objects.clear()
        for (const [bid, o] of before) objects.set(bid, o)
        return
      }
    }
  }

  /**
   * A LOOSE figure (non-text, no group, no previous attachment) created in this batch
   * that receives a `connect` (in either direction) whose other end is a group member,
   * or the group itself, gets attached in layout to that group's block. The first
   * matching connect wins (attachments are not reassigned). A target in the opening
   * strip, loose text or a loose figure changes nothing (its group is null). Group
   * membership in the scene and in the agent state is unchanged.
   */
  function attachLooseFigure(fromId: string, toId: string): void {
    if (env.attachConnectedFigure === false) return
    for (const [figId, otherId] of [[fromId, toId], [toId, fromId]] as const) {
      if (!batchNew.has(figId)) continue
      const fig = objects.get(figId)
      if (!fig || fig.object === 'texto' || fig.layoutAttach !== undefined) continue
      if (groupOfObject(figId) !== null) continue
      const target = groups.has(otherId) ? otherId : groupOfObject(otherId)
      if (target === null || target === undefined) continue
      // Nothing already placed moves horizontally. If attaching the figure makes the
      // atomic block overflow its column and something placed changes x, revert and
      // let the figure flow loose (no attachment). Only later blocks may move down (y).
      const before = new Map<string, SceneObject>(objects)
      objects.set(figId, { ...fig, layoutAttach: target })
      relayoutAll()
      let movedX = false
      for (const [id, prev] of before) {
        if (id !== figId && objects.get(id)!.box.x !== prev.box.x) { movedX = true; break }
      }
      if (movedX && env.attachWithoutXGuard !== true) {
        objects.clear()
        for (const [id, o] of before) objects.set(id, o)
        if (env.fallbackNearTarget !== false) placeNearTarget(figId, otherId, before)
      }
      return
    }
  }

  // ── Operation processing ───────────────────────────────────────────────────────

  for (const op of ops) {
    try {
      switch (op.op) {

        // ── 3.1 add ────────────────────────────────────────────────────────────
        case 'add': {
          // fontSize computed for the title (auto-fit, single line). Only for
          // role==='titulo'; not used by the layout (which re-measures through
          // measure) but stored on the SceneObject.
          let fittedFontSize: number | undefined
          if (op.object === 'texto') {
            const textContent = op.text ?? op.label ?? op.object
            const opRole = op.role ?? 'cuerpo'
            if (opRole === 'titulo') {
              const maxContentWidth = env.canvas.width - 2 * STANDARD_MARGIN - 2 * TEXT_PADDING
              fittedFontSize = fitTitleFontSize(textContent, maxContentWidth)
            }
          }

          // The canonical id and group of the new object must be known BEFORE placing:
          // the board geometry depends on the full structure.
          const canonical = canonicalId(op.id, op.object)

          // Group of the new object: resolved by alias (it may not exist in the
          // scene yet; the group is created further below).
          const newGroup: string | null =
            op.group !== undefined ? resolveAlias(op.group) : null

          // ── Measurement callback ──────────────────────────────────────────
          // layoutPlan calls measure(id, contentWidth) for each object when it needs
          // its dims at the width of the area it lands in. The closure captures:
          //   - `canonical` + op data, for the new object (not yet in `objects`).
          //   - `objects` + `env`, for the existing ones.
          const measureFn = (id: string, contentWidth: number): Size => {
            if (id === canonical) {
              // New object (not yet inserted in `objects`).
              if (op.object === 'texto') {
                return (env.measureText ?? estimateTextSize)(
                  op.text ?? op.label ?? op.object,
                  contentWidth,
                  op.role ?? 'cuerpo',
                  pendingListStarts.get(canonical),
                )
              }
              const d = measureConceptLabel(op.label ?? op.object, contentWidth)
              return { width: d, height: d }
            }
            // Existing object in the scene.
            return measureExisting(id, contentWidth)
          }

          // Deterministic board placement: build the ordered BoardItem list from the
          // objects ALREADY placed (insertion order = arrival order) PLUS the new one,
          // and resolve all the geometry. The boxes of existing objects are updated
          // with `placed` (full reflow). For an *append* with no group or a new group
          // the result is stable: nobody moves. Only growing an existing group
          // relocates later content (a deliberate exception to "never move placed
          // objects").
          const boardItems: BoardItem[] = []
          for (const [existingId, existing] of objects) {
            let g: string | null = null
            for (const [groupId, grp] of groups) {
              if (grp.members.includes(existingId)) {
                g = groupId
                break
              }
            }
            boardItems.push({
              id: existingId,
              isText: existing.object === 'texto',
              group: g,
              role: existing.role,
              isConcept: existing.object === 'concepto',
              attachGroup: existing.layoutAttach ?? null,
              nearId: existing.layoutNear ?? null,
            })
          }
          boardItems.push({
            id: canonical,
            isText: op.object === 'texto',
            group: newGroup,
            role: op.object === 'texto' ? (op.role ?? 'cuerpo') : null,
            isConcept: op.object === 'concepto',
          })

          const plan = planBoard(
            flagOpenQuestion(boardItems, (i) => (i === canonical ? (op.text ?? op.label) : (objects.get(i)?.text ?? objects.get(i)?.label))),
          )
          // The env's areaTree (from the active page) is passed through; runLayout
          // falls back to defaultAreaTree(3) if the caller did not inject one.
          const placed = runLayout(plan, measureFn, {
            id: canonical,
            isText: op.object === 'texto',
            role: op.object === 'texto' ? (op.role ?? 'cuerpo') : null,
            text: op.text ?? op.label ?? op.object,
          })
          // The hidden open question is not part of the plan (it gets no layout box):
          // it keeps an inert box with its measured size, at the body origin.
          const box = placed.get(canonical) ?? { x: 0, y: 0, ...measureFn(canonical, env.canvas.width - 2 * STANDARD_MARGIN) }
          const newFragments = lastFragments.get(canonical)
          const newListStart = pendingListStarts.get(canonical)

          // Full reflow: update the boxes of all existing objects. For an *append*
          // (new object with no group, or a new group) forward filling is stable ->
          // identical boxes, nobody moves. Only growing an existing group moves
          // content (intended). Applied BEFORE inserting the new object into
          // `objects` so it does not interfere with the collision-rename loop.
          for (const [existingId, existingObj] of objects) {
            objects.set(existingId, withPlacement(existingObj, placed.get(existingId), lastFragments))
          }

          const sceneObj: SceneObject = {
            id: canonical,
            object: op.object,
            label: op.label ?? null,
            text: op.text ?? null,
            // Semantic role: only for 'texto' objects; null for the rest.
            role: op.object === 'texto' ? (op.role ?? 'cuerpo') : null,
            box,
            ...(newFragments !== undefined ? { fragments: newFragments } : {}),
            ...(newListStart !== undefined && newListStart !== 1 ? { listStart: newListStart } : {}),
            // Computed fontSize (title only). Internal, not part of the contract.
            ...(fittedFontSize !== undefined ? { fontSize: fittedFontSize } : {}),
          }

          objects.set(canonical, sceneObj)
          batchNew.add(canonical)

          // add.group: membership declared at creation time
          if (op.group !== undefined) {
            const suggestedGroupId = op.group
            const resolvedGroupId = resolveAlias(suggestedGroupId)

            if (groups.has(resolvedGroupId)) {
              // The group already exists -> add the new object as a member (create-or-grow)
              const existingGrp = groups.get(resolvedGroupId)!
              if (!existingGrp.members.includes(canonical)) {
                groups.set(resolvedGroupId, {
                  ...existingGrp,
                  members: [...existingGrp.members, canonical],
                })
              }
            } else {
              // The group does not exist -> create it with this object as first member
              const canonicalGroupId = canonicalId(suggestedGroupId, 'grupo')
              const newGrp: SceneGroup = {
                id: canonicalGroupId,
                label: null,
                members: [canonical],
              }
              groups.set(canonicalGroupId, newGrp)
              // Emit the group-created event
              events.push({ type: 'group', id: canonicalGroupId })
            }
          }

          events.push({ type: 'draw_object', id: canonical })
          break
        }

        // ── 3.2 connect ────────────────────────────────────────────────────────
        case 'connect': {
          const fromId = resolveAlias(op.from)
          const toId = resolveAlias(op.to)

          // Verify the endpoints exist (defense in depth)
          const fromExists = objects.has(fromId) || groups.has(fromId)
          const toExists = objects.has(toId) || groups.has(toId)

          if (!fromExists) {
            warnings.push(`connect "${op.id}": from "${fromId}" does not exist in the scene`)
            break
          }
          if (!toExists) {
            warnings.push(`connect "${op.id}": to "${toId}" does not exist in the scene`)
            break
          }

          const canonical = canonicalId(op.id, 'flecha')

          // curve, from_anchor, to_anchor do not come from the agent; the optional
          // SceneConnection fields remain available for app use.
          const conn: SceneConnection = {
            id: canonical,
            from: fromId,
            to: toId,
            style: op.style,
            label: op.label ?? null,
          }

          connections.set(canonical, conn)
          attachLooseFigure(fromId, toId)
          events.push({ type: 'draw_connection', id: canonical })
          break
        }

        // ── 3.3 label ──────────────────────────────────────────────────────────
        case 'label': {
          const ref = resolveAlias(op.ref)

          // op.placement does not exist; labelPlacement on SceneObject remains
          // available for app use.
          if (objects.has(ref)) {
            const obj = objects.get(ref)!
            const updated: SceneObject = {
              ...obj,
              label: op.text,
            }
            objects.set(ref, updated)
            events.push({ type: 'set_label', ref })
          } else if (connections.has(ref)) {
            const conn = connections.get(ref)!
            connections.set(ref, { ...conn, label: op.text })
            events.push({ type: 'set_label', ref })
          } else if (groups.has(ref)) {
            const grp = groups.get(ref)!
            groups.set(ref, { ...grp, label: op.text })
            events.push({ type: 'set_label', ref })
          } else {
            warnings.push(`label: ref "${ref}" does not exist in the scene`)
          }
          break
        }

        // ── 3.4 highlight ──────────────────────────────────────────────────────
        case 'highlight': {
          // Gesture cycles per kind of referent
          const TEXT_GESTURE_CYCLE = ['underline', 'ellipse', 'arrow'] as const
          const FIGURE_GESTURE_CYCLE = ['ellipse', 'underline', 'arrow'] as const

          // Accumulator of highlights created in this batch (for the event)
          const createdHighlights: Array<{ id: string; ref: string; word?: string }> = []

          for (const entry of op.refs) {
            const rawId = typeof entry === 'string' ? entry : entry.ref
            const word = typeof entry === 'string' ? undefined : entry.word
            const ref = resolveAlias(rawId)

            if (!objects.has(ref) && !connections.has(ref) && !groups.has(ref)) {
              warnings.push(`highlight: ref "${ref}" does not exist in the scene`)
              continue
            }

            // Idempotent: if a live highlight already exists for (ref, word) no other is
            // created (a repeated concentric oval clutters the board). Deleting/moving
            // stay tied to the object: the existing one is kept as is.
            const alreadyHighlighted =
              Array.from(highlights.values()).some(h => h.ref === ref && h.word === word)
            if (alreadyHighlighted) continue

            // Pick the gesture from the cycle by how many highlights already point at
            // this ref (existing ones + those already created in this batch)
            const existingCountForRef = Array.from(highlights.values()).filter(h => h.ref === ref).length
            const batchCountForRef = createdHighlights.filter(h => h.ref === ref).length
            const totalUsed = existingCountForRef + batchCountForRef

            // Referent kind: text -> TEXT_GESTURE_CYCLE; anything else -> FIGURE_GESTURE_CYCLE
            const isTextRef = objects.get(ref)?.object === 'texto'
            const cycle = isTextRef ? TEXT_GESTURE_CYCLE : FIGURE_GESTURE_CYCLE
            // Once all are used, stay on the last one (index 2)
            const gestureIndex = Math.min(totalUsed, cycle.length - 1)
            const gesture = cycle[gestureIndex]!

            // Generate a canonical id in the format highlight_<page>_<n>
            const suggestedId = `highlight_${activePage}_${highlights.size + createdHighlights.length + 1}`
            const canonicalHid = canonicalId(suggestedId, 'highlight')

            const sceneHighlight: SceneHighlight = {
              id: canonicalHid,
              ref,
              gesture,
              word,
            }
            highlights.set(canonicalHid, sceneHighlight)
            createdHighlights.push({ id: canonicalHid, ref, word })
          }

          if (createdHighlights.length > 0) {
            events.push({ type: 'highlight', highlights: createdHighlights })
          }
          break
        }

        // ── 3.5 group ──────────────────────────────────────────────────────────
        case 'group': {
          const resolvedGroupId = resolveAlias(op.id)
          const resolvedMembers: string[] = []

          for (const memberId of op.members) {
            const resolved = resolveAlias(memberId)

            // No nesting: a group as a member -> warning and it is skipped
            if (groups.has(resolved)) {
              warnings.push(
                `group "${op.id}": member "${resolved}" is a group; skipped (no nesting)`,
              )
              continue
            }

            if (!objects.has(resolved)) {
              warnings.push(
                `group "${op.id}": member "${resolved}" does not exist in the scene; skipped`,
              )
              continue
            }

            resolvedMembers.push(resolved)
          }

          if (resolvedMembers.length === 0) {
            warnings.push(`group "${op.id}": no valid member; operation ignored`)
            break
          }

          // create-or-grow: if the group already exists, MERGE members instead of creating another.
          if (groups.has(resolvedGroupId)) {
            const existingGrp = groups.get(resolvedGroupId)!
            const newMembers = resolvedMembers.filter(
              (m) => !existingGrp.members.includes(m),
            )
            if (newMembers.length > 0) {
              groups.set(resolvedGroupId, {
                ...existingGrp,
                members: [...existingGrp.members, ...newMembers],
              })
            }
            // If op.label is set, also update the group's label
            if (op.label !== undefined) {
              groups.set(resolvedGroupId, {
                ...groups.get(resolvedGroupId)!,
                label: op.label,
              })
            }
            events.push({ type: 'group', id: resolvedGroupId })
          } else {
            // New group
            const canonical = canonicalId(op.id, 'grupo')
            const grp: SceneGroup = {
              id: canonical,
              label: op.label ?? null,
              members: resolvedMembers,
            }
            groups.set(canonical, grp)
            events.push({ type: 'group', id: canonical })
          }
          break
        }

        // ── 3.5 ungroup ────────────────────────────────────────────────────────
        case 'ungroup': {
          const ref = resolveAlias(op.ref)

          if (!groups.has(ref)) {
            warnings.push(`ungroup: ref "${ref}" is not a group or does not exist`)
            break
          }

          // Dissolves the group without deleting the members
          groups.delete(ref)
          events.push({ type: 'ungroup', id: ref })
          break
        }

        // ── 3.6 update ─────────────────────────────────────────────────────────
        case 'update': {
          const ref = resolveAlias(op.ref)
          const set = op.set

          if (groups.has(ref)) {
            // Update on a group: the label applies to the group only.
            const grp = groups.get(ref)!

            if (set.label !== undefined) {
              groups.set(ref, { ...grp, label: set.label })
              events.push({ type: 'update', id: ref })
            }

            if (set.text !== undefined) {
              // "text" makes no sense on a group; quiet warning
              warnings.push(`update group "${ref}": set.text ignored on a group`)
            }
          } else if (objects.has(ref)) {
            const obj = objects.get(ref)!
            const prevText = obj.text ?? null
            applyObjectUpdate(
              ref,
              obj,
              set,
              objects,
              warnings,
            )
            let extendedFrom: string | undefined
            if (obj.object === 'texto' && set.text !== undefined && set.text !== prevText) {
              // The text changed size: re-measure and re-place (later blocks in the
              // column move down; earlier ones do not move).
              relayoutAll()
              if (prevText !== null && extensionSuffix(prevText, set.text) !== null) {
                extendedFrom = prevText
              }
            }
            events.push(
              extendedFrom !== undefined
                ? { type: 'update', id: ref, extendedFrom }
                : { type: 'update', id: ref },
            )
          } else if (connections.has(ref)) {
            // Connections only support label in update
            const conn = connections.get(ref)!
            if (set.label !== undefined) {
              connections.set(ref, { ...conn, label: set.label })
              events.push({ type: 'update', id: ref })
            } else {
              warnings.push(
                `update connection "${ref}": only set.label is supported for connections`,
              )
            }
          } else {
            warnings.push(`update: ref "${ref}" does not exist in the scene`)
          }
          break
        }

        // ── 3.7 delete ─────────────────────────────────────────────────────────
        case 'delete': {
          const ref = resolveAlias(op.ref)
          const removedIds: string[] = []

          if (objects.has(ref)) {
            // Cascade: connections pointing at this object
            const cascadedConnections = findConnectionsOf(ref, connections)
            for (const connId of cascadedConnections) {
              connections.delete(connId)
              removedIds.push(connId)
            }

            // Remove from all groups (an empty group is removed)
            removeFromGroups(ref, groups, removedIds)

            // Cascade: highlights pointing at this object
            removeHighlightsOf(ref, highlights, removedIds)

            objects.delete(ref)
            removedIds.push(ref)

          } else if (groups.has(ref)) {
            // Deleting a group removes the group AND its members
            const grp = groups.get(ref)!

            for (const memberId of grp.members) {
              if (!objects.has(memberId)) continue

              // Cascade: the member's connections
              const cascadedConnections = findConnectionsOf(memberId, connections)
              for (const connId of cascadedConnections) {
                connections.delete(connId)
                removedIds.push(connId)
              }

              // Cascade: each member's highlights
              removeHighlightsOf(memberId, highlights, removedIds)

              objects.delete(memberId)
              removedIds.push(memberId)
            }

            // Cascade: the group's own highlights
            removeHighlightsOf(ref, highlights, removedIds)

            groups.delete(ref)
            removedIds.push(ref)

          } else if (connections.has(ref)) {
            // Cascade: the connection's highlights
            removeHighlightsOf(ref, highlights, removedIds)

            connections.delete(ref)
            removedIds.push(ref)
          } else {
            warnings.push(`delete: ref "${ref}" does not exist in the scene`)
            break
          }

          events.push({ type: 'remove', ids: removedIds })
          break
        }

        // ── 3.8 clear ──────────────────────────────────────────────────────────
        case 'clear': {
          objects.clear()
          connections.clear()
          groups.clear()
          highlights.clear()
          events.push({ type: 'clear' })
          break
        }
      }
    } catch (err) {
      // Never throw
      warnings.push(
        `Unexpected error processing op "${op.op}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    scene: { objects, connections, groups, highlights },
    events,
    warnings,
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Applies set.label and set.text to a scene object.
 * Mutates the objects Map directly (it is already a copy of the original).
 */
function applyObjectUpdate(
  id: string,
  obj: SceneObject,
  set: {
    label?: string
    text?: string
  },
  objects: Map<string, SceneObject>,
  _warnings: string[],
): void {
  let updated = { ...obj }

  // set.label: update the label
  if (set.label !== undefined) {
    updated = { ...updated, label: set.label }
  }

  // set.text: update the text (only meaningful for "texto")
  if (set.text !== undefined) {
    updated = { ...updated, text: set.text }
  }

  objects.set(id, updated)
}

/**
 * Returns the ids of the connections whose from or to matches the given id.
 */
function findConnectionsOf(
  id: string,
  connections: Map<string, SceneConnection>,
): string[] {
  const result: string[] = []
  for (const [connId, conn] of connections) {
    if (conn.from === id || conn.to === id) {
      result.push(connId)
    }
  }
  return result
}

/**
 * Removes every highlight whose ref points at the given id.
 * Appends the removed highlight ids to removedIds.
 */
function removeHighlightsOf(
  id: string,
  highlights: Map<string, import('./model.js').SceneHighlight>,
  removedIds: string[],
): void {
  for (const [hid, h] of highlights) {
    if (h.ref === id) {
      highlights.delete(hid)
      removedIds.push(hid)
    }
  }
}

/**
 * Removes an object from every group where it is a member.
 * If a group ends up empty, it is deleted too.
 * Appends the deleted group ids to removedIds.
 */
function removeFromGroups(
  id: string,
  groups: Map<string, SceneGroup>,
  removedIds: string[],
): void {
  for (const [groupId, grp] of groups) {
    if (grp.members.includes(id)) {
      const remaining = grp.members.filter((m) => m !== id)
      if (remaining.length === 0) {
        groups.delete(groupId)
        removedIds.push(groupId)
      } else {
        groups.set(groupId, { ...grp, members: remaining })
      }
    }
  }
}


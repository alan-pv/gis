/**
 * Area model: panel partition (binary split tree).
 *
 * The board is recursively divided into rectangular areas whose union always
 * covers the body rectangle exactly (no gaps, no overlaps). Inspired by the
 * tmux/VSCode tile model.
 *
 * Pure module: no Konva, no React, no DOM.
 * Deterministic geometry: same input gives the same output.
 *
 * Core rule: the agent never sees or manages areas. Area geometry belongs
 * exclusively to the app.
 *
 * Deterministic ID scheme
 * ─────────────────────────────
 *   Leaves : 'area_1', 'area_2', …, 'area_n'  (left to right in the default)
 *   Splits : 'split_1', 'split_2', …, 'split_{n-1}'
 *            split_1 is the root; split_2 is its right child; etc.
 *
 * Default tree for n=3 (3 equal columns):
 *   split_1 { dir:'v', ratio:1/3,
 *     a: area_1,
 *     b: split_2 { dir:'v', ratio:1/2,
 *          a: area_2,
 *          b: area_3 } }
 *
 * How the ratio works for n equal columns:
 *   At split level k (1-indexed), ratio = 1/(n-k+1).
 *   This divides the remaining space into equal fractions as the tree is
 *   unnested (split_1 takes 1/n of the total, split_2 takes 1/(n-1) of the
 *   remainder, etc.).
 */

import type { BBox } from './bbox.js'

// ── Types ────────────────────────────────────────────────────────────────────

/** Leaf node of the area tree. Represents a terminal panel. */
export interface AreaLeaf {
  kind: 'leaf'
  id: string
}

/**
 * Split node of the area tree.
 *
 * dir 'v' → vertical split: child `a` on the LEFT, child `b` on the RIGHT.
 *            `ratio` = fraction of the WIDTH taken by `a` (0 < ratio < 1).
 * dir 'h' → horizontal split: child `a` on TOP, child `b` at the BOTTOM.
 *            `ratio` = fraction of the HEIGHT taken by `a` (0 < ratio < 1).
 */
export interface AreaSplit {
  kind: 'split'
  id: string
  dir: 'v' | 'h'
  ratio: number
  a: AreaTree
  b: AreaTree
}

/** Area partition tree. */
export type AreaTree = AreaLeaf | AreaSplit

/** Result of computeAreaRects: area id + absolute bounding box. */
export interface AreaRect {
  id: string
  box: BBox
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum ratio when clamping in resizeSplit. */
const RATIO_MIN = 0.1
/** Maximum ratio when clamping in resizeSplit. */
const RATIO_MAX = 0.9

// ── defaultAreaTree ──────────────────────────────────────────────────────────

/**
 * Returns an AreaTree with `n` equal columns (nested vertical splits).
 *
 * IDs are stable and deterministic (see the scheme in the module header).
 *
 * Edge cases:
 *   n ≤ 1 → returns a single leaf `area_1`.
 *
 * @param n  Number of columns (default 3).
 */
export function defaultAreaTree(n = 3): AreaTree {
  if (n < 1) n = 1
  if (n === 1) return { kind: 'leaf', id: 'area_1' }

  // Build from right to left.
  // Rightmost pair: split_{n-1} { ratio:0.5, a:area_{n-1}, b:area_n }
  let tree: AreaTree = {
    kind: 'split',
    id: `split_${n - 1}`,
    dir: 'v',
    ratio: 0.5,
    a: { kind: 'leaf', id: `area_${n - 1}` },
    b: { kind: 'leaf', id: `area_${n}` },
  }

  // Para k = n-2 down to 1: split_k { ratio=1/(n-k+1), a:area_k, b:previous_tree }
  for (let k = n - 2; k >= 1; k--) {
    const ratio = 1 / (n - k + 1)
    tree = {
      kind: 'split',
      id: `split_${k}`,
      dir: 'v',
      ratio,
      a: { kind: 'leaf', id: `area_${k}` },
      b: tree,
    }
  }

  return tree
}

// ── computeAreaRects ─────────────────────────────────────────────────────────

/**
 * Walks the tree, recursively dividing `bodyRect`, and returns the list of
 * `{ id, box }` for all leaves.
 *
 * Guarantee: the union of the resulting boxes covers `bodyRect` exactly.
 * Rounding is applied to child `a` and `b` absorbs the remainder, removing
 * any gap caused by floating-point arithmetic.
 *
 * Emission order is depth-first (a before b); use `fillOrder` for the
 * canonical fill order.
 */
export function computeAreaRects(tree: AreaTree, bodyRect: BBox): AreaRect[] {
  if (tree.kind === 'leaf') {
    return [{ id: tree.id, box: bodyRect }]
  }

  const { dir, ratio, a, b } = tree

  if (dir === 'v') {
    // Vertical split: a = left, b = right.
    const widthA = Math.round(bodyRect.width * ratio)
    const widthB = bodyRect.width - widthA // absorbs the remainder (no gap)
    const boxA: BBox = {
      x: bodyRect.x,
      y: bodyRect.y,
      width: widthA,
      height: bodyRect.height,
    }
    const boxB: BBox = {
      x: bodyRect.x + widthA,
      y: bodyRect.y,
      width: widthB,
      height: bodyRect.height,
    }
    return [...computeAreaRects(a, boxA), ...computeAreaRects(b, boxB)]
  } else {
    // Horizontal split: a = top, b = bottom.
    const heightA = Math.round(bodyRect.height * ratio)
    const heightB = bodyRect.height - heightA // absorbs the remainder (no gap)
    const boxA: BBox = {
      x: bodyRect.x,
      y: bodyRect.y,
      width: bodyRect.width,
      height: heightA,
    }
    const boxB: BBox = {
      x: bodyRect.x,
      y: bodyRect.y + heightA,
      width: bodyRect.width,
      height: heightB,
    }
    return [...computeAreaRects(a, boxA), ...computeAreaRects(b, boxB)]
  }
}

// ── fillOrder ────────────────────────────────────────────────────────────────

/**
 * Sorts rects by `(box.x asc, then box.y asc)`: columns first, then top to
 * bottom. This order defines the body fill flow.
 *
 * For 3 columns: left → middle → right.
 * With a horizontal split inside a column: top → bottom.
 *
 * Stable and deterministic. Does not mutate the input array.
 */
export function fillOrder(rects: AreaRect[]): AreaRect[] {
  return [...rects].sort((rectA, rectB) => {
    if (rectA.box.x !== rectB.box.x) return rectA.box.x - rectB.box.x
    return rectA.box.y - rectB.box.y
  })
}

// ── splitLeaf ────────────────────────────────────────────────────────────────

/**
 * Returns a NEW (immutable) tree where leaf `leafId` is replaced by an
 * `AreaSplit{ id: newSplitId, dir, ratio, a: AreaLeaf{leafId}, b: AreaLeaf{newLeafId} }`.
 *
 * The original leaf (`leafId`) becomes child `a` of the new split and the
 * new leaf (`newLeafId`) is child `b`.
 *
 * If `leafId` is not in the tree, returns the original tree unchanged.
 * Does not throw (silent, non-mutating).
 */
export function splitLeaf(
  tree: AreaTree,
  leafId: string,
  dir: 'v' | 'h',
  newLeafId: string,
  newSplitId: string,
  ratio = 0.5,
): AreaTree {
  if (tree.kind === 'leaf') {
    if (tree.id === leafId) {
      return {
        kind: 'split',
        id: newSplitId,
        dir,
        ratio,
        a: { kind: 'leaf', id: leafId },
        b: { kind: 'leaf', id: newLeafId },
      }
    }
    return tree
  }

  // Split node: recurse into both children (only one will hit the target leaf).
  const newA = splitLeaf(tree.a, leafId, dir, newLeafId, newSplitId, ratio)
  const newB = splitLeaf(tree.b, leafId, dir, newLeafId, newSplitId, ratio)

  // Avoid creating a new object when nothing changed (preserves identity).
  if (newA === tree.a && newB === tree.b) return tree

  return { ...tree, a: newA, b: newB }
}

// ── removeLeaf ───────────────────────────────────────────────────────────────

/**
 * Returns a NEW (immutable) tree where, if `leafId` is a direct child of a
 * split, that split COLLAPSES and the SIBLING takes the split's place.
 *
 * Edge cases:
 *   - `leafId` is the only remaining leaf (root leaf): returns the tree
 *     unchanged. The tree can never be emptied.
 *   - `leafId` does not exist: returns the tree unchanged.
 *
 * The search is top-down: if `leafId` is a grandchild or deeper, the function
 * recurses until it finds the split whose direct child is `leafId`.
 */
export function removeLeaf(tree: AreaTree, leafId: string): AreaTree {
  if (tree.kind === 'leaf') {
    // The only remaining leaf cannot be removed.
    return tree
  }

  // Is direct child `a` the leaf to remove?
  if (tree.a.kind === 'leaf' && tree.a.id === leafId) {
    return tree.b
  }

  // Is direct child `b` the leaf to remove?
  if (tree.b.kind === 'leaf' && tree.b.id === leafId) {
    return tree.a
  }

  // Recurse: the leaf is deeper down.
  const newA = removeLeaf(tree.a, leafId)
  const newB = removeLeaf(tree.b, leafId)

  if (newA === tree.a && newB === tree.b) return tree

  return { ...tree, a: newA, b: newB }
}

// ── resizeSplit ───────────────────────────────────────────────────────────────

/**
 * Returns a NEW (immutable) tree with the `ratio` of split `splitId` set to
 * the given value, clamped to [RATIO_MIN, RATIO_MAX] = [0.1, 0.9].
 *
 * If `splitId` does not exist, returns the tree unchanged.
 */
export function resizeSplit(tree: AreaTree, splitId: string, ratio: number): AreaTree {
  if (tree.kind === 'leaf') return tree

  const clampedRatio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, ratio))

  if (tree.id === splitId) {
    return { ...tree, ratio: clampedRatio }
  }

  const newA = resizeSplit(tree.a, splitId, ratio)
  const newB = resizeSplit(tree.b, splitId, ratio)

  if (newA === tree.a && newB === tree.b) return tree

  return { ...tree, a: newA, b: newB }
}

// ── computeDividers ───────────────────────────────────────────────────────────

/**
 * Descriptor of a divider between the two sub-areas of a Split node.
 *
 * For dir 'v' (vertical line):
 *   `x` = x coordinate of the line, `y` = top edge of the node, `length` = node height.
 * For dir 'h' (horizontal line):
 *   `y` = y coordinate of the line, `x` = left edge of the node, `length` = node width.
 *
 * `nodeRect` is the BBox of the Split node; dragging uses it to recompute the ratio:
 *   dir 'v': ratio = (centerX - nodeRect.x) / nodeRect.width
 *   dir 'h': ratio = (centerY - nodeRect.y) / nodeRect.height
 */
export interface AreaDivider {
  splitId: string
  dir: 'v' | 'h'
  x: number
  y: number
  length: number
  nodeRect: BBox
}

/**
 * Walks the tree dividing `rect` the same way as `computeAreaRects` and emits
 * one `AreaDivider` per Split node.
 *
 * - dir 'v': vertical line at x = nodeRect.x + round(nodeRect.width*ratio).
 * - dir 'h': horizontal line at y = nodeRect.y + round(nodeRect.height*ratio).
 *
 * Rounding uses the same formula as `computeAreaRects` (child `a` = round,
 * `b` absorbs the remainder), so the divider's x/y matches the boundary
 * between the `computeAreaRects` boxes exactly.
 *
 * Pure, no side effects. Mutates neither the tree nor the rect.
 */
export function computeDividers(tree: AreaTree, rect: BBox): AreaDivider[] {
  if (tree.kind === 'leaf') return []

  const { dir, ratio, a, b } = tree
  const dividers: AreaDivider[] = []

  if (dir === 'v') {
    const widthA = Math.round(rect.width * ratio)
    dividers.push({
      splitId: tree.id,
      dir: 'v',
      x: rect.x + widthA,
      y: rect.y,
      length: rect.height,
      nodeRect: rect,
    })
    const boxA: BBox = { x: rect.x, y: rect.y, width: widthA, height: rect.height }
    const boxB: BBox = { x: rect.x + widthA, y: rect.y, width: rect.width - widthA, height: rect.height }
    dividers.push(...computeDividers(a, boxA))
    dividers.push(...computeDividers(b, boxB))
  } else {
    const heightA = Math.round(rect.height * ratio)
    dividers.push({
      splitId: tree.id,
      dir: 'h',
      x: rect.x,
      y: rect.y + heightA,
      length: rect.width,
      nodeRect: rect,
    })
    const boxA: BBox = { x: rect.x, y: rect.y, width: rect.width, height: heightA }
    const boxB: BBox = { x: rect.x, y: rect.y + heightA, width: rect.width, height: rect.height - heightA }
    dividers.push(...computeDividers(a, boxA))
    dividers.push(...computeDividers(b, boxB))
  }

  return dividers
}

/**
 * Should a divider's dashed line be drawn?
 *
 * The line is hidden while the "right" (dir 'v') or "bottom" (dir 'h') side of
 * the divider (the column/row about to be used) contains no object, so the
 * board never shows announced-but-empty columns. The drag HANDLE does not
 * depend on this (it still exists, invisible). `occupied` are the boxes of the
 * scene objects. Pure.
 */
export function isDividerVisible(div: AreaDivider, occupied: readonly BBox[]): boolean {
  const n = div.nodeRect
  const side: BBox = div.dir === 'v'
    ? { x: div.x, y: n.y, width: n.x + n.width - div.x, height: n.height }
    : { x: n.x, y: div.y, width: n.width, height: n.y + n.height - div.y }
  return occupied.some(b =>
    b.x < side.x + side.width && b.x + b.width > side.x &&
    b.y < side.y + side.height && b.y + b.height > side.y,
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the IDs of all leaves of the tree, in depth-first order
 * (a before b).
 */
export function leafIds(tree: AreaTree): string[] {
  if (tree.kind === 'leaf') return [tree.id]
  return [...leafIds(tree.a), ...leafIds(tree.b)]
}

/**
 * Returns the IDs of all splits of the tree, in depth-first order
 * (root first).
 */
export function splitIds(tree: AreaTree): string[] {
  if (tree.kind === 'leaf') return []
  return [tree.id, ...splitIds(tree.a), ...splitIds(tree.b)]
}

// ── nextAreaIds ───────────────────────────────────────────────────────────────

/**
 * Returns the next free ids for a leaf (`leafId`) and a split (`splitId`)
 * that do NOT collide with those already in the tree.
 *
 * Deterministic algorithm:
 *   - Extracts the numeric suffix of each existing id matching `area_N`
 *     and `split_N` respectively.
 *   - Returns `area_{maxLeaf+1}` and `split_{maxSplit+1}`.
 *
 * Guarantee: the returned ids are in neither `leafIds(tree)` nor
 * `splitIds(tree)`, and passing them to `splitLeaf` yields a tree with no
 * id collisions.
 *
 * Pure: does not mutate the tree.
 */
export function nextAreaIds(tree: AreaTree): { leafId: string; splitId: string } {
  const numericSuffix = (id: string, prefix: string): number => {
    const m = id.match(new RegExp(`^${prefix}_(\\d+)$`))
    return m ? parseInt(m[1]!, 10) : 0
  }

  const maxLeaf = leafIds(tree)
    .map((id) => numericSuffix(id, 'area'))
    .reduce((a, b) => Math.max(a, b), 0)

  const maxSplit = splitIds(tree)
    .map((id) => numericSuffix(id, 'split'))
    .reduce((a, b) => Math.max(a, b), 0)

  return {
    leafId: `area_${maxLeaf + 1}`,
    splitId: `split_${maxSplit + 1}`,
  }
}

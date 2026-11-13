/**
 * Layout engine: public module.
 *
 * Includes the deterministic bansho geometry: vertical fill first, with the
 * opening strip and body blocks stacked in a single flow, wrapping a whole
 * block when it does not fit vertically.
 *
 * Pure module: no Konva, no React, no DOM.
 * Deterministic geometry: same input gives the same output.
 *
 * Uso:
 *   import { layoutPlan, STANDARD_MARGIN } from '@/layout/index.js'
 *   import type { BBox } from '@/layout/index.js'
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type { BBox, Canvas, Size } from './bbox.js'
export type { BoardItem, BoardPlan } from './bansho-board.js'
export type { TextFragment } from './bansho-geometry.js'

// ── Main API ─────────────────────────────────────────────────────────────

/**
 * Deterministic bansho geometry: places a BoardPlan into real boxes, filling
 * vertically first and wrapping per block. Stable: adding objects never moves
 * the ones already placed.
 */
export { layoutPlan, STANDARD_MARGIN, TITLE_BAND_HEIGHT, DATE_RESERVE, computeBodyRect } from './bansho-geometry.js'

/**
 * Pure bansho board structure: maps objects, in arrival order, to the opening
 * strip and to body blocks (grouped by section). No geometry (placement is
 * layoutPlan's job).
 */
export { planBoard } from './bansho-board.js'

/**
 * Area model: panel partition (binary split tree), tmux/VSCode style.
 * Pure, no Konva/React/DOM.
 *
 * The agent never sees or manages areas: geometry belongs exclusively to the app.
 */
export type { AreaTree, AreaDivider } from './areas.js'
export {
  defaultAreaTree,
  computeAreaRects,
  computeDividers,
  isDividerVisible,
  splitLeaf,
  removeLeaf,
  resizeSplit,
  leafIds,
  nextAreaIds,
} from './areas.js'

/**
 * golden-helpers.ts — shared helpers of the golden-example tests.
 *
 * All helpers are pure, parameterized functions with no module state.
 * Importing vitest here is fine: this is a test module, not production code.
 */
import { expect } from 'vitest'
import { validateAgentOutput } from '@/validator/index.js'
import type { ValidationContext, ValidationMode, RejectedOperation } from '@/validator/index.js'
import { applyOperations, type SceneEnv, type SceneEvent } from '@/scene/index.js'
import { allIds, type Scene } from '@/scene/index.js'

// ── Type re-exports ─────────────────────────────────────────────────

export type { SceneEnv, SceneEvent }

// ── Canvas constant ──────────────────────────────────────────────────────────

export const CANVAS = { width: 1200, height: 900 }

// ── makeValidationCtx ─────────────────────────────────────────────────────────

/**
 * Builds the ValidationContext from the scene's current state.
 */
export function makeValidationCtx(scene: Scene, mode: ValidationMode = 'live'): ValidationContext {
  return {
    mode,
    pageIds: allIds(scene),
  }
}

// ── applyGoldenEnvelope ───────────────────────────────────────────────────────

/**
 * Applies a raw envelope to the current state: validates → applies → returns the
 * full result including the whole `rejected` array (not just the count) so the
 * e2e test can log the reason for each rejection.
 */
export function applyGoldenEnvelope(
  scene: Scene,
  rawEnvelope: unknown,
  env: SceneEnv,
  mode: ValidationMode = 'live',
): { scene: Scene; events: SceneEvent[]; warnings: string[]; rejected: RejectedOperation[] } {
  const ctx = makeValidationCtx(scene, mode)
  const { accepted, rejected } = validateAgentOutput(rawEnvelope, ctx)
  const result = applyOperations(scene, accepted, env)
  return { ...result, rejected }
}

// ── checkNoCollisions ─────────────────────────────────────────────────────────

/**
 * No-collision check between the bounding boxes of all objects.
 * A 1px margin avoids false positives from rounding.
 */
export function checkNoCollisions(scene: Scene): void {
  const objs = Array.from(scene.objects.values())
  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i]!.box
      const b = objs[j]!.box
      const overlaps =
        a.x < b.x + b.width - 1 &&
        a.x + a.width > b.x + 1 &&
        a.y < b.y + b.height - 1 &&
        a.y + a.height > b.y + 1
      expect(
        overlaps,
        `Collision between "${objs[i]!.id}" and "${objs[j]!.id}"`,
      ).toBe(false)
    }
  }
}

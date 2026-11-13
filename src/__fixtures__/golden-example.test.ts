/**
 * Replay test of golden example #1, the water cycle.
 *
 * Feeds the 9 operation lists in sequence into a scene that starts empty and
 * checks the complete diagram, with no duplicates and no collisions (the project's
 * acceptance criterion).
 *
 * No Konva and no browser: pure pipeline validator → applyOperations → buildTimeline.
 * If an assert fails because of real engine behavior (e.g. a legitimate layout
 * collision), neither the engine nor the fixture is modified: the failure is
 * reported as is.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { applyOperations, type SceneEnv, type SceneEvent } from '@/scene/index.js'
import { emptyScene, type Scene } from '@/scene/index.js'
import { sceneToAgentState } from '@/scene/index.js'
import { buildTimeline } from '@/animation/timeline.js'
import { CanvasStateSchema } from '@/contract/index.js'
import fixtureEntries from './golden-1.json'
import { CANVAS, makeValidationCtx, checkNoCollisions } from './golden-helpers.js'
import { validateAgentOutput } from '@/validator/index.js'

// ── Environment ───────────────────────────────────────────────────────────────────

let library: ReturnType<typeof loadLibrary>
let env: SceneEnv

beforeAll(() => {
  library = loadLibrary()
  env = { canvas: CANVAS, library }
})

// ── Local types ─────────────────────────────────────────────────────────────

interface FixtureEntry {
  utterance: string
  envelope: unknown
}

// ── Local helper ──────────────────────────────────────────────────────────────

/**
 * Applies a raw envelope to the current state: validates → applies → returns the
 * full result including `rejected` for the test's asserts.
 */
function applyEnvelope(
  scene: Scene,
  rawEnvelope: unknown,
): { scene: Scene; events: SceneEvent[]; warnings: string[]; rejectedCount: number } {
  const ctx = makeValidationCtx(scene)
  const { accepted, rejected } = validateAgentOutput(rawEnvelope, ctx)
  const result = applyOperations(scene, accepted, env)
  return { ...result, rejectedCount: rejected.length }
}

// ── Main test ──────────────────────────────────────────────────────────

describe('golden example #1 — water cycle (9 utterances)', () => {
  it('full replay: 9 envelopes in sequence → correct diagram, no duplicates or collisions', () => {
    let scene = emptyScene()
    const entries = fixtureEntries as FixtureEntry[]

    // ── Envelope 1: Title ────────────────────────────────────────────────────
    // "today I'm gonna talk to you about the water cycle…"
    {
      const r = applyEnvelope(scene, entries[0]!.envelope)
      expect(r.rejectedCount, 'envelope 1: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 1: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 1: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 1: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
      checkNoCollisions(scene)
    }

    // ── Envelope 2: Sun + Sea ─────────────────────────────────────────────────
    // "it starts with our friend the sun… goes off to the sea…"
    {
      const r = applyEnvelope(scene, entries[1]!.envelope)
      expect(r.rejectedCount, 'envelope 2: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 2: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 2: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 2: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
      checkNoCollisions(scene)
    }

    // ── Envelope 3: Cloud + evaporation arrow (no label yet) ────────────────
    // "the gas part evaporates and goes up up toward the gas"
    {
      const r = applyEnvelope(scene, entries[2]!.envelope)
      expect(r.rejectedCount, 'envelope 3: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 3: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 3: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 3: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
      checkNoCollisions(scene)
    }

    // ── Envelope 4: Label "evaporation" on flecha_1 ───────────────────────
    // "it's called… evapor ration" (ASR robustness)
    {
      const r = applyEnvelope(scene, entries[3]!.envelope)
      expect(r.rejectedCount, 'envelope 4: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 4: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 4: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 4: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
    }

    // ── Envelope 5: Highlight (recap) ────────────────────────────────
    // "remember the sun heats up the water from the sea…"
    {
      const r = applyEnvelope(scene, entries[4]!.envelope)
      expect(r.rejectedCount, 'envelope 5: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 5: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 5: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 5: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
    }

    // ── Envelope 6: Label "condensation" on nube_1 ────────────────────────
    // "that process is called condensation"
    {
      const r = applyEnvelope(scene, entries[5]!.envelope)
      expect(r.rejectedCount, 'envelope 6: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 6: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 6: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 6: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
    }

    // ── Envelope 7: Rain under the cloud ──────────────────────────────────────
    // "the little raindrops… start to fall"
    {
      const r = applyEnvelope(scene, entries[6]!.envelope)
      expect(r.rejectedCount, 'envelope 7: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 7: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 7: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 7: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
      checkNoCollisions(scene)
    }

    // ── Envelope 8: Precipitation arrow rain→sea ───────────────────────────
    // "it's called precipitation… falls back down to the sea"
    {
      const r = applyEnvelope(scene, entries[7]!.envelope)
      expect(r.rejectedCount, 'envelope 8: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 8: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 8: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 8: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
      checkNoCollisions(scene)
    }

    // ── Envelope 9: Final highlight (full recap) ────────────────────
    // "makes up the water cycle evaporation condensation and precipitation"
    {
      const r = applyEnvelope(scene, entries[8]!.envelope)
      expect(r.rejectedCount, 'envelope 9: rejected operations').toBe(0)
      expect(r.warnings, 'envelope 9: applyOperations warnings').toHaveLength(0)
      expect(r.events.length, 'envelope 9: non-empty script').toBeGreaterThan(0)
      const steps = buildTimeline(r.events, r.scene, library)
      expect(steps.length, 'envelope 9: non-empty timeline').toBeGreaterThan(0)
      scene = r.scene
    }

    // ── Final scene checks ───────────────────────────────────────

    // Exactly 5 objects: titulo_1, sol_1, mar_1, nube_1, lluvia_1
    expect(scene.objects.size, 'final scene: number of objects').toBe(5)
    expect(scene.objects.has('titulo_1'), 'escena final: titulo_1 present').toBe(true)
    expect(scene.objects.has('sol_1'), 'escena final: sol_1 present').toBe(true)
    expect(scene.objects.has('mar_1'), 'escena final: mar_1 present').toBe(true)
    expect(scene.objects.has('nube_1'), 'escena final: nube_1 present').toBe(true)
    expect(scene.objects.has('lluvia_1'), 'escena final: lluvia_1 present').toBe(true)

    // Exactly 2 connections: flecha_1, flecha_2
    expect(scene.connections.size, 'final scene: number of connections').toBe(2)
    expect(scene.connections.has('flecha_1'), 'escena final: flecha_1 present').toBe(true)
    expect(scene.connections.has('flecha_2'), 'escena final: flecha_2 present').toBe(true)

    // Correct labels
    expect(
      scene.connections.get('flecha_1')!.label,
      'flecha_1 label: evaporation',
    ).toBe('evaporation')
    expect(
      scene.objects.get('nube_1')!.label,
      'nube_1 label: **condensation** (bold: the scene keeps the markup)',
    ).toBe('**condensation**')
    expect(
      scene.connections.get('flecha_2')!.label,
      'flecha_2 label: precipitation',
    ).toBe('precipitation')

    // No collisions between any pair of objects
    checkNoCollisions(scene)

    // sceneToAgentState parses without error against the state schema
    const agentState = sceneToAgentState(scene, CANVAS, [
      'makes up the water cycle evaporation condensation and precipitation',
    ])
    const parseResult = CanvasStateSchema.safeParse(agentState)
    expect(parseResult.success, 'sceneToAgentState: parses against CanvasStateSchema').toBe(true)

    // The 5 objects and 2 connections appear in the agent state
    expect(agentState.objects.length, 'agentState: 5 objects').toBe(5)
    expect(agentState.connections.length, 'agentState: 2 connections').toBe(2)
  })
})

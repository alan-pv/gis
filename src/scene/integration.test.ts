/**
 * Integration test of the scene engine — seed of the golden acceptance test.
 *
 * Full pipeline: validator → applier with the REAL library.
 * Mini-script of the water cycle (4 envelopes in sequence):
 *
 *   1. Sol + Mar
 *   2. Cloud + evaporation arrow (add before the connect, no anchors)
 *   3. Condensation label on the cloud + highlight of the cycle
 *   4. Rain (no positional relation: the stub places by arrival order)
 *      + precipitation arrow
 *
 * Seed of a future golden acceptance test:
 * Once the 9 real utterances of the golden example are integrated, this test
 * grows to the 9 envelopes and the full diagram is verified.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { validateAgentOutput } from '@/validator/index.js'
import type { ValidationContext } from '@/validator/index.js'
import { applyOperations } from './apply.js'
import { sceneToAgentState } from './agent-state.js'
import { emptyScene, allIds } from './model.js'
import type { Scene } from './model.js'
import type { SceneEnv, SceneEvent } from './apply.js'
import { CanvasStateSchema } from '@/contract/index.js'
import type { Operation } from '@/contract/index.js'
import { STANDARD_MARGIN, DATE_RESERVE } from '@/layout/index.js'
import { TEXT_PADDING, fitTitleFontSize } from './text-measure.js'

// ── Environment ───────────────────────────────────────────────────────────────────

const CANVAS = { width: 1200, height: 800 }
let library: ReturnType<typeof loadLibrary>
let env: SceneEnv

beforeAll(() => {
  library = loadLibrary()
  env = { canvas: CANVAS, library }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds the ValidationContext from the scene's current state.
 */
function makeValidationCtx(scene: Scene): ValidationContext {
  return {
    mode: 'live',
    pageIds: allIds(scene),
  }
}

/**
 * Applies a raw envelope: validates → applies → returns the new scene and events.
 * Full validator → applier path.
 */
function applyEnvelope(
  scene: Scene,
  rawEnvelope: unknown,
): { scene: Scene; events: SceneEvent[]; warnings: string[] } {
  const ctx = makeValidationCtx(scene)
  const { accepted, rejected } = validateAgentOutput(rawEnvelope, ctx)

  // No rejections are expected here (the envelopes are valid by design)
  if (rejected.length > 0) {
    throw new Error(
      `Envelope rechazado inesperadamente: ${rejected.map((r) => r.reason).join('; ')}`,
    )
  }

  return applyOperations(scene, accepted, env)
}

/**
 * Checks that no boxes overlap between scene objects.
 * Uses a 1px margin to avoid rounding false positives.
 */
function checkNoCollisions(scene: Scene): void {
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

// ── Integration test ───────────────────────────────────────────────────────

describe('integration — water-cycle mini-script (real library)', () => {
  it('full pipeline: 4 envelopes → correct final scene, no collisions, correct events', () => {
    let scene = emptyScene()
    const allEvents: SceneEvent[] = []

    // ── Envelope 1: Sun + Sea ─────────────────────────────────────────────────
    // "The sun heats the sea surface"
    // no position (the layout engine decides it)
    const env1 = {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'sol_1', object: 'concepto', label: 'Sun' },
        { op: 'add', id: 'mar_1', object: 'concepto', label: 'Sea' },
      ] as Operation[],
    }

    const r1 = applyEnvelope(scene, env1)
    scene = r1.scene
    allEvents.push(...r1.events)

    expect(scene.objects.has('sol_1')).toBe(true)
    expect(scene.objects.has('mar_1')).toBe(true)
    checkNoCollisions(scene)

    // ── Envelope 2: Cloud + evaporation arrow ─────────────────────────────────
    // "This water evaporates and rises to the clouds" — add before the connect
    // no curve, from_anchor or to_anchor in connect
    const env2 = {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'nube_1', object: 'concepto', label: 'Cloud' },
        {
          op: 'connect',
          id: 'flecha_eva',
          from: 'mar_1',
          to: 'nube_1',
          style: 'arrow',
          label: 'evaporación',
        },
      ] as Operation[],
    }

    const r2 = applyEnvelope(scene, env2)
    scene = r2.scene
    allEvents.push(...r2.events)

    expect(scene.objects.has('nube_1')).toBe(true)
    expect(scene.connections.has('flecha_eva')).toBe(true)
    const eva = scene.connections.get('flecha_eva')!
    expect(eva.from).toBe('mar_1')
    expect(eva.to).toBe('nube_1')
    expect(eva.label).toBe('evaporación')
    // curve, from_anchor, to_anchor are not set from the op (the app handles them)
    checkNoCollisions(scene)

    // ── Envelope 3: Condensation label + Highlight ────────────────────────────
    // "That process is called condensation — look at the cloud and the arrow"
    // label without placement
    const env3 = {
      schema_version: '1.0',
      operations: [
        { op: 'label', ref: 'nube_1', text: 'condensación' },
        { op: 'highlight', refs: ['nube_1', 'flecha_eva'] },
      ] as Operation[],
    }

    const r3 = applyEnvelope(scene, env3)
    scene = r3.scene
    allEvents.push(...r3.events)

    expect(scene.objects.get('nube_1')!.label).toBe('condensación')
    // labelPlacement is not set from the op (the app handles it)
    const highlightEvt = r3.events.find((e) => e.type === 'highlight') as
      | { type: 'highlight'; highlights: Array<{ id: string; ref: string; word?: string }> }
      | undefined
    expect(highlightEvt).toBeDefined()
    expect(highlightEvt!.highlights.map(h => h.ref)).toContain('nube_1')
    expect(highlightEvt!.highlights.map(h => h.ref)).toContain('flecha_eva')
    checkNoCollisions(scene)

    // ── Envelope 4: Lluvia + precipitation arrow ─────────────────────────────
    // "And when the clouds fill up, the rain falls"
    // rain without a relational position; the stub places it by arrival order
    const env4 = {
      schema_version: '1.0',
      operations: [
        {
          op: 'add',
          id: 'lluvia_1',
          object: 'concepto', label: 'Rain',
        },
        {
          op: 'connect',
          id: 'flecha_lluvia',
          from: 'nube_1',
          to: 'lluvia_1',
          style: 'arrow',
          label: 'precipitación',
        },
      ] as Operation[],
    }

    const r4 = applyEnvelope(scene, env4)
    scene = r4.scene
    allEvents.push(...r4.events)

    expect(scene.objects.has('lluvia_1')).toBe(true)
    expect(scene.connections.has('flecha_lluvia')).toBe(true)

    // The stub places objects by arrival order, not by relation.
    // The relative position is not asserted (that is the layout's job).
    checkNoCollisions(scene)

    // ── Final scene checks ───────────────────────────────────────

    // 4 objects: sun, sea, cloud, rain
    expect(scene.objects.size).toBe(4)
    // 2 connections: evaporation, precipitation
    expect(scene.connections.size).toBe(2)

    // No collisions between any pair of objects
    checkNoCollisions(scene)

    // ── Event checks ───────────────────────────────────────────────

    const eventTypes = allEvents.map((e) => e.type)
    // draw_object: sun, sea, cloud, rain (4)
    expect(eventTypes.filter((t) => t === 'draw_object').length).toBe(4)
    // draw_connection: eva, rain (2)
    expect(eventTypes.filter((t) => t === 'draw_connection').length).toBe(2)
    // set_label: cloud (1)
    expect(eventTypes.filter((t) => t === 'set_label').length).toBe(1)
    // highlight (1)
    expect(eventTypes.filter((t) => t === 'highlight').length).toBe(1)

    // ── sceneToAgentState parses correctly ────────────────────────────────

    const agentState = sceneToAgentState(scene, CANVAS, [
      'y cuando las nubes se llenan, cae la lluvia',
    ])
    const parseResult = CanvasStateSchema.safeParse(agentState)
    expect(parseResult.success).toBe(true)

    // The 4 objects appear in the state
    expect(agentState.objects.length).toBe(4)
    expect(agentState.connections.length).toBe(2)

    // objects have no zone in the agent state
    for (const obj of agentState.objects) {
      expect((obj as Record<string, unknown>)['zone']).toBeUndefined()
    }
  })

  it('empty response (operations: []) is valid and does not mutate the scene', () => {
    // operations: [] is a correct response, not an error
    const { scene: s1 } = applyEnvelope(emptyScene(), {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'sol_1', object: 'concepto', label: 'Sun' },
      ],
    })

    const { scene: s2, events: e2 } = applyEnvelope(s1, {
      schema_version: '1.0',
      operations: [],
    })

    // The scene did not change
    expect(s2.objects.size).toBe(s1.objects.size)
    expect(s2.objects.has('sol_1')).toBe(true)
    // No events
    expect(e2.length).toBe(0)
  })

  it('the validator rejects unknown refs before reaching the applier', () => {
    const scene = emptyScene()
    const ctx = makeValidationCtx(scene)

    const { accepted, rejected } = validateAgentOutput(
      {
        schema_version: '1.0',
        operations: [
          { op: 'connect', id: 'f1', from: 'NADA', to: 'TAMBIÉN_NADA', style: 'arrow' },
        ],
      },
      ctx,
    )

    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0]!.rule).toBe('R2')
  })

  it('immutability between envelopes: the scene of each step is not altered by the next', () => {
    const s0 = emptyScene()

    const { scene: s1 } = applyEnvelope(s0, {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'sol_1', object: 'concepto', label: 'Sun' },
      ],
    })

    applyEnvelope(s1, {
      schema_version: '1.0',
      operations: [
        { op: 'add', id: 'nube_1', object: 'concepto', label: 'Cloud' },
      ],
    })

    // s0 and s1 were not affected
    expect(s0.objects.size).toBe(0)
    expect(s1.objects.size).toBe(1)
  })

  it('the validator rejects retired vocabulary (position in add) with R1', () => {
    const scene = emptyScene()
    const ctx = makeValidationCtx(scene)

    const { accepted, rejected } = validateAgentOutput(
      {
        schema_version: '1.0',
        operations: [
          { op: 'add', id: 'sol_1', object: 'concepto', label: 'Sun', position: { zone: 'top_left' } },
        ],
      },
      ctx,
    )

    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0]!.rule).toBe('R1')
  })
})

// ── Title: a single line at its natural width ────────────────────────────────

describe('integration — add texto role:titulo', () => {
  it('obj.fontSize defined, box on the left with NATURAL width', () => {
    const canvas = { width: 1200, height: 800 }
    const lib = loadLibrary()
    const localEnv: SceneEnv = { canvas, library: lib }

    const { scene, warnings } = applyOperations(emptyScene(), [
      {
        op: 'add',
        id: 'titulo_1_1',
        object: 'texto',
        role: 'titulo',
        text: 'El ciclo del agua',
      } as Operation,
    ], localEnv)

    expect(warnings).toHaveLength(0)
    const obj = scene.objects.get('titulo_1_1')!
    expect(obj).toBeDefined()
    // The fontSize computed by auto-fit must be present.
    expect(obj.fontSize).toBeDefined()
    expect(typeof obj.fontSize).toBe('number')
    // The title is anchored on the left with its NATURAL width (not full-width):
    // x = MARGIN, width < usable board width (excluding the date
    // reserve, DATE_RESERVE).
    expect(obj.box.x).toBe(STANDARD_MARGIN)
    expect(obj.box.width).toBeLessThan(canvas.width - 2 * STANDARD_MARGIN - DATE_RESERVE)
  })

  it('the title fontSize is in [14, 28] and is an integer', () => {
    const canvas = { width: 1200, height: 800 }
    const lib = loadLibrary()
    const localEnv: SceneEnv = { canvas, library: lib }

    const { scene } = applyOperations(emptyScene(), [
      {
        op: 'add',
        id: 'titulo_1_1',
        object: 'texto',
        role: 'titulo',
        text: 'Clasificación de los animales vertebrados e invertebrados',
      } as Operation,
    ], localEnv)

    const obj = scene.objects.get('titulo_1_1')!
    const fs = obj.fontSize!
    expect(fs).toBeGreaterThanOrEqual(14)
    expect(fs).toBeLessThanOrEqual(28)
    expect(Number.isInteger(fs)).toBe(true)
  })

  it('body text gets no fontSize (only titulo uses it)', () => {
    const canvas = { width: 1200, height: 800 }
    const lib = loadLibrary()
    const localEnv: SceneEnv = { canvas, library: lib }

    const { scene } = applyOperations(emptyScene(), [
      {
        op: 'add',
        id: 'cuerpo_1_1',
        object: 'texto',
        role: 'cuerpo',
        text: 'Texto de cuerpo normal',
      } as Operation,
    ], localEnv)

    const obj = scene.objects.get('cuerpo_1_1')!
    expect(obj.fontSize).toBeUndefined()
    // Body uses the standard column width, not the full board width.
    expect(obj.box.width).toBeLessThan(canvas.width - 2 * STANDARD_MARGIN)
  })

  it('the title box measures its NATURAL width, consistent with fitTitleFontSize', () => {
    // Checks that the measurer returns a width consistent with the model
    // chars * fontSize * 0.55 at the fittedFontSize (not full-width).
    const canvas = { width: 1200, height: 800 }
    const lib = loadLibrary()
    const localEnv: SceneEnv = { canvas, library: lib }
    const text = 'Tema'

    const { scene } = applyOperations(emptyScene(), [
      {
        op: 'add',
        id: 'titulo_1_1',
        object: 'texto',
        role: 'titulo',
        text,
      } as Operation,
    ], localEnv)

    const obj = scene.objects.get('titulo_1_1')!
    // bandContentWidth = canvas.width - 2*MARGIN - DATE_RESERVE (excludes the date reserve).
    const bandContentWidth = canvas.width - 2 * STANDARD_MARGIN - DATE_RESERVE
    const fittedFontSize = fitTitleFontSize(text, bandContentWidth)
    const naturalWidth = text.length * fittedFontSize * 0.55
    const expectedBoxWidth = Math.ceil(Math.min(naturalWidth, bandContentWidth)) + 2 * TEXT_PADDING
    expect(obj.box.width).toBe(expectedBoxWidth)
    // For a text as short as "Tema", the natural width is far below
    // the available band width: confirms it is NOT full-width.
    expect(obj.box.width).toBeLessThan(bandContentWidth)
  })
})

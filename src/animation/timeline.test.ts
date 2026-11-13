/**
 * Tests for timeline.ts: building the animation script.
 *
 * They verify: step order, organic pauses, SEQUENTIAL highlight,
 * clamped durations, type_text for texts.
 */
import { describe, it, expect } from 'vitest'
import { buildTimeline } from './timeline.js'
import type { AnimationStep } from './timeline.js'
import type { SceneEvent } from '@/scene/index.js'
import type { Scene } from '@/scene/index.js'
import {
  STROKE_MIN_MS,
  STROKE_MAX_MS,
  LETTER_MS,
  MICRO_PAUSE_MS,
  PATH_PAUSE_MS,
  PULSE_MS,
} from './constants.js'

// Fake highlight ids for the tests (format highlight_<page>_<n>)
const HL1 = 'highlight_1_1'
const HL2 = 'highlight_1_2'
const HL3 = 'highlight_1_3'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScene(partial: Partial<Scene> = {}): Scene {
  return {
    objects: partial.objects ?? new Map(),
    connections: partial.connections ?? new Map(),
    groups: partial.groups ?? new Map(),
    highlights: partial.highlights ?? new Map(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildTimeline', () => {

  it('empty scene → empty timeline', () => {
    const steps = buildTimeline([], makeScene())
    expect(steps).toHaveLength(0)
  })

  it('draw_object text: generates type_text', () => {
    const events: SceneEvent[] = [{ type: 'draw_object', id: 'titulo_1' }]
    const scene = makeScene({
      objects: new Map([['titulo_1', {
        id: 'titulo_1', object: 'texto', label: null, text: 'hola',
        role: null, box: { x: 0, y: 0, width: 200, height: 40 },
      }]]),
    })

    const steps = buildTimeline(events, scene)

    const typeStep = steps.find(s => s.kind === 'type_text')
    expect(typeStep).toBeDefined()
    expect(typeStep).toMatchObject({ kind: 'type_text', targetId: 'titulo_1', text: 'hola' })
    // Duration: 4 letters × 45ms = 180ms
    expect((typeStep as Extract<AnimationStep, { kind: 'type_text' }>).durationMs)
      .toBe(4 * LETTER_MS)
  })

  it('draw_connection: generates a stroke with clamped duration', () => {
    const events: SceneEvent[] = [{ type: 'draw_connection', id: 'flecha_1' }]
    const scene = makeScene({
      objects: new Map([
        ['sol_1', { id: 'sol_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 120, height: 120 } }],
        ['mar_1', { id: 'mar_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 600, width: 240, height: 80 } }],
      ]),
      connections: new Map([['flecha_1', {
        id: 'flecha_1', from: 'sol_1', to: 'mar_1',
        style: 'arrow' as const, label: null,
      }]]),
    })
    const steps = buildTimeline(events, scene)

    const stroke = steps.find(s => s.kind === 'stroke')
    expect(stroke).toBeDefined()
    const dur = (stroke as Extract<AnimationStep, { kind: 'stroke' }>).durationMs
    expect(dur).toBeGreaterThanOrEqual(STROKE_MIN_MS)
    expect(dur).toBeLessThanOrEqual(STROKE_MAX_MS)
  })

  it('draw_connection: generates strokes for arrowTo and arrowFrom with STROKE_MIN_MS', () => {
    const events: SceneEvent[] = [{ type: 'draw_connection', id: 'flecha_1' }]
    const scene = makeScene({
      objects: new Map([
        ['sol_1', { id: 'sol_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 120, height: 120 } }],
        ['mar_1', { id: 'mar_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 600, width: 240, height: 80 } }],
      ]),
      connections: new Map([['flecha_1', {
        id: 'flecha_1', from: 'sol_1', to: 'mar_1',
        style: 'arrow' as const, label: null,
      }]]),
    })
    const steps = buildTimeline(events, scene)

    // There must be a stroke for 'line', one for 'arrowTo' and one for 'arrowFrom'
    const strokes = steps.filter(s => s.kind === 'stroke') as Extract<AnimationStep, { kind: 'stroke' }>[]
    expect(strokes.find(s => s.pathId === 'line')).toBeDefined()
    expect(strokes.find(s => s.pathId === 'arrowTo')).toBeDefined()
    expect(strokes.find(s => s.pathId === 'arrowFrom')).toBeDefined()

    // Arrowheads use STROKE_MIN_MS
    const arrowTo = strokes.find(s => s.pathId === 'arrowTo')!
    const arrowFrom = strokes.find(s => s.pathId === 'arrowFrom')!
    expect(arrowTo.durationMs).toBe(STROKE_MIN_MS)
    expect(arrowFrom.durationMs).toBe(STROKE_MIN_MS)
  })

  it('draw_connection: PATH_PAUSE_MS pause before each arrowhead', () => {
    const events: SceneEvent[] = [{ type: 'draw_connection', id: 'flecha_1' }]
    const scene = makeScene({
      objects: new Map([
        ['a', { id: 'a', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 120, height: 120 } }],
        ['b', { id: 'b', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 600, width: 120, height: 120 } }],
      ]),
      connections: new Map([['flecha_1', {
        id: 'flecha_1', from: 'a', to: 'b', style: 'arrow' as const, label: null,
      }]]),
    })
    const steps = buildTimeline(events, scene)

    // There must be PATH_PAUSE_MS pauses before arrowTo and arrowFrom
    const pathPauses = steps.filter(s => s.kind === 'pause' && s.durationMs === PATH_PAUSE_MS)
    // At least 2: one before arrowTo and one before arrowFrom
    expect(pathPauses.length).toBeGreaterThanOrEqual(2)
  })

  it('highlight: SEQUENTIAL — one stroke per highlight with a pause between them', () => {
    // Highlight events use the list of created highlights (each with its own id)
    const events: SceneEvent[] = [{
      type: 'highlight',
      highlights: [
        { id: HL1, ref: 'sol_1' },
        { id: HL2, ref: 'nube_1' },
        { id: HL3, ref: 'flecha_1' },
      ],
    }]
    const steps = buildTimeline(events, makeScene())

    // There must be 3 strokes without pathId (one per highlight)
    const hlStrokes = steps.filter(s => s.kind === 'stroke' && s.pathId === undefined)
    expect(hlStrokes).toHaveLength(3)
    expect(hlStrokes[0]).toMatchObject({ kind: 'stroke', targetId: HL1, durationMs: PULSE_MS })
    expect(hlStrokes[1]).toMatchObject({ kind: 'stroke', targetId: HL2, durationMs: PULSE_MS })
    expect(hlStrokes[2]).toMatchObject({ kind: 'stroke', targetId: HL3, durationMs: PULSE_MS })

    // Between highlight strokes there must be MICRO_PAUSE_MS pauses
    const pausesBetween = steps.filter(
      s => s.kind === 'pause' && s.durationMs === MICRO_PAUSE_MS,
    )
    // At least 2 pauses (between strokes 1-2 and 2-3)
    expect(pausesBetween.length).toBeGreaterThanOrEqual(2)
  })

  it('highlight: a single highlight has NO pause before the stroke', () => {
    const events: SceneEvent[] = [{ type: 'highlight', highlights: [{ id: HL1, ref: 'sol_1' }] }]
    const steps = buildTimeline(events, makeScene())

    // Only one highlight stroke and no intra-highlight pause
    const hlStrokes = steps.filter(s => s.kind === 'stroke' && s.pathId === undefined)
    expect(hlStrokes).toHaveLength(1)
    // The first step of the highlight event is the stroke (no previous pause inside the highlight)
    expect(steps[0]).toMatchObject({ kind: 'stroke', targetId: HL1 })
  })

  it('highlight with word: the stroke uses the highlight id (the word lives in the scene)', () => {
    // The word no longer travels in the animation step (it lives in SceneHighlight)
    const events: SceneEvent[] = [{
      type: 'highlight',
      highlights: [{ id: HL1, ref: 'def_1', word: 'evaporación' }],
    }]
    const steps = buildTimeline(events, makeScene())

    const hlStroke = steps.find(s => s.kind === 'stroke' && s.pathId === undefined)
    expect(hlStroke).toBeDefined()
    expect(hlStroke).toMatchObject({ kind: 'stroke', targetId: HL1, durationMs: PULSE_MS })
  })

  it('highlight without word: stroke with the highlight id and PULSE_MS', () => {
    const events: SceneEvent[] = [{
      type: 'highlight',
      highlights: [{ id: HL1, ref: 'sol_1' }],
    }]
    const steps = buildTimeline(events, makeScene())

    const hlStroke = steps.find(s => s.kind === 'stroke' && s.pathId === undefined)
    expect(hlStroke).toBeDefined()
    expect(hlStroke).toMatchObject({ kind: 'stroke', targetId: HL1, durationMs: PULSE_MS })
  })

  it('multiple events: MICRO_PAUSE_MS micro-pause between distinct events', () => {
    const events: SceneEvent[] = [
      { type: 'draw_object', id: 'sol_1' },
      { type: 'draw_object', id: 'nube_1' },
    ]
    const scene = makeScene({
      objects: new Map([
        ['sol_1', { id: 'sol_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 120, height: 120 } }],
        ['nube_1', { id: 'nube_1', object: 'concepto', label: null, text: null, role: null,
          box: { x: 200, y: 0, width: 120, height: 120 } }],
      ]),
    })

    const steps = buildTimeline(events, scene)

    // There must be at least one MICRO_PAUSE between the two events
    const microPauses = steps.filter(
      s => s.kind === 'pause' && s.durationMs === MICRO_PAUSE_MS,
    )
    expect(microPauses.length).toBeGreaterThanOrEqual(1)
  })

  it('remove: generates fade_out with the right ids', () => {
    const events: SceneEvent[] = [{ type: 'remove', ids: ['sol_1', 'flecha_1'] }]
    const steps = buildTimeline(events, makeScene())

    const fade = steps.find(s => s.kind === 'fade_out')
    expect(fade).toMatchObject({ kind: 'fade_out', targetIds: ['sol_1', 'flecha_1'] })
  })

  it('update: generates move', () => {
    const events: SceneEvent[] = [{ type: 'update', id: 'sol_1' }]
    const steps = buildTimeline(events, makeScene())

    expect(steps.find(s => s.kind === 'move')).toMatchObject({
      kind: 'move', targetId: 'sol_1',
    })
  })

  it('extending update: type_text of the suffix only, prefix intact', () => {
    const events: SceneEvent[] = [{ type: 'update', id: 'p_1', extendedFrom: 'Water rises.' }]
    const scene = makeScene({
      objects: new Map([['p_1', {
        id: 'p_1', object: 'texto', label: null, text: 'Water rises. It cools.',
        role: 'cuerpo', box: { x: 0, y: 0, width: 200, height: 60 },
      }]]),
    })
    const steps = buildTimeline(events, scene)
    expect(steps).toEqual([{
      kind: 'type_text', targetId: 'p_1', text: ' It cools.', prefix: 'Water rises.',
      durationMs: ' It cools.'.length * LETTER_MS,
    }])
  })

  it('rewriting update: is still a move', () => {
    const events: SceneEvent[] = [{ type: 'update', id: 'p_1', extendedFrom: 'Water rises.' }]
    const scene = makeScene({
      objects: new Map([['p_1', {
        id: 'p_1', object: 'texto', label: null, text: 'Vapor goes up.',
        role: 'cuerpo', box: { x: 0, y: 0, width: 200, height: 60 },
      }]]),
    })
    const steps = buildTimeline(events, scene)
    expect(steps.map(s => s.kind)).toEqual(['move'])
  })

  it('group: generates appear', () => {
    const events: SceneEvent[] = [{ type: 'group', id: 'ciclo_1' }]
    const steps = buildTimeline(events, makeScene())

    expect(steps.find(s => s.kind === 'appear')).toMatchObject({
      kind: 'appear', targetId: 'ciclo_1',
    })
  })

  it('clear: generates fade_out with __all__', () => {
    const events: SceneEvent[] = [{ type: 'clear' }]
    const steps = buildTimeline(events, makeScene())

    expect(steps.find(s => s.kind === 'fade_out')).toMatchObject({
      kind: 'fade_out', targetIds: ['__all__'],
    })
  })

  it('stroke duration clamped to STROKE_MIN_MS for a very short path', () => {
    // 1px path → raw duration ~ 2ms → must clamp to STROKE_MIN_MS
    const events: SceneEvent[] = [{ type: 'draw_connection', id: 'c_1' }]
    const scene = makeScene({
      objects: new Map([
        ['a', { id: 'a', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 1, height: 1 } }],
        ['b', { id: 'b', object: 'concepto', label: null, text: null, role: null,
          box: { x: 1, y: 0, width: 1, height: 1 } }],
      ]),
      connections: new Map([['c_1', {
        id: 'c_1', from: 'a', to: 'b', style: 'arrow' as const, label: null,
      }]]),
    })
    const steps = buildTimeline(events, scene)
    const stroke = steps.find(s => s.kind === 'stroke')
    expect(stroke).toBeDefined()
    const dur = (stroke as Extract<AnimationStep, { kind: 'stroke' }>).durationMs
    expect(dur).toBeGreaterThanOrEqual(STROKE_MIN_MS)
  })

  it('stroke duration clamped to STROKE_MAX_MS for a very long path', () => {
    // Two objects more than 900px apart → raw > 2000ms → clamp
    const events: SceneEvent[] = [{ type: 'draw_connection', id: 'c_1' }]
    const scene = makeScene({
      objects: new Map([
        ['a', { id: 'a', object: 'concepto', label: null, text: null, role: null,
          box: { x: 0, y: 0, width: 1, height: 1 } }],
        ['b', { id: 'b', object: 'concepto', label: null, text: null, role: null,
          box: { x: 5000, y: 0, width: 1, height: 1 } }],
      ]),
      connections: new Map([['c_1', {
        id: 'c_1', from: 'a', to: 'b', style: 'arrow' as const, label: null,
      }]]),
    })
    const steps = buildTimeline(events, scene)
    const stroke = steps.find(s => s.kind === 'stroke')
    expect(stroke).toBeDefined()
    const dur = (stroke as Extract<AnimationStep, { kind: 'stroke' }>).durationMs
    expect(dur).toBeLessThanOrEqual(STROKE_MAX_MS)
  })

  it('set_label: generates type_text with the label text', () => {
    const events: SceneEvent[] = [{ type: 'set_label', ref: 'nube_1' }]
    const scene = makeScene({
      objects: new Map([['nube_1', {
        id: 'nube_1', object: 'concepto', label: 'condensación', text: null,
        role: null, box: { x: 0, y: 0, width: 160, height: 100 },
      }]]),
    })
    const steps = buildTimeline(events, scene)

    const typeStep = steps.find(s => s.kind === 'type_text')
    expect(typeStep).toBeDefined()
    expect(typeStep).toMatchObject({
      kind: 'type_text',
      targetId: 'nube_1__label',
      text: 'condensación',
    })
  })


  it('concept: traces the circle and then writes the name without markers', () => {
    const events: SceneEvent[] = [{ type: 'draw_object', id: 'sun_1' }]
    const scene = makeScene({
      objects: new Map([['sun_1', {
        id: 'sun_1', object: 'concepto', label: 'The **Sun**', text: null,
        role: null, box: { x: 0, y: 0, width: 80, height: 80 },
      }]]),
    })
    const steps = buildTimeline(events, scene)
    const kinds = steps.map((s) => s.kind)
    expect(kinds).toEqual(['stroke', 'pause', 'type_text'])
    expect(steps[0]).toMatchObject({ kind: 'stroke', targetId: 'sun_1', pathId: 'circle' })
    expect(steps[2]).toMatchObject({ kind: 'type_text', targetId: 'sun_1__label', text: 'The Sun' })
  })

  it('bold text: type_text over the visible text (no **)', () => {
    const events: SceneEvent[] = [{ type: 'draw_object', id: 'texto_1' }]
    const scene = makeScene({
      objects: new Map([['texto_1', {
        id: 'texto_1', object: 'texto', label: null, text: 'Water is **liquid**',
        role: 'cuerpo', box: { x: 0, y: 0, width: 200, height: 40 },
      }]]),
    })
    const steps = buildTimeline(events, scene)
    const t = steps.find((s) => s.kind === 'type_text') as Extract<AnimationStep, { kind: 'type_text' }>
    expect(t.text).toBe('Water is liquid')
    expect(t.durationMs).toBe('Water is liquid'.length * LETTER_MS)
  })

  it('extending with bold: the visible prefix stays intact and only the suffix is typed', () => {
    const events: SceneEvent[] = [{ type: 'update', id: 'texto_1', extendedFrom: 'Water is **liquid**' }]
    const scene = makeScene({
      objects: new Map([['texto_1', {
        id: 'texto_1', object: 'texto', label: null, text: 'Water is **liquid** and cold',
        role: 'cuerpo', box: { x: 0, y: 0, width: 200, height: 40 },
      }]]),
    })
    const steps = buildTimeline(events, scene)
    expect(steps).toEqual([
      { kind: 'type_text', targetId: 'texto_1', text: ' and cold', prefix: 'Water is liquid', durationMs: ' and cold'.length * LETTER_MS },
    ])
  })
})

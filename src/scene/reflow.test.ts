/**
 * Tests of `reflowScene` (global top-down reflow, slide mode).
 *
 * Replays a golden example through the real pipeline up to its final scene (live top-pack),
 * reflows it and checks that the ratio matches the live packing (≈ 0.37,
 * since reflow uses the same top-down packing without justification) and the
 * immutability of the input scene.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { validateAgentOutput } from '@/validator/index.js'
import type { ValidationContext } from '@/validator/index.js'
import type { BBox, Canvas } from '@/layout/index.js'
import { applyOperations, type SceneEnv } from './apply.js'
import { emptyScene, allIds, type Scene } from './model.js'
import { reflowScene } from './reflow.js'

/** Fraction of the canvas height covered by the set of boxes. */
function heightUsedRatio(boxes: ReadonlyMap<string, BBox>, canvas: Canvas): number {
  if (boxes.size === 0) return 0
  let minY = Infinity
  let maxY = -Infinity
  for (const b of boxes.values()) {
    minY = Math.min(minY, b.y)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return (maxY - minY) / canvas.height
}
import { newDocument, activeScene } from '@/document/index.js'
import { applyToActivePage } from '@/document/apply.js'
import { defaultAreaTree } from '@/layout/index.js'
import dorado2 from '../__fixtures__/golden-2.json'

const CANVAS = { width: 1200, height: 800 }

let library: ReturnType<typeof loadLibrary>
let env: SceneEnv

beforeAll(() => {
  library = loadLibrary()
  env = { canvas: CANVAS, library }
})

interface FixtureEntry {
  utterance: string
  envelope: unknown
}

function makeValidationCtx(scene: Scene): ValidationContext {
  return {
    mode: 'live',
    pageIds: allIds(scene),
  }
}

function applyEnvelope(scene: Scene, rawEnvelope: unknown): Scene {
  const ctx = makeValidationCtx(scene)
  const { accepted } = validateAgentOutput(rawEnvelope, ctx)
  return applyOperations(scene, accepted, env).scene
}

function replay(entries: FixtureEntry[]): Scene {
  let scene = emptyScene()
  for (const entry of entries) scene = applyEnvelope(scene, entry.envelope)
  return scene
}

function boxesOfScene(scene: Scene): Map<string, BBox> {
  const m = new Map<string, BBox>()
  for (const [id, obj] of scene.objects) m.set(id, obj.box)
  return m
}

describe('reflowScene', () => {
  it('golden #2: vertical-first reflow produces the same ratio as the live packing', () => {
    const scene = replay(dorado2 as FixtureEntry[])

    // Vertical-first fill with semantic gaps. Groups are gathered (2 contiguous
    // blocks instead of 4 fragmented ones), so the result is more compact
    // vertically (≈ 0.5 on the English corpus, whose texts are short).
    expect(heightUsedRatio(boxesOfScene(scene), CANVAS)).toBeCloseTo(0.5, 1)

    // Reflow re-derives the layout from the final scene and gets the same ratio
    // (layout stability: same input → same output; live == slide).
    const reflowed = reflowScene(scene, CANVAS)
    expect(heightUsedRatio(boxesOfScene(reflowed), CANVAS)).toBeCloseTo(0.5, 1)
  })

  it('does not mutate the input scene', () => {
    const scene = replay(dorado2 as FixtureEntry[])
    const before = boxesOfScene(scene)
    const snapshot = new Map<string, BBox>()
    for (const [id, b] of before) snapshot.set(id, { ...b })

    reflowScene(scene, CANVAS)

    // The original scene keeps its top-pack boxes exactly.
    for (const [id, b] of boxesOfScene(scene)) {
      expect(b).toEqual(snapshot.get(id))
    }
  })

  it('keeps connections and groups, and all objects', () => {
    const scene = replay(dorado2 as FixtureEntry[])
    const reflowed = reflowScene(scene, CANVAS)

    expect([...reflowed.objects.keys()].sort()).toEqual([...scene.objects.keys()].sort())
    expect(reflowed.connections.size).toBe(scene.connections.size)
    expect(reflowed.groups.size).toBe(scene.groups.size)
  })
})

// ── areaTree threaded into the layout ──────────────────────────────────────

describe('reflowScene — the page areaTree overrides the layout', () => {
  /**
   * Builds a synthetic scene with a long text in the BODY (not in the opening).
   *
   * For the text to go to the body (and use the area width), a non-text object
   * ('sol') is added first. That way planBoard closes the opening at the first item
   * and the text goes to body-blocks, where it does depend on areaTree.
   *
   * With body (fontSize=18, CHAR_WIDTH≈9.9 px):
   *   - 3-column area: contentWidth ≈ 368 px → wraps in 2 lines, width ≈ 333 px.
   *   - 2-column area: contentWidth ≈ 560 px → 1 line,        width ≈ 502 px.
   */
  function makeSceneWithBodyText(): ReturnType<typeof emptyScene> {
    // 49-char text with one space: fits on 1 line at 560 px but not at 368 px
    const longText = 'El agua se evapora y asciende al cielo como vapor'
    let scene = emptyScene()
    // 1) add a sun (non-text): forces the opening to end
    const ctx1 = makeValidationCtx(scene)
    const { accepted: acc1 } = validateAgentOutput({
      schema_version: '1.0',
      operations: [{ op: 'add', id: 'sol_1_1', object: 'sol' }],
    }, ctx1)
    scene = applyOperations(scene, acc1, env).scene

    // 2) add the long text (goes to the body because it comes after the sun)
    const ctx2 = makeValidationCtx(scene)
    const { accepted: acc2 } = validateAgentOutput({
      schema_version: '1.0',
      operations: [{ op: 'add', id: 'txt_1_1', object: 'texto', text: longText, role: 'cuerpo' }],
    }, ctx2)
    scene = applyOperations(scene, acc2, env).scene
    return scene
  }

  it('with 2 areas the body text produces a wider box than with 3 areas', () => {
    const scene = makeSceneWithBodyText()
    const txtId = 'txt_1_1'

    // Reflow with 3 areas (narrower columns → 2 lines → taller, narrower box)
    const placed3 = reflowScene(scene, CANVAS, defaultAreaTree(3))
    // Reflow with 2 areas (wider columns → 1 line → shorter, wider box)
    const placed2 = reflowScene(scene, CANVAS, defaultAreaTree(2))

    const box3 = placed3.objects.get(txtId)!.box
    const box2 = placed2.objects.get(txtId)!.box

    // With 3 areas (contentWidth≈368) the text wraps → taller box
    expect(box3.height).toBeGreaterThanOrEqual(box2.height)
    // With 2 areas (contentWidth≈560) the text fits on 1 line → wider box
    // (the box width reflects the real text width up to the area limit)
    expect(box2.width).toBeGreaterThan(box3.width)
  })

  it('falls back to defaultAreaTree(3) when no areaTree is passed', () => {
    const scene = replay(dorado2 as FixtureEntry[])
    const withDefault = reflowScene(scene, CANVAS)
    const with3Explicit = reflowScene(scene, CANVAS, defaultAreaTree(3))

    // Both must produce the same layout
    for (const [id, obj] of withDefault.objects) {
      const obj3 = with3Explicit.objects.get(id)
      expect(obj3).toBeDefined()
      expect(obj.box).toEqual(obj3!.box)
    }
  })
})

describe('applyToActivePage — live vs slide policy', () => {
  /** Replays golden #2 through the document, validating turn by turn in `mode`. */
  function replayDoc(entries: FixtureEntry[], mode: 'live' | 'slide') {
    let doc = newDocument()
    for (const entry of entries) {
      const ctx = makeValidationCtx(activeScene(doc))
      const { accepted } = validateAgentOutput(entry.envelope, ctx)
      doc = applyToActivePage(doc, accepted, env, mode).document
    }
    return doc
  }

  it('live: vertical-first fill with semantic gaps (heightUsedRatio ≈ 0.5)', () => {
    const doc = replayDoc(dorado2 as FixtureEntry[], 'live')
    // Real groups packed tight (WITHIN_GROUP_GAP=-8) + inter-block gap (GROUP_GAP=16).
    // Gather: 2 blocks instead of 4 fragmented → more compact (≈ 0.5,
    // the English corpus is short).
    expect(heightUsedRatio(boxesOfScene(activeScene(doc)), CANVAS)).toBeCloseTo(0.5, 1)
  })

  it('slide: vertical-first fill with semantic gaps (heightUsedRatio ≈ 0.5, same as live)', () => {
    // Live and slide produce the same ratio (gather is consistent in both modes).
    const doc = replayDoc(dorado2 as FixtureEntry[], 'slide')
    expect(heightUsedRatio(boxesOfScene(activeScene(doc)), CANVAS)).toBeCloseTo(0.5, 1)
  })
})

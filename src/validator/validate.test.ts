/**
 * Validator tests: at least one test per rule (R1, R2, R5) plus the special cases.
 * The connect, label, add and update-set schemas are strict, so retired fields
 * (anchors, curve, position, placement, size) are rejected by R1.
 */
import { describe, it, expect } from 'vitest'
import { validateAgentOutput } from './validate.js'
import type { ValidationContext } from './validate.js'

// ── Test context ──────────────────────────────────────────────────────────────

/** Minimal context for live-mode tests with pre-existing objects. */
function makeCtx(
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return {
    mode: 'live',
    pageIds: new Set<string>(['sol_1', 'mar_1', 'nube_1', 'flecha_1', 'ciclo_1']),
    ...overrides,
  }
}

/** Minimal valid envelope. */
function envelope(operations: unknown[]) {
  return { schema_version: '1.0', operations }
}

// ── Envelope validation ───────────────────────────────────────────────────────

describe('Envelope validation', () => {
  it('fails on a non-object: empty accepted and one envelope rejection', () => {
    const result = validateAgentOutput('a string', makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.rule).toBe('envelope')
  })

  it('fails without schema_version', () => {
    const result = validateAgentOutput({ operations: [] }, makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]!.rule).toBe('envelope')
  })

  it('fails with a wrong schema_version (0.6, an old version)', () => {
    const result = validateAgentOutput({ schema_version: '0.6', operations: [] }, makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]!.rule).toBe('envelope')
  })

  it('fails with a wrong schema_version (0.2)', () => {
    const result = validateAgentOutput({ schema_version: '0.2', operations: [] }, makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]!.rule).toBe('envelope')
  })

  it('fails when operations is not an array', () => {
    const result = validateAgentOutput({ schema_version: '1.0', operations: 'hello' }, makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]!.rule).toBe('envelope')
  })

  it('accepts an envelope with empty operations', () => {
    const result = validateAgentOutput(envelope([]), makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(0)
  })
})

// ── R1 Schema ─────────────────────────────────────────────────────────────────

describe('R1 — operation schema validation', () => {
  it('rejects an unknown op', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'made_up', id: 'x_1' }]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.rule).toBe('R1')
    expect(result.rejected[0]!.index).toBe(0)
  })

  it('rejects connect with an invalid style', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'sol_1', to: 'mar_1', style: 'dashed' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('accepts a valid op (delete with an existing ref)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'delete', ref: 'sol_1' }]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  // ── .strict() rejects retired vocabulary ──────────────────────────────────────

  it('R1 .strict(): rejects add with position (retired field)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'add', id: 'sol_2', object: 'concepto', label: 'sol', position: { zone: 'top_left' } }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('R1 .strict(): rejects connect with curve (retired field)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'sol_1', to: 'mar_1', style: 'arrow', curve: true }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('R1 .strict(): rejects connect with from_anchor (retired field)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'sol_1', to: 'mar_1', style: 'arrow', from_anchor: 'top' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('R1 .strict(): rejects label with placement (retired field)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'label', ref: 'nube_1', text: 'condensation', placement: 'below' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('R1 .strict(): rejects update.set with size (retired field)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'update', ref: 'sol_1', set: { size: 'large' } }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('accepts connect without anchors or curve', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'sol_1', to: 'mar_1', style: 'arrow' }]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })
})

// ── R2 Existing refs ──────────────────────────────────────────────────────────

describe('R2 — references to existing ids', () => {
  it('rejects connect with a missing from', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'missing', to: 'mar_1', style: 'arrow' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('rejects connect with a missing to', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'connect', id: 'c_1', from: 'sol_1', to: 'ghost', style: 'arrow' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('rejects label on a missing ref', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'label', ref: 'ghost', text: 'hello' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('rejects highlight with a missing ref in the list (bare id)', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'highlight', refs: ['sol_1', 'ghost'] }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('accepts highlight with {ref, word} whose ref exists', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'highlight', refs: [{ ref: 'sol_1', word: 'sol' }] }]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('rejects highlight with {ref, word} whose ref does NOT exist', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'highlight', refs: [{ ref: 'ghost', word: 'algo' }] }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
    expect(result.rejected[0]!.reason).toContain('ghost')
  })

  it('accepts a mixed highlight (bare id + {ref, word}) when all refs exist', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'highlight', refs: ['nube_1', { ref: 'sol_1', word: 'calor' }] }]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('rejects group with a missing member', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'group', id: 'g_1', members: ['sol_1', 'ghost'] }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('rejects delete of a missing ref', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'delete', ref: 'does_not_exist' }]),
      makeCtx(),
    )
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  // ── Id propagation within the same list ──────────────────────────────────

  it('R2: add followed by connect to the same id in the same list → accepted', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'add', id: 'gota_1', object: 'concepto', label: 'gota' },
        { op: 'connect', id: 'fl_1', from: 'gota_1', to: 'mar_1', style: 'arrow' },
      ]),
      makeCtx({ pageIds: new Set(['mar_1']) }),
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.rejected).toHaveLength(0)
  })

  it('R2: add with group → the group id also becomes visible to later ops', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'add', id: 'verteb_1', object: 'texto', group: 'col_verteb' },
        // Reference to the group created implicitly via add.group
        { op: 'highlight', refs: ['col_verteb'] },
      ]),
      makeCtx({ pageIds: new Set() }),
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.rejected).toHaveLength(0)
  })

  it('R2: delete followed by a ref to the deleted id → rejected', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'delete', ref: 'sol_1' },
        { op: 'label', ref: 'sol_1', text: 'after the delete' },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1) // the delete
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.index).toBe(1)
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('R2: clear empties the ids; a later ref is rejected', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'clear' },
        { op: 'delete', ref: 'sol_1' }, // sol_1 no longer exists after clear
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1) // the clear
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.rule).toBe('R2')
  })

  it('R2: ungroup removes the group id but not its members', () => {
    // ciclo_1 is a group; its members (sol_1, mar_1) stay visible
    const result = validateAgentOutput(
      envelope([
        { op: 'ungroup', ref: 'ciclo_1' },
        { op: 'label', ref: 'sol_1', text: 'still visible' },
        { op: 'highlight', refs: ['ciclo_1'] }, // ciclo_1 no longer exists
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(2) // ungroup + label
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.rule).toBe('R2')
  })
})

// ── Anchor vocabulary is rejected ─────────────────────────────────────────────

describe('Anchor vocabulary — rejected by the strict R1 schema', () => {
  it('connect with from_anchor → rejected by R1 (the field does not exist)', () => {
    // ConnectOperationSchema is strict, so from_anchor is an unknown key and the
    // op fails in R1.
    const result = validateAgentOutput(
      envelope([
        {
          op: 'connect',
          id: 'c_1',
          from: 'sol_1',
          to: 'mar_1',
          style: 'arrow',
          from_anchor: 'top', // does not exist in the contract
        },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.rule).toBe('R1')
  })

  it('connect without anchors or curve → accepted', () => {
    const result = validateAgentOutput(
      envelope([
        {
          op: 'connect',
          id: 'c_1',
          from: 'sol_1',
          to: 'mar_1',
          style: 'line',
        },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
    const op = result.accepted[0]
    expect(op?.op).toBe('connect')
  })
})

// ── R5 Operation cap ──────────────────────────────────────────────────────────

describe('R5 — cap per mode', () => {
  it(`live mode: 20 accepted, the rest rejected`, () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      op: 'add',
      id: `nodo_${i}`,
      object: 'texto',
      text: 'x',
    }))

    const result = validateAgentOutput(envelope(ops), makeCtx())
    expect(result.accepted).toHaveLength(20)
    expect(result.rejected).toHaveLength(25 - 20)
    // The 5 rejected ones must have rule R5
    for (const r of result.rejected) {
      expect(r.rule).toBe('R5')
    }
    // The rejected indexes are the last ones (20..24)
    const rejectedIndexes = result.rejected.map((r) => r.index)
    expect(rejectedIndexes).toEqual([20, 21, 22, 23, 24])
  })

  it(`slide mode: cap = 200`, () => {
    // A list of 20 ops must not be rejected in slide mode
    const ops = Array.from({ length: 20 }, (_, i) => ({
      op: 'add',
      id: `nodo_${i}`,
      object: 'texto',
      text: 'x',
    }))
    const result = validateAgentOutput(envelope(ops), makeCtx({ mode: 'slide' }))
    expect(result.accepted).toHaveLength(20)
    expect(result.rejected).toHaveLength(0)
  })

  it('25 valid ops: live accepts 20 and rejects 5 with rule R5; slide accepts 25', () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      op: 'add',
      id: `nodo_${i}`,
      object: 'texto',
      text: 'x',
    }))

    // Live mode: accepts only 20, rejects the remaining 5 with rule R5
    const liveResult = validateAgentOutput(envelope(ops), makeCtx({ mode: 'live' }))
    expect(liveResult.accepted).toHaveLength(20)
    expect(liveResult.rejected).toHaveLength(25 - 20)
    for (const r of liveResult.rejected) {
      expect(r.rule).toBe('R5')
    }

    // Slide mode: accepts all 25
    const slideResult = validateAgentOutput(envelope(ops), makeCtx({ mode: 'slide' }))
    expect(slideResult.accepted).toHaveLength(25)
    expect(slideResult.rejected).toHaveLength(0)
  })
})

// ── Partial discard ───────────────────────────────────────────────────────────

describe('Partial discard (mixed list)', () => {
  it('one bad op among good ones → only that one is rejected, with the right index', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'delete', ref: 'sol_1' },          // index 0 — valid
        { op: 'made_up', id: 'x_1' },           // index 1 — invalid (R1)
        { op: 'label', ref: 'mar_1', text: 'mar' }, // index 2 — valid
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.index).toBe(1)
    expect(result.rejected[0]!.rule).toBe('R1')
  })
})

// ── add→connect chain in the same list ────────────────────────────────────────

describe('add → connect chain in the same list', () => {
  it('connect can reference the id of an earlier add in the same list', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'add', id: 'rain_1', object: 'concepto', label: 'rain' },
        { op: 'add', id: 'mountain_1', object: 'concepto', label: 'mountain' },
        {
          op: 'connect',
          id: 'fl_1',
          from: 'rain_1',
          to: 'mountain_1',
          style: 'arrow',
        },
      ]),
      makeCtx({ pageIds: new Set() }),
    )
    expect(result.accepted).toHaveLength(3)
    expect(result.rejected).toHaveLength(0)
  })

  it('an accepted op (add) does contribute its id to later ops', () => {
    const result = validateAgentOutput(
      envelope([
        { op: 'add', id: 'dragon_1', object: 'concepto', label: 'dragon' },
        { op: 'connect', id: 'fl_1', from: 'dragon_1', to: 'mar_1', style: 'arrow' },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.rejected).toHaveLength(0)
  })

  it('an op rejected by R1 does NOT contribute its id to later ops', () => {
    const result = validateAgentOutput(
      envelope([
        // This add fails R1: position is an unknown key (strict schema)
        { op: 'add', id: 'nodo_1', object: 'concepto', label: 'sol', position: { zone: 'center' } },
        // This connect references the id of the rejected add → must fail R2
        { op: 'connect', id: 'fl_1', from: 'nodo_1', to: 'mar_1', style: 'arrow' },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[0]!.rule).toBe('R1')
    expect(result.rejected[1]!.rule).toBe('R2')
  })
})

// ── Id collision (add with an id that already exists) ─────────────────────────

describe('Id collision (the canvas renames, not the validator)', () => {
  it('add with an id already in pageIds → accepted (the canvas handles the collision)', () => {
    const result = validateAgentOutput(
      envelope([
        // sol_1 already exists in pageIds
        { op: 'add', id: 'sol_1', object: 'concepto', label: 'sol' },
      ]),
      makeCtx(),
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })
})

// ── Contract vocabulary: nothing else is accepted ────────────────────────────

describe('Vocabulary of the contract', () => {
  it.each([
    ['color on add', { op: 'add', id: 't_1', object: 'texto', text: 'Hi', color: 'rojo' }],
    ['fill on add', { op: 'add', id: 't_1', object: 'texto', text: 'Hi', fill: 'relleno' }],
    ['role nota', { op: 'add', id: 't_1', object: 'texto', text: 'x', role: 'nota' }],
    ['update.set.color', { op: 'update', ref: 'sol_1', set: { color: 'azul' } }],
    ['concepto without label', { op: 'add', id: 'c_1', object: 'concepto' }],
  ])('rejects %s by R1', (_name, op) => {
    const result = validateAgentOutput(envelope([op]), makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.rule).toBe('R1')
  })

  it('rejects a library object name: the agent vocabulary is texto | concepto', () => {
    const result = validateAgentOutput(envelope([{ op: 'add', id: 'sol_2', object: 'arbol' }]), makeCtx())
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.rule).toBe('R1')
  })

  it('accepts a concept with its name and balanced bold markup', () => {
    const result = validateAgentOutput(
      envelope([{ op: 'add', id: 'c_1', object: 'concepto', label: '**Sun**' }]),
      makeCtx(),
    )
    expect(result.rejected).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
  })

  it('does not accept an old schema_version', () => {
    const result = validateAgentOutput({ schema_version: '0.10', operations: [] }, makeCtx())
    expect(result.rejected[0]?.rule).toBe('envelope')
  })
})

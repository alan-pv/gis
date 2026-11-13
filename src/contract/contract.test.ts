/**
 * Tests of the contract schemas: canvas state, operations and envelope.
 * Literal examples must parse; unknown vocabulary must be rejected by the strict schemas.
 */
import { describe, it, expect } from 'vitest'
import {
  RoleSchema,
  SCHEMA_VERSION,
  CanvasStateSchema,
  OperationSchema,
  EnvelopeSchema,
  LenientEnvelopeSchema,
} from './index.js'

describe('CanvasStateSchema', () => {
  const state = {
    schema_version: '1.0',
    objects: [
      { id: 'titulo_1', object: 'texto', label: null, role: 'titulo' },
      { id: 'sol_1', object: 'concepto', label: 'Sun' },
    ],
    connections: [{ id: 'flecha_1', from: 'sol_1', to: 'titulo_1', style: 'arrow', label: null }],
    groups: [{ id: 'g_1', label: null, members: ['sol_1'] }],
    recent_utterances: ['the sun heats the water'],
  }

  it('parses the literal example', () => {
    expect(CanvasStateSchema.safeParse(state).success).toBe(true)
  })

  it('role is optional in the state', () => {
    const noRole = { ...state, objects: [{ id: 'sol_1', object: 'concepto', label: null }] }
    expect(CanvasStateSchema.safeParse(noRole).success).toBe(true)
  })

  it('rejects an empty group', () => {
    expect(CanvasStateSchema.safeParse({ ...state, groups: [{ id: 'g', label: null, members: [] }] }).success).toBe(false)
  })

  it('rejects any other schema_version', () => {
    expect(CanvasStateSchema.safeParse({ ...state, schema_version: '0.10' }).success).toBe(false)
  })
})

describe('OperationSchema — accepted', () => {
  it.each([
    ['add text with role', { op: 'add', id: 't_1', object: 'texto', text: 'The **water** cycle', role: 'titulo' }],
    ['add text with group', { op: 'add', id: 't_2', object: 'texto', text: 'x', group: 'g_1' }],
    ['add concept', { op: 'add', id: 'c_1', object: 'concepto', label: 'Evaporation' }],
    ['connect', { op: 'connect', id: 'f_1', from: 'a', to: 'b', style: 'arrow' }],
    ['connect with label', { op: 'connect', id: 'f_2', from: 'a', to: 'b', style: 'double_arrow', label: 'heat' }],
    ['label', { op: 'label', ref: 'a', text: 'hello' }],
    ['highlight ids', { op: 'highlight', refs: ['a', 'b'] }],
    ['highlight word', { op: 'highlight', refs: [{ ref: 'a', word: 'water' }] }],
    ['group', { op: 'group', id: 'g', members: ['a', 'b'], label: 'Water' }],
    ['ungroup', { op: 'ungroup', ref: 'g' }],
    ['update text', { op: 'update', ref: 'a', set: { text: 'new' } }],
    ['update label', { op: 'update', ref: 'a', set: { label: 'new' } }],
    ['delete', { op: 'delete', ref: 'a' }],
    ['clear', { op: 'clear' }],
  ])('%s', (_name, op) => {
    expect(OperationSchema.safeParse(op).success).toBe(true)
  })
})

describe('OperationSchema — rejected', () => {
  it.each([
    ['position on add', { op: 'add', id: 't', object: 'texto', position: { zone: 'center' } }],
    ['color on add', { op: 'add', id: 't', object: 'texto', color: 'rojo' }],
    ['fill on add', { op: 'add', id: 't', object: 'texto', fill: 'relleno' }],
    ['size on add', { op: 'add', id: 't', object: 'texto', size: 'large' }],
    ['role nota', { op: 'add', id: 't', object: 'texto', role: 'nota' }],
    ['concept without label', { op: 'add', id: 'c', object: 'concepto' }],
    ['concept with blank label', { op: 'add', id: 'c', object: 'concepto', label: '  ' }],
    ['curve on connect', { op: 'connect', id: 'f', from: 'a', to: 'b', style: 'arrow', curve: true }],
    ['anchor on connect', { op: 'connect', id: 'f', from: 'a', to: 'b', style: 'arrow', from_anchor: 'top' }],
    ['unknown connect style', { op: 'connect', id: 'f', from: 'a', to: 'b', style: 'wavy' }],
    ['placement on label', { op: 'label', ref: 'a', text: 'x', placement: 'above' }],
    ['update color only', { op: 'update', ref: 'a', set: { color: 'rojo' } }],
    ['update with empty set', { op: 'update', ref: 'a', set: {} }],
    ['highlight without refs', { op: 'highlight', refs: [] }],
    ['group without members', { op: 'group', id: 'g', members: [] }],
    ['unknown op', { op: 'move', ref: 'a' }],
  ])('%s', (_name, op) => {
    expect(OperationSchema.safeParse(op).success).toBe(false)
  })
})

describe('RoleSchema', () => {
  it('has the five text roles', () => {
    expect(RoleSchema.options).toEqual(['titulo', 'subtitulo', 'cuerpo', 'lista', 'enumeracion'])
  })
})

describe('Envelope', () => {
  it('SCHEMA_VERSION is 1.0', () => {
    expect(SCHEMA_VERSION).toBe('1.0')
  })

  it('accepts an empty operations list (a legitimate no-op turn)', () => {
    expect(EnvelopeSchema.safeParse({ schema_version: '1.0', operations: [] }).success).toBe(true)
  })

  it('rejects other versions', () => {
    for (const v of ['0.10', '0.9', '0.7', '2.0']) {
      expect(EnvelopeSchema.safeParse({ schema_version: v, operations: [] }).success).toBe(false)
    }
  })

  it('strict envelope rejects a bad operation; lenient envelope lets it through', () => {
    const env = { schema_version: '1.0', operations: [{ op: 'add', id: 'c', object: 'concepto' }] }
    expect(EnvelopeSchema.safeParse(env).success).toBe(false)
    expect(LenientEnvelopeSchema.safeParse(env).success).toBe(true)
  })

  it('lenient envelope still requires an array of operations', () => {
    expect(LenientEnvelopeSchema.safeParse({ schema_version: '1.0', operations: 'x' }).success).toBe(false)
  })
})

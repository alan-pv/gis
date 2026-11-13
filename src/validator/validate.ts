/**
 * Validator of the agent output.
 *
 * Pure, no canvas/React dependencies. A malformed output never breaks a class:
 * an invalid operation is dropped (and reported) and the rest continues.
 *
 * Rules, in order, per operation:
 *   R5 cap        — at most LIVE_CAP / SLIDE_CAP accepted operations per envelope.
 *   R1 schema     — operation matches the contract (strict schemas reject unknown vocabulary);
 *                   `add.object` must be in the agent vocabulary (texto | concepto).
 *   R2 refs       — every reference points to a visible id (page ids + ops accepted earlier
 *                   in the same list). An id collision in `add` is not an error: the canvas renames.
 */
import { LenientEnvelopeSchema, OperationSchema, SCHEMA_VERSION, AGENT_OBJECTS } from '@/contract/index.js'
import type { Operation } from '@/contract/index.js'

// ── Cap constants ─────────────────────────────────────────────────────────────

/** Maximum number of operations accepted in live (push-to-talk) mode. */
const LIVE_CAP = 20

/** Maximum number of operations accepted in slide mode. */
const SLIDE_CAP = 200

// ── Public API types ──────────────────────────────────────────────────────────

/**
 * Validation mode. 'live' (default): cap of 20 operations, for envelopes coming from
 * speech. 'slide': cap of 200, for whole pasted envelopes and manual board edits;
 * the board also re-flows the whole page after applying a 'slide' envelope.
 */
export type ValidationMode = 'live' | 'slide'

/** Context injected by the caller. */
export interface ValidationContext {
  mode: ValidationMode
  /** Ids of the objects and connections present on the active page. */
  pageIds: ReadonlySet<string>
}

/** Rejected operation with diagnostic context. */
export interface RejectedOperation {
  /** 0-based index in the original operations list (-1: the whole envelope). */
  index: number
  /** The raw operation as it arrived. */
  operation: unknown
  /** Code of the rule that rejected it ("envelope", R1, R2, R5). */
  rule: string
  /** Human readable message. */
  reason: string
}

export interface ValidationResult {
  accepted: Operation[]
  rejected: RejectedOperation[]
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Validates the raw agent output: envelope first, then each operation (R5 → R1 → R2).
 * A failing operation is dropped; the others continue. Ids of accepted operations
 * accumulate for later operations in the same list.
 */
export function validateAgentOutput(
  raw: unknown,
  ctx: ValidationContext,
): ValidationResult {
  const cap = ctx.mode === 'live' ? LIVE_CAP : SLIDE_CAP

  // ── Envelope validation ──────────────────────────────────────────────────────

  const envelopeResult = LenientEnvelopeSchema.safeParse(raw)
  if (!envelopeResult.success) {
    const isObject = typeof raw === 'object' && raw !== null
    const version =
      isObject && 'schema_version' in (raw as object)
        ? (raw as Record<string, unknown>)['schema_version']
        : undefined
    const hasOps = isObject && 'operations' in (raw as object)

    let reason: string
    if (!isObject) {
      reason = `Agent output is not a JSON object (received: ${typeof raw})`
    } else if (!version) {
      reason = 'Envelope is missing schema_version'
    } else if (version !== SCHEMA_VERSION) {
      reason = `Wrong schema_version: expected "${SCHEMA_VERSION}", received "${String(version)}"`
    } else if (!hasOps) {
      reason = 'Envelope is missing the operations field'
    } else {
      reason = `operations is not an array (received: ${typeof (raw as Record<string, unknown>)['operations']})`
    }

    return {
      accepted: [],
      rejected: [{ index: -1, operation: raw, rule: 'envelope', reason }],
    }
  }

  const { operations } = envelopeResult.data
  const accepted: Operation[] = []
  const rejected: RejectedOperation[] = []

  // Mutable set of visible ids: starts with those of the active page and is
  // updated as operations in this list are accepted (rule R2).
  const visibleIds = new Set<string>(ctx.pageIds)

  for (let i = 0; i < operations.length; i++) {
    const rawOp = operations[i]

    // ── R5 cap ───────────────────────────────────────────────────────────────
    // Applied before any other rule to the operations beyond the limit.
    if (accepted.length >= cap) {
      rejected.push({
        index: i,
        operation: rawOp,
        rule: 'R5',
        reason: `Cap of ${cap} operations in ${ctx.mode} mode reached`,
      })
      continue
    }

    // ── R1 schema ─────────────────────────────────────────────────────────────
    // The .strict() schemas (add/connect/label/update-set) reject fields the
    // model must not emit (position, curve, anchors, placement, size).
    const parseResult = OperationSchema.safeParse(rawOp)
    if (!parseResult.success) {
      rejected.push({
        index: i,
        operation: rawOp,
        rule: 'R1',
        reason: `Operation does not match the schema: ${parseResult.error.message}`,
      })
      continue
    }

    const op = parseResult.data

    // ── Agent vocabulary: add.object ∈ {texto, concepto} ──────────────────────
    if (op.op === 'add' && !(AGENT_OBJECTS as readonly string[]).includes(op.object)) {
      rejected.push({
        index: i,
        operation: rawOp,
        rule: 'R1',
        reason: `add.object "${op.object}" is outside the agent vocabulary (texto | concepto)`,
      })
      continue
    }

    // ── R2 refs exist ─────────────────────────────────────────────────────────
    // Every reference (ref/from/to/refs[]/members[]) must point to a visible id
    // (pageIds + operations accepted earlier in this list).
    // An id collision in `add` is NOT an error: the canvas renames.
    const refError = checkRefs(op, visibleIds)
    if (refError !== null) {
      rejected.push({ index: i, operation: rawOp, rule: 'R2', reason: refError })
      continue
    }

    // ── Accepted: update visibleIds according to the operation ────────────────
    accepted.push(op)
    updateVisibleIds(op, visibleIds)
  }

  return { accepted, rejected }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Checks that every reference in an operation points to a visible id.
 * Returns an error message, or null if all is well.
 */
function checkRefs(op: Operation, visibleIds: ReadonlySet<string>): string | null {
  switch (op.op) {
    case 'add':
      // add has no refs; an id collision is not an error.
      return null

    case 'connect': {
      if (!visibleIds.has(op.from)) {
        return `"from" references a missing id: "${op.from}"`
      }
      if (!visibleIds.has(op.to)) {
        return `"to" references a missing id: "${op.to}"`
      }
      return null
    }

    case 'label':
    case 'ungroup':
    case 'update':
    case 'delete':
      if (!visibleIds.has(op.ref)) {
        return `"ref" references a missing id: "${op.ref}"`
      }
      return null

    case 'highlight': {
      for (const entry of op.refs) {
        const id = typeof entry === 'string' ? entry : entry.ref
        if (!visibleIds.has(id)) {
          return `"refs" contains a missing id: "${id}"`
        }
      }
      return null
    }

    case 'group': {
      for (const member of op.members) {
        if (!visibleIds.has(member)) {
          return `"members" contains a missing id: "${member}"`
        }
      }
      return null
    }

    case 'clear':
      return null
  }
}

/**
 * Updates the set of visible ids according to an accepted operation:
 * - add/connect/group add their id.
 * - add with a group also adds the group id.
 * - delete removes the referenced id.
 * - ungroup removes the group id (not the members).
 * - clear empties the set.
 */
function updateVisibleIds(op: Operation, visibleIds: Set<string>): void {
  switch (op.op) {
    case 'add':
      visibleIds.add(op.id)
      // If the op carries a group, make the group id visible too so later refs
      // in the same batch can reference it.
      if (op.group !== undefined) {
        visibleIds.add(op.group)
      }
      break

    case 'connect':
    case 'group':
      visibleIds.add(op.id)
      break

    case 'delete':
      // Known limitation: if ref is a group, the canvas also deletes its members,
      // but there is no membership here to remove them; a later ref to a deleted
      // member would pass validation. Fixing it needs groups in ValidationContext.
      visibleIds.delete(op.ref)
      break

    case 'ungroup':
      // Dissolves the group without deleting its members
      visibleIds.delete(op.ref)
      break

    case 'clear':
      // Clears every id of the active page
      visibleIds.clear()
      break

    case 'label':
    case 'highlight':
    case 'update':
      // They do not change the set of ids
      break
  }
}

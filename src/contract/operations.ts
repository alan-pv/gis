/**
 * Zod schemas of the operations of the contract.
 *
 * Discriminated union on the `op` field. The model never decides position,
 * size or color: it declares WHAT (text / concept) and the STRUCTURE (groups,
 * connections, highlights); the app owns all the geometry and the colors.
 * The add, connect, label and update-set schemas are `.strict()`: unknown fields are rejected.
 */
import { z } from 'zod'

// ── Text role ────────────────────────────────────────────────────────────────
// Only meaningful for `texto` objects; the app decides size, weight and format.
// Default when omitted: 'cuerpo' (body paragraph).

export const RoleSchema = z.enum(['titulo', 'subtitulo', 'cuerpo', 'lista', 'enumeracion'])
export type Role = z.infer<typeof RoleSchema>

// ── `add.object` vocabulary of the agent ─────────────────────────────────────

/** Text object (bold with `**word**`). */
const OBJECT_TEXT = 'texto' as const
/** A figure is a concept: a circle with its free-form name (`label`) inside. */
const OBJECT_CONCEPT = 'concepto' as const
/** Values of `add.object` the agent may emit. */
export const AGENT_OBJECTS = [OBJECT_TEXT, OBJECT_CONCEPT] as const

// ── add ──────────────────────────────────────────────────────────────────────

const AddOperationSchema = z
  .object({
    op: z.literal('add'),
    /** Suggested id; the canvas renames on collision. */
    id: z.string().min(1),
    /**
     * `texto` | `concepto` for the agent. The schema leaves `object` free so
     * that scene-level tests and promoted ink can use library names; the
     * validator restricts it to AGENT_OBJECTS.
     */
    object: z.string().min(1),
    /** Only for object "texto"; admits `**bold**`. */
    text: z.string().optional(),
    /** For "concepto": free-form name, required and non-empty. Admits `**bold**`. */
    label: z.string().optional(),
    /**
     * Group membership at creation time (create-or-grow): the first add with an
     * unseen group id creates the group; later adds with the same id join it.
     */
    group: z.string().min(1).optional(),
    /** Semantic role of the content; only meaningful for 'texto'. Default 'cuerpo'. */
    role: RoleSchema.optional(),
  })
  .strict()
  .refine((v) => v.object !== OBJECT_CONCEPT || (v.label !== undefined && v.label.trim() !== ''), {
    message: "add of a 'concepto' requires a non-empty label (the concept name)",
    path: ['label'],
  })

// ── connect ──────────────────────────────────────────────────────────────────

export const ConnectStyleSchema = z.enum(['arrow', 'line', 'double_arrow'])
export type ConnectStyle = z.infer<typeof ConnectStyleSchema>

const ConnectOperationSchema = z
  .object({
    op: z.literal('connect'),
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    style: ConnectStyleSchema,
    label: z.string().optional(),
  })
  .strict()

// ── label ────────────────────────────────────────────────────────────────────

const LabelOperationSchema = z
  .object({
    op: z.literal('label'),
    ref: z.string().min(1),
    text: z.string(),
  })
  .strict()

// ── highlight ────────────────────────────────────────────────────────────────

const HighlightRefSchema = z.union([
  z.string().min(1),
  z.object({ ref: z.string().min(1), word: z.string().min(1) }),
])

const HighlightOperationSchema = z.object({
  op: z.literal('highlight'),
  /** Non-empty; each entry is an id (whole object) or {ref, word} (only that word). Played in sequence. */
  refs: z.array(HighlightRefSchema).min(1),
})

// ── group / ungroup ──────────────────────────────────────────────────────────

const GroupOperationSchema = z.object({
  op: z.literal('group'),
  id: z.string().min(1),
  members: z.array(z.string().min(1)).min(1),
  label: z.string().optional(),
})

const UngroupOperationSchema = z.object({
  op: z.literal('ungroup'),
  ref: z.string().min(1),
})

// ── update ───────────────────────────────────────────────────────────────────

/** Modifiable properties: only `label` and `text`; at least one must be present. */
const UpdateSetSchema = z
  .object({
    label: z.string().optional(),
    text: z.string().optional(),
  })
  .strict()
  .refine((val) => val.label !== undefined || val.text !== undefined, {
    message: 'update.set must contain at least one key (label or text)',
  })

const UpdateOperationSchema = z.object({
  op: z.literal('update'),
  ref: z.string().min(1),
  set: UpdateSetSchema,
})

// ── delete / clear ───────────────────────────────────────────────────────────

const DeleteOperationSchema = z.object({
  op: z.literal('delete'),
  ref: z.string().min(1),
})

const ClearOperationSchema = z.object({
  op: z.literal('clear'),
})

// ── Discriminated union ──────────────────────────────────────────────────────

export const OperationSchema = z.discriminatedUnion('op', [
  AddOperationSchema,
  ConnectOperationSchema,
  LabelOperationSchema,
  HighlightOperationSchema,
  GroupOperationSchema,
  UngroupOperationSchema,
  UpdateOperationSchema,
  DeleteOperationSchema,
  ClearOperationSchema,
])

export type Operation = z.infer<typeof OperationSchema>

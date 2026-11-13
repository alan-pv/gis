/**
 * Canvas state sent to the agent: only the objects of the active page.
 * It exposes structure (id, object, label, role) and group membership, never
 * geometry. Unrecognized ink is not part of it.
 */
import { z } from 'zod'
import { ConnectStyleSchema, RoleSchema } from './operations.js'

/** Single source of truth for the contract version. */
export const SCHEMA_VERSION = '1.0' as const

const CanvasObjectSchema = z.object({
  id: z.string().min(1),
  object: z.string().min(1),
  /** null when it has no label. */
  label: z.string().nullable(),
  /**
   * Semantic role of the text (read-only, `texto` objects only). The app emits
   * the effective role: a text without an explicit role is serialized as 'cuerpo'.
   */
  role: RoleSchema.optional(),
})

export type CanvasObject = z.infer<typeof CanvasObjectSchema>

const CanvasConnectionSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  style: ConnectStyleSchema,
  label: z.string().nullable(),
})

const CanvasGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  members: z.array(z.string().min(1)).min(1),
})

export const CanvasStateSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  objects: z.array(CanvasObjectSchema),
  connections: z.array(CanvasConnectionSchema),
  groups: z.array(CanvasGroupSchema),
  /** Sliding window of the teacher's last 2-3 phrases. */
  recent_utterances: z.array(z.string()),
})

export type CanvasState = z.infer<typeof CanvasStateSchema>

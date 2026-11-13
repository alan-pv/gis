/**
 * Zod schema for the .meta.json files of the object library.
 *
 * It is the executable source of truth of the community plugin format.
 * The loader validates each meta file against this schema at startup.
 */
import { z } from 'zod'

// ── Color/fill enums: mirror of the contract ─────────────────────────────────
// Declared locally because meta.ts is also compiled under tsconfig.node.json
// (which has no @/ alias) besides tsconfig.app.json. The values are identical
// to ColorSchema/FillSchema in src/contract/operations.ts (the Zod source of truth).

const ColorSchema = z.enum(['negro', 'azul', 'rojo', 'verde', 'amarillo', 'naranja', 'café', 'gris'])
export type Color = z.infer<typeof ColorSchema>

const FillSchema = z.enum(['relleno', 'contorno'])
export type Fill = z.infer<typeof FillSchema>

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const PositiveIntSchema = z.number().int().positive()

const DefaultSizeSchema = z.object({
  width:  PositiveIntSchema,
  height: PositiveIntSchema,
})

const AnchorPointSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const AnchorsSchema = z.object({
  top:    AnchorPointSchema,
  bottom: AnchorPointSchema,
  left:   AnchorPointSchema,
  right:  AnchorPointSchema,
})

// ── Main schema ───────────────────────────────────────────────────────────────

/**
 * Zod schema of the <name>.meta.json file.
 *
 * Two variants depending on `render`:
 * - Without `render`: a normal SVG object; `stroke_order` is
 *   mandatory and must be a non-empty array of strings.
 * - `render: "text"`: the canvas renders it natively; no `stroke_order`.
 */
export const ObjectMetaSchema = z.discriminatedUnion('render', [
  // Text variant: render:"text", no stroke_order
  z.object({
    render:         z.literal('text'),
    name:           z.string().min(1),
    format_version: z.literal(1),
    default_size:   DefaultSizeSchema,
    anchors:        AnchorsSchema,
    /** Natural color of the object. If omitted, the default is 'negro'. */
    color:          ColorSchema.optional(),
    /** Natural fill of the object. If omitted, the default is 'contorno'. */
    fill:           FillSchema.optional(),
    // Attribution and version fields (optional; shared packages carry them)
  }),
  // SVG variant: no render field (the discriminatedUnion
  // requires the field; we use z.undefined() for the absent discriminant)
  z.object({
    render:         z.undefined().optional(),
    name:           z.string().min(1),
    format_version: z.literal(1),
    default_size:   DefaultSizeSchema,
    anchors:        AnchorsSchema,
    stroke_order:   z.array(z.string().min(1)).min(1),
    /** Natural color of the object. If omitted, the default is 'negro'. */
    color:          ColorSchema.optional(),
    /** Natural fill of the object. If omitted, the default is 'contorno'. */
    fill:           FillSchema.optional(),
    // Attribution and version fields (optional; shared packages carry them)
  }),
])

export type ObjectMeta = z.infer<typeof ObjectMetaSchema>

// ── Color/fill defaults and helpers ──────────────────────────────────────────

const DEFAULT_COLOR: Color = 'negro'
const DEFAULT_FILL: Fill = 'contorno'

/**
 * Returns the natural color of the object; falls back to DEFAULT_COLOR if undefined.
 */
export function metaColor(meta: ObjectMeta): Color {
  return meta.color ?? DEFAULT_COLOR
}

/**
 * Returns the natural fill of the object; falls back to DEFAULT_FILL if undefined.
 */
export function metaFill(meta: ObjectMeta): Fill {
  return meta.fill ?? DEFAULT_FILL
}


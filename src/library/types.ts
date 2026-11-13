/**
 * Public types of the object library.
 *
 * Pure module: no glob, no runtime deps (only an import type of ObjectMeta).
 * Living here, the Vite plugins (Node) can import LibraryObject
 * without pulling in import.meta.glob (which only exists in the vite/client context).
 *
 * Consumers of the @/library/index.js barrel do not notice the split:
 * loader.ts re-exports these types.
 */
import type { ObjectMeta } from './meta.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface LibraryObject {
  name: string
  meta: ObjectMeta
  /** Raw SVG content, or null for render:"text" objects. */
  svg: string | null
}

export type Library = ReadonlyMap<string, LibraryObject>

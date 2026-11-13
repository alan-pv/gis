/**
 * resolve.ts — resolution of library objects (open catalog).
 *
 * The agent names the concept it needs; the canvas resolves it against the
 * loaded library (base + personal):
 *   - Hit  → library object.
 *   - Miss → placeholder: uses the 'circulo' LibraryObject as the base shape,
 *            and the requested name is assigned as a label in the add handler.
 *
 * The demand signal (miss) is recorded in the dataset per pair.
 */
import type { Library, LibraryObject } from './loader.js'

// ── Public types ───────────────────────────────────────────────────────────────

/** Result of resolving an object name against the library. */
export interface ResolvedObject {
  /** The LibraryObject that will be used to render. */
  obj: LibraryObject
  /** true if the object did not exist in the library and 'circulo' was used as a fallback. */
  isPlaceholder: boolean
}

// ── placeholderObject ─────────────────────────────────────────────────────────

/**
 * Builds the placeholder ResolvedObject ('circulo' shape, isPlaceholder=true).
 * Throws if 'circulo' is not in the library (broken base library).
 */
function placeholderObject(library: Library): ResolvedObject {
  const circulo = library.get('circulo')
  if (circulo === undefined) {
    throw new Error(
      `Broken base library: the "circulo" object needed for placeholders is missing`,
    )
  }
  return { obj: circulo, isPlaceholder: true }
}

// ── resolveObject ─────────────────────────────────────────────────────────────

/**
 * Resolves the name of an object against the loaded library.
 *
 * Hit: returns the corresponding LibraryObject with isPlaceholder = false.
 * Miss: returns the 'circulo' LibraryObject with isPlaceholder = true.
 *   The requested name will be used as a label in the add handler of apply.ts.
 *
 * If not even 'circulo' exists in the library, throws an Error:
 * that means the base library is broken (a build bug, not a runtime one).
 */
export function resolveObject(library: Library, name: string): ResolvedObject {
  const obj = library.get(name)
  if (obj !== undefined) {
    return { obj, isPlaceholder: false }
  }

  // Miss → placeholder using 'circulo' as the base shape
  return placeholderObject(library)
}

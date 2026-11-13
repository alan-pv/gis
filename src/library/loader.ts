/**
 * Object library loader.
 *
 * Loads every .meta.json and .svg file of objects/ at startup.
 * Uses import.meta.glob (Vite) for a build-time scan.
 *
 * A broken local library (invalid meta, inconsistent ids) is a build bug,
 * not runtime input: the loader throws with a clear message.
 */
import { ObjectMetaSchema } from './meta.js'
import type { LibraryObject, Library } from './types.js'

// ── Public types (re-exported from types.ts for compatibility) ───────────────
export type { LibraryObject, Library } from './types.js'

// ── Asset glob ────────────────────────────────────────────────────────────────

// Vite resolves these globs at build time.
// The types are inferred: Record<path, string> for both.
const rawMetas = import.meta.glob('/objects/*/*.meta.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const rawSvgs = import.meta.glob('/objects/*/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extracts the directory name from the glob path.
 * Example: "/objects/sol/sol.meta.json" → "sol"
 */
function dirName(path: string): string {
  // path has the form /objects/<name>/<file>
  const parts = path.split('/')
  // parts = ['', 'objects', '<name>', '<file>']
  return parts[2] ?? ''
}

/**
 * Extracts all path ids from an SVG with a simple regex.
 * Looks for id="..." patterns inside the SVG.
 */
function extractSvgIds(svg: string): Set<string> {
  const ids = new Set<string>()
  const re = /\bid="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    if (m[1]) ids.add(m[1])
  }
  return ids
}

// ── Per-object validation ────────────────────────────────────────────────────

/**
 * Builds and validates a LibraryObject from its raw data.
 *
 * Does exactly what the loop of loadLibrary() does for each entry:
 * parses the meta JSON, validates it with ObjectMetaSchema, checks that
 * meta.name matches the given name, requires a non-null SVG if render !== 'text',
 * and checks the two-way match between stroke_order and the SVG ids.
 *
 * Throws an Error with a clear message on any inconsistency.
 */
function buildLibraryObject(
  name: string,
  rawMeta: string,
  rawSvg: string | null,
): LibraryObject {
  // 1. Parse the raw JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMeta)
  } catch {
    throw new Error(
      `Library: object "${name}" has no valid JSON in its meta`,
    )
  }

  // 2. Validate with Zod
  const result = ObjectMetaSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Library: invalid meta in object "${name}": ${result.error.message}`,
    )
  }
  const meta = result.data

  // 3. Meta name == object name
  if (meta.name !== name) {
    throw new Error(
      `Library: the "name" field ("${meta.name}") does not match the object name "${name}"`,
    )
  }

  if (meta.render !== 'text') {
    // SVG object: the SVG file must exist
    if (rawSvg === null) {
      throw new Error(
        `Library: missing SVG file for object "${name}"`,
      )
    }

    // 4. Validate the stroke_order ↔ SVG ids match
    const svgIds = extractSvgIds(rawSvg)
    const strokeOrder = meta.stroke_order

    for (const pathId of strokeOrder) {
      if (!svgIds.has(pathId)) {
        throw new Error(
          `Library: stroke_order of object "${name}" contains id "${pathId}" that does not exist in the SVG`,
        )
      }
    }

    for (const svgId of svgIds) {
      if (!strokeOrder.includes(svgId)) {
        throw new Error(
          `Library: the SVG of object "${name}" has id "${svgId}" that does not appear in stroke_order`,
        )
      }
    }
  } else {
    // Text object: it must not have an SVG (if it did, it is not a critical error;
    // we still record it as null for consistency)
  }

  return {
    name: name,
    meta,
    svg: rawSvg,
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

let _library: Library | null = null

/**
 * Loads and validates the object library.
 * The result is cached: successive calls return the same map.
 *
 * Throws an Error if any object fails validation.
 */
export function loadLibrary(): Library {
  if (_library !== null) return _library

  const map = new Map<string, LibraryObject>()

  for (const [metaPath, rawMeta] of Object.entries(rawMetas)) {
    const dirKey = dirName(metaPath)
    const svgPath = `/objects/${dirKey}/${dirKey}.svg`
    const rawSvg = rawSvgs[svgPath] ?? null

    // buildLibraryObject throws if something is wrong; a broken base library is a build bug.
    const obj = buildLibraryObject(dirKey, rawMeta, rawSvg)
    map.set(dirKey, obj)
  }

  _library = map
  return _library
}

/**
 * lessons.ts — discovery and normalization of the bundled lessons for the
 * lesson player (developer console).
 *
 * Normalizes the dataset lessons (src/demo/lessons/*.json):
 *   { id, tema, sesgo, turnos: Array<{ utterance_formal, utterance_coloquial,
 *                                      envelope, case_tags }> }
 *
 * Exports `loadSeeds(): LoadedSeed[]`: "The food chain" first, the rest by
 * alphabetical title. The golden examples (test fixtures in src/__fixtures__) are not listed.
 *
 * Defensive rules:
 *   - A turn without an envelope is skipped with console.warn; it does not throw.
 *   - A lesson without an id or without turns is skipped with console.warn; it does not throw.
 */

export interface SeedTurn {
  utteranceFormal: string
  utteranceColoquial: string
  envelope: unknown
  caseTags: string[]
}

export interface LoadedSeed {
  id: string
  label: string
  sesgo?: string
  turns: SeedTurn[]
}

// ── Internal raw types ────────────────────────────────────────────────────

interface RawSeedTurno {
  utterance_formal: string
  utterance_coloquial: string
  envelope: Record<string, unknown>
  case_tags: string[]
}

interface RawSeed {
  id: string
  tema: string
  sesgo?: string
  turnos: RawSeedTurno[]
}

// ── Eager loading with import.meta.glob ────────────────────────────────────────
// Paths relative to src/demo/lessons.ts

const rawSeeds = import.meta.glob<{ default: RawSeed }>(
  './lessons/*.json',
  { eager: true },
)

// ── Normalization ────────────────────────────────────────────────────────────

function normalizeSeed(raw: RawSeed, path: string): LoadedSeed | null {
  if (!raw.id || !Array.isArray(raw.turnos)) {
    console.warn(`[seeds] Malformed lesson in ${path} (no id or turns); skipped`)
    return null
  }

  const turns: SeedTurn[] = []
  for (const t of raw.turnos) {
    if (!t.envelope) {
      console.warn(`[seeds] Turn without an envelope in ${path}; skipped`)
      continue
    }
    turns.push({
      utteranceFormal: t.utterance_formal ?? '',
      utteranceColoquial: t.utterance_coloquial ?? '',
      envelope: t.envelope,
      caseTags: Array.isArray(t.case_tags) ? t.case_tags : [],
    })
  }

  return {
    id: raw.id,
    label: raw.tema ?? raw.id,
    sesgo: raw.sesgo,
    turns,
  }
}

// ── Building and ordering ─────────────────────────────────────────────────────

/** The showcase lesson: always listed first. */
const FEATURED_LESSON_ID = 'cadena-alimentaria'

/**
 * Lesson list order (single place): "The food chain" first, then the rest
 * alphabetically by title.
 */
function sortLessons(list: LoadedSeed[]): LoadedSeed[] {
  return [...list].sort((a, b) => {
    if (a.id === FEATURED_LESSON_ID) return -1
    if (b.id === FEATURED_LESSON_ID) return 1
    return a.label.localeCompare(b.label, 'en')
  })
}

function buildSeeds(): LoadedSeed[] {
  const list: LoadedSeed[] = []
  for (const [path, mod] of Object.entries(rawSeeds)) {
    const seed = normalizeSeed(mod.default, path)
    if (seed !== null) list.push(seed)
  }
  return sortLessons(list)
}

/** Available lessons: "The food chain" first, then alphabetical by title. */
const SEEDS: LoadedSeed[] = buildSeeds()

export function loadSeeds(): LoadedSeed[] {
  return SEEDS
}

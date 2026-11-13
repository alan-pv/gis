/**
 * gate.ts — deterministic heuristic gate in front of the interpreter.
 *
 * No DOM or library dependencies: works in Node and in the browser. It is a
 * pure, stateless function.
 *
 * It decides *whether* a clause is worth an interpreter call, never *what* to
 * draw (that is the interpreter's job). It only saves calls by discarding what is
 * clearly not drawable: empty text, or nothing but filler words / function words
 * without lexical content.
 *
 * The bias is PERMISSIVE: a false positive costs one call that answers
 * `operations: []`, while a false negative can be recovered with a manual override.
 * So when in doubt the gate LETS THE CLAUSE THROUGH: any word outside the closed
 * list counts as content, including ASR noise, which must reach the interpreter
 * untouched. The gate never modifies the text: it inspects a normalized copy and
 * returns only a decision.
 *
 * The gate does not try to detect nouns with a POS tagger: a reliable "no nouns"
 * detector would amount to *deciding content*. Instead it approximates with a
 * closed list of fillers + function words (English, since the lessons are spoken
 * in English): if nothing is left after removing them (no word of at least
 * minContentChars), the clause is discarded.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type GateReason = 'ok' | 'empty' | 'no-content'

export interface GateDecision {
  /** true → worth calling the interpreter; false → discard (saves a call). */
  pass: boolean
  reason: GateReason
  /** How many content words survived the filter (for logging/visibility). */
  contentWords: number
}

export interface GateOptions {
  /** Function words + fillers (normalized: lowercase, no accents) that do NOT count as content. */
  ignore: Set<string>
  /** Minimum token length to count as content. Default 2. */
  minContentChars: number
}

// ── Closed list of ignored words ───────────────────────────────────────────────
// Normalized: lowercase and WITHOUT accents (gateClause's normalization strips
// diacritics). Conservative: any word NOT listed here counts as content.

const IGNORE_WORDS: readonly string[] = [
  // Articles and determiners
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  // Prepositions
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'about',
  'over', 'under', 'onto', 'upon', 'than', 'via',
  // Conjunctions / connectors
  'and', 'or', 'but', 'nor', 'so', 'because', 'if', 'then', 'as', 'though',
  'although', 'while', 'yet',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'here', 'there',
  // Copular / existential / auxiliary verbs with little visual content on their own
  'is', 'are', 'was', 'were', 'be', 'am', 'been', 'being', 'do', 'does', 'did',
  'have', 'has', 'had',
  // Fillers and interjections
  'uh', 'um', 'er', 'erm', 'hmm', 'mm', 'mmm', 'ah', 'oh', 'okay', 'ok', 'well',
  'right', 'yeah', 'yes', 'like', 'alright',
]

/** Default gate options. */
export const DEFAULT_GATE_OPTIONS: GateOptions = {
  ignore: new Set(IGNORE_WORDS),
  minContentChars: 2,
}

// ── Internal helpers ────────────────────────────────────────────────────────────

/** Normalizes for MATCHING (not for display): lowercase + no diacritics. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
}

// ── gateClause ──────────────────────────────────────────────────────────────────

/**
 * Classifies a clause as drawable (pass) or not, deterministically.
 * Does NOT modify the input text (the interpreter receives it verbatim downstream).
 *
 * @param text VERBATIM clause text (exactly as the STT delivered it).
 * @param opts Partial options, merged over DEFAULT_GATE_OPTIONS.
 */
export function gateClause(text: string, opts?: Partial<GateOptions>): GateDecision {
  const { ignore, minContentChars } = { ...DEFAULT_GATE_OPTIONS, ...opts }

  if (text.trim() === '') {
    return { pass: false, reason: 'empty', contentWords: 0 }
  }

  const tokens = normalize(text).match(/[a-z]+/g) ?? []
  const contentWords = tokens.filter(
    (t) => t.length >= minContentChars && !ignore.has(t),
  ).length

  if (contentWords === 0) {
    return { pass: false, reason: 'no-content', contentWords: 0 }
  }
  return { pass: true, reason: 'ok', contentWords }
}

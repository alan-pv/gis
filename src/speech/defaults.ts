/** Fixed defaults of the continuous speech mode. */

/** Early cut: ms a partial result must stay unchanged before it is emitted. */
export const EARLY_CUT_MS = 250

/** Max phrase duration before cutting (ms; 0 = no cap). */
export const MAX_PHRASE_MS = 6000

/** Margin (ms) over the phrase cap after which it cuts even without a micro-pause. */
export const CUT_CEILING_EXTRA_MS = 1_500

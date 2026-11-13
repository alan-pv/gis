/**
 * Board font: a single stack + preloading.
 *
 * The `FONT_FAMILY` stack used to be a constant duplicated in SceneCanvas,
 * measure-text and PageThumbnails; it now lives here and all three import it.
 * "Kalam" (OFL) is bundled locally with `@fontsource/kalam` (weights 400 and 700,
 * imported in `main.tsx`); no CDN. It ships a REAL bold (700), which the canvas
 * needs for `**bold**` keywords and titles (the canvas does not synthesize bold
 * for a font that only ships 400). Comic Sans / Segoe Print are only the
 * fallback if the bundled font fails to load.
 *
 * No React/Konva dependencies; safe in jsdom (no `document.fonts`).
 */

export const FONT_FAMILY = '"Kalam", "Comic Sans MS", "Segoe Print", cursive'

/** Wait cap (ms) so startup is not blocked if the font is slow or fails. */
const FONT_LOAD_TIMEOUT_MS = 3000

/**
 * Resolves when the board font is ready (or after a time cap).
 * Never rejects. Without `document.fonts` (tests/jsdom) it resolves immediately.
 * Awaited BEFORE the first render so the first canvas measurement
 * (`domMeasureText`, Konva.Text) uses the real font and not the fallback.
 */
export async function ensureBoardFontLoaded(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts || typeof fonts.load !== 'function') return
  const load = (async () => {
    try {
      await Promise.all([
        fonts.load(`400 18px "Kalam"`),
        fonts.load(`700 18px "Kalam"`),
      ])
      await fonts.ready
    } catch {
      /* font unavailable: continue with the fallback stack */
    }
  })()
  const timeout = new Promise<void>(resolve => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS))
  await Promise.race([load, timeout])
}

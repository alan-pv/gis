/**
 * demo-mode.ts — static demo gating.
 *
 * `npm run build:demo` builds with `VITE_GIS_DEMO=1`: the app then makes no
 * sidecar or dev-middleware calls, the microphone is disabled and the recorded
 * lessons are the whole experience. Read at call time (not at import time) so
 * tests can flip it with `vi.stubEnv`.
 */

/** Public repository, shown in the demo welcome card. Single place to change. */
export const REPO_URL = 'https://github.com/alan-pv/gis'

/** Tooltip of the disabled microphone in the demo build. */
export const DEMO_MIC_MESSAGE = 'Voice input needs the local version — see the README'

/** Message shown when the user turns the mic on and the local sidecar is not running. */
export const SIDECAR_OFFLINE_MESSAGE = "The local model isn't running. Start it with `npm start`."

/** True when the value of `VITE_GIS_DEMO` enables demo mode. */
export function isDemoValue(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true
}

/** True in the static demo build. */
export function isDemoMode(): boolean {
  return isDemoValue(import.meta.env.VITE_GIS_DEMO)
}

/**
 * Hand-drawn jitter using rough.js (canvas module).
 *
 * `roughenPath(d, seed)` takes an SVG path `d` and returns a jittered path
 * string with a hand-drawn look. The seed is deterministic per instance id, so
 * each object always has the same variant but different objects get different
 * variants (endless variants from one definition).
 *
 * Fill: none. Strokes only. Never video.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js'

const generator = new RoughGenerator()

/**
 * Simple hash of the id string → positive integer for the seed.
 * Deterministic, not cryptographic: we only need reproducibility.
 */
export function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/**
 * Applies rough.js jitter to an SVG path.
 *
 * @param d     `d` attribute of the original path.
 * @param seed  Deterministic seed (use `hashId(instanceId)`).
 * @returns     Jittered path `d` with a hand-drawn look.
 *              If d is empty or roughjs fails, returns d unchanged.
 */
export function roughenPath(d: string, seed: number): string {
  if (!d.trim()) return d

  try {
    const drawable = generator.path(d, {
      roughness: 1.2,
      bowing: 1.5,
      seed,
      disableMultiStroke: true,
      stroke: 'none',   // the color is handled by Konva
      fill: 'none',
    })

    // toPaths returns PathInfo[] with the `d` field already as a string
    const paths = generator.toPaths(drawable)

    // Concatenate all resulting paths (normally 1 with disableMultiStroke)
    const combined = paths.map(p => p.d).filter(Boolean).join(' ')
    return combined || d
  } catch {
    // Robustness: if rough.js fails (malformed path, etc.) return the original
    return d
  }
}

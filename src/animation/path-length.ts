/**
 * Approximate length of an SVG path (pure module, no DOM).
 *
 * Supports the M/L/C/Q/A/Z commands in upper and lower case.
 * For cubic (C) and quadratic (Q) curves we use the polyline through the
 * control points (the chord of the Bézier curve), which slightly overestimates
 * the real length but is acceptable for computing animation durations.
 * For arcs (A) we use the Euclidean distance between endpoints (a lower bound).
 *
 * Usage:
 *   import { approxPathLength } from './path-length.js'
 *   const len = approxPathLength('M 10 10 L 100 100')  // ~127.3
 */

// ── Token parser ──────────────────────────────────────────────────────────────

/**
 * Representation of an SVG command token with its numeric arguments.
 */
interface PathToken {
  cmd: string
  args: number[]
}

/**
 * Tokenizes an SVG path into command tokens + array of numbers.
 */
function tokenizePath(d: string): PathToken[] {
  const tokens: PathToken[] = []
  // Regex that captures a command letter followed by zero or more numbers
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1] ?? ''
    const rawArgs = m[2] ?? ''
    // Extract numbers (including negatives and decimals)
    const numRe = /-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?/gi
    const args: number[] = []
    let nm: RegExpExecArray | null
    while ((nm = numRe.exec(rawArgs)) !== null) {
      args.push(parseFloat(nm[0]))
    }
    tokens.push({ cmd, args })
  }
  return tokens
}

// ── Euclidean distance ─────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Approximates the length of an SVG path without using the DOM.
 *
 * Strategy:
 * - L (lineTo), H (horizontal), V (vertical): exact distance.
 * - C (cubic): polyline P0→P1→P2→P3 (overestimates).
 * - Q (quadratic): polyline P0→P1→P2.
 * - A (arc): Euclidean distance between endpoints (lower bound).
 * - Z: segment back to the start of the subpath.
 * - M: no length of its own.
 *
 * @param d  `d` attribute of an SVG `<path>` element.
 * @returns  Approximate length in viewBox pixels.
 */
export function approxPathLength(d: string): number {
  const tokens = tokenizePath(d)

  let total = 0
  let cx = 0 // cursor x
  let cy = 0 // cursor y
  let startX = 0 // start of the current subpath (for Z)
  let startY = 0

  for (const { cmd, args } of tokens) {
    switch (cmd) {

      // ── Move ────────────────────────────────────────────────────────────────
      case 'M': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = args[i] ?? 0
          const ny = args[i + 1] ?? 0
          if (i === 0) {
            cx = nx; cy = ny
            startX = cx; startY = cy
          } else {
            // Additional coordinate pairs after M are treated as L
            total += dist(cx, cy, nx, ny)
            cx = nx; cy = ny
          }
        }
        break
      }
      case 'm': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const dx = args[i] ?? 0
          const dy = args[i + 1] ?? 0
          if (i === 0) {
            cx += dx; cy += dy
            startX = cx; startY = cy
          } else {
            const nx = cx + dx
            const ny = cy + dy
            total += dist(cx, cy, nx, ny)
            cx = nx; cy = ny
          }
        }
        break
      }

      // ── LineTo ──────────────────────────────────────────────────────────────
      case 'L': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = args[i] ?? cx
          const ny = args[i + 1] ?? cy
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }
      case 'l': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = cx + (args[i] ?? 0)
          const ny = cy + (args[i + 1] ?? 0)
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }

      // ── Horizontal ──────────────────────────────────────────────────────────
      case 'H': {
        for (const nx of args) {
          total += Math.abs(nx - cx)
          cx = nx
        }
        break
      }
      case 'h': {
        for (const dx of args) {
          total += Math.abs(dx)
          cx += dx
        }
        break
      }

      // ── Vertical ────────────────────────────────────────────────────────────
      case 'V': {
        for (const ny of args) {
          total += Math.abs(ny - cy)
          cy = ny
        }
        break
      }
      case 'v': {
        for (const dy of args) {
          total += Math.abs(dy)
          cy += dy
        }
        break
      }

      // ── Cubic (C): polyline P0→P1→P2→P3 ───────────────────────────────────
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const x1 = args[i] ?? cx
          const y1 = args[i + 1] ?? cy
          const x2 = args[i + 2] ?? cx
          const y2 = args[i + 3] ?? cy
          const x3 = args[i + 4] ?? cx
          const y3 = args[i + 5] ?? cy
          total += dist(cx, cy, x1, y1)
                 + dist(x1, y1, x2, y2)
                 + dist(x2, y2, x3, y3)
          cx = x3; cy = y3
        }
        break
      }
      case 'c': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const x1 = cx + (args[i] ?? 0)
          const y1 = cy + (args[i + 1] ?? 0)
          const x2 = cx + (args[i + 2] ?? 0)
          const y2 = cy + (args[i + 3] ?? 0)
          const x3 = cx + (args[i + 4] ?? 0)
          const y3 = cy + (args[i + 5] ?? 0)
          total += dist(cx, cy, x1, y1)
                 + dist(x1, y1, x2, y2)
                 + dist(x2, y2, x3, y3)
          cx = x3; cy = y3
        }
        break
      }

      // ── Quadratic (Q): polyline P0→P1→P2 ───────────────────────────────────
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x1 = args[i] ?? cx
          const y1 = args[i + 1] ?? cy
          const x2 = args[i + 2] ?? cx
          const y2 = args[i + 3] ?? cy
          total += dist(cx, cy, x1, y1) + dist(x1, y1, x2, y2)
          cx = x2; cy = y2
        }
        break
      }
      case 'q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x1 = cx + (args[i] ?? 0)
          const y1 = cy + (args[i + 1] ?? 0)
          const x2 = cx + (args[i + 2] ?? 0)
          const y2 = cy + (args[i + 3] ?? 0)
          total += dist(cx, cy, x1, y1) + dist(x1, y1, x2, y2)
          cx = x2; cy = y2
        }
        break
      }

      // ── Arc (A): Euclidean distance between endpoints (lower bound) ─────────
      case 'A': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          const nx = args[i + 5] ?? cx
          const ny = args[i + 6] ?? cy
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }
      case 'a': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          const nx = cx + (args[i + 5] ?? 0)
          const ny = cy + (args[i + 6] ?? 0)
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }

      // ── Smooth cubic (S) ────────────────────────────────────────────────────
      case 'S': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x2 = args[i] ?? cx
          const y2 = args[i + 1] ?? cy
          const x3 = args[i + 2] ?? cx
          const y3 = args[i + 3] ?? cy
          total += dist(cx, cy, x2, y2) + dist(x2, y2, x3, y3)
          cx = x3; cy = y3
        }
        break
      }
      case 's': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x2 = cx + (args[i] ?? 0)
          const y2 = cy + (args[i + 1] ?? 0)
          const x3 = cx + (args[i + 2] ?? 0)
          const y3 = cy + (args[i + 3] ?? 0)
          total += dist(cx, cy, x2, y2) + dist(x2, y2, x3, y3)
          cx = x3; cy = y3
        }
        break
      }

      // ── Smooth quadratic (T) ────────────────────────────────────────────────
      case 'T': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = args[i] ?? cx
          const ny = args[i + 1] ?? cy
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }
      case 't': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = cx + (args[i] ?? 0)
          const ny = cy + (args[i + 1] ?? 0)
          total += dist(cx, cy, nx, ny)
          cx = nx; cy = ny
        }
        break
      }

      // ── ClosePath (Z) ────────────────────────────────────────────────────────
      case 'Z':
      case 'z': {
        total += dist(cx, cy, startX, startY)
        cx = startX; cy = startY
        break
      }
    }
  }

  return total
}

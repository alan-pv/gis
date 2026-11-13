/**
 * Sampling of SVG paths into flat point clouds.
 *
 * Reuses the tokenizePath tokenizer of src/animation/path-length.ts;
 * the path parser is not duplicated.
 *
 * Supports: M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z.
 * Arcs (A/a) are approximated with a straight line to the end point: the library
 * SVGs do not use arcs, so this approximation is enough.
 *
 * Pure module: no DOM, Konva or React.
 */
import { tokenizePath } from '../animation/path-length.js'

// ── Bézier curve evaluation ───────────────────────────────────────────────────

const BEZIER_STEPS = 16

/**
 * Evaluates a cubic Bézier (P0→P1→P2→P3) in `steps` uniform steps of t.
 * Returns the intermediate points (not including P0, which was already the last cursor).
 */
function sampleCubic(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  steps: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const t2 = t * t
    const t3 = t2 * t
    pts.push({
      x: mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
      y: mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3,
    })
  }
  return pts
}

/**
 * Evaluates a quadratic Bézier (P0→P1→P2) in `steps` uniform steps of t.
 */
function sampleQuadratic(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  steps: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    pts.push({
      x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
      y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
    })
  }
  return pts
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Samples an SVG path (the `d` attribute) and returns a list of flat points.
 *
 * Each command is walked while keeping the cursor and generating the
 * destination points or the points of the Bézier curve.
 */
export function samplePathPoints(d: string): Array<{ x: number; y: number }> {
  const tokens = tokenizePath(d)
  const pts: Array<{ x: number; y: number }> = []

  let cx = 0   // cursor x
  let cy = 0   // cursor y
  let startX = 0  // start of the current subpath (for Z)
  let startY = 0
  // Previous control point for S/s and T/t
  let prevCtrlX = cx
  let prevCtrlY = cy
  let prevCmd = ''

  for (const { cmd, args } of tokens) {
    switch (cmd) {

      // ── Move ──────────────────────────────────────────────────────────────
      case 'M': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nx = args[i] ?? 0
          const ny = args[i + 1] ?? 0
          if (i === 0) {
            cx = nx; cy = ny
            startX = cx; startY = cy
            // Include the subpath start point as a sample point
            pts.push({ x: cx, y: cy })
          } else {
            // Additional coordinate pairs after M are treated as L
            pts.push({ x: nx, y: ny })
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
            // Include the subpath start point as a sample point
            pts.push({ x: cx, y: cy })
          } else {
            cx += dx; cy += dy
            pts.push({ x: cx, y: cy })
          }
        }
        break
      }

      // ── LineTo ────────────────────────────────────────────────────────────
      case 'L': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx = args[i] ?? cx
          cy = args[i + 1] ?? cy
          pts.push({ x: cx, y: cy })
        }
        break
      }
      case 'l': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx += args[i] ?? 0
          cy += args[i + 1] ?? 0
          pts.push({ x: cx, y: cy })
        }
        break
      }

      // ── Horizontal ────────────────────────────────────────────────────────
      case 'H': {
        for (const nx of args) {
          cx = nx
          pts.push({ x: cx, y: cy })
        }
        break
      }
      case 'h': {
        for (const dx of args) {
          cx += dx
          pts.push({ x: cx, y: cy })
        }
        break
      }

      // ── Vertical ──────────────────────────────────────────────────────────
      case 'V': {
        for (const ny of args) {
          cy = ny
          pts.push({ x: cx, y: cy })
        }
        break
      }
      case 'v': {
        for (const dy of args) {
          cy += dy
          pts.push({ x: cx, y: cy })
        }
        break
      }

      // ── Cubic C ───────────────────────────────────────────────────────────
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const x1 = args[i] ?? cx,    y1 = args[i + 1] ?? cy
          const x2 = args[i + 2] ?? cx, y2 = args[i + 3] ?? cy
          const x3 = args[i + 4] ?? cx, y3 = args[i + 5] ?? cy
          const sampled = sampleCubic(cx, cy, x1, y1, x2, y2, x3, y3, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x2; prevCtrlY = y2
          cx = x3; cy = y3
        }
        break
      }
      case 'c': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const x1 = cx + (args[i] ?? 0),    y1 = cy + (args[i + 1] ?? 0)
          const x2 = cx + (args[i + 2] ?? 0), y2 = cy + (args[i + 3] ?? 0)
          const x3 = cx + (args[i + 4] ?? 0), y3 = cy + (args[i + 5] ?? 0)
          const sampled = sampleCubic(cx, cy, x1, y1, x2, y2, x3, y3, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x2; prevCtrlY = y2
          cx = x3; cy = y3
        }
        break
      }

      // ── Smooth cubic S ────────────────────────────────────────────────────
      case 'S': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          // Reflect the previous control point per the SVG standard
          const x1 = (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's')
            ? 2 * cx - prevCtrlX
            : cx
          const y1 = (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's')
            ? 2 * cy - prevCtrlY
            : cy
          const x2 = args[i] ?? cx,     y2 = args[i + 1] ?? cy
          const x3 = args[i + 2] ?? cx, y3 = args[i + 3] ?? cy
          const sampled = sampleCubic(cx, cy, x1, y1, x2, y2, x3, y3, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x2; prevCtrlY = y2
          cx = x3; cy = y3
        }
        break
      }
      case 's': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x1 = (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's')
            ? 2 * cx - prevCtrlX
            : cx
          const y1 = (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's')
            ? 2 * cy - prevCtrlY
            : cy
          const x2 = cx + (args[i] ?? 0),     y2 = cy + (args[i + 1] ?? 0)
          const x3 = cx + (args[i + 2] ?? 0), y3 = cy + (args[i + 3] ?? 0)
          const sampled = sampleCubic(cx, cy, x1, y1, x2, y2, x3, y3, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x2; prevCtrlY = y2
          cx = x3; cy = y3
        }
        break
      }

      // ── Quadratic Q ───────────────────────────────────────────────────────
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x1 = args[i] ?? cx,     y1 = args[i + 1] ?? cy
          const x2 = args[i + 2] ?? cx, y2 = args[i + 3] ?? cy
          const sampled = sampleQuadratic(cx, cy, x1, y1, x2, y2, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x1; prevCtrlY = y1
          cx = x2; cy = y2
        }
        break
      }
      case 'q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const x1 = cx + (args[i] ?? 0),     y1 = cy + (args[i + 1] ?? 0)
          const x2 = cx + (args[i + 2] ?? 0), y2 = cy + (args[i + 3] ?? 0)
          const sampled = sampleQuadratic(cx, cy, x1, y1, x2, y2, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x1; prevCtrlY = y1
          cx = x2; cy = y2
        }
        break
      }

      // ── Smooth quadratic T ────────────────────────────────────────────────
      case 'T': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          // The implicit control point is the reflection of the previous control point
          const x1 = (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't')
            ? 2 * cx - prevCtrlX
            : cx
          const y1 = (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't')
            ? 2 * cy - prevCtrlY
            : cy
          const x2 = args[i] ?? cx
          const y2 = args[i + 1] ?? cy
          const sampled = sampleQuadratic(cx, cy, x1, y1, x2, y2, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x1; prevCtrlY = y1
          cx = x2; cy = y2
        }
        break
      }
      case 't': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const x1 = (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't')
            ? 2 * cx - prevCtrlX
            : cx
          const y1 = (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't')
            ? 2 * cy - prevCtrlY
            : cy
          const x2 = cx + (args[i] ?? 0)
          const y2 = cy + (args[i + 1] ?? 0)
          const sampled = sampleQuadratic(cx, cy, x1, y1, x2, y2, BEZIER_STEPS)
          pts.push(...sampled)
          prevCtrlX = x1; prevCtrlY = y1
          cx = x2; cy = y2
        }
        break
      }

      // ── Arc A ─────────────────────────────────────────────────────────────
      // Library SVGs do not use arcs; approximated with a straight line.
      case 'A': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          cx = args[i + 5] ?? cx
          cy = args[i + 6] ?? cy
          pts.push({ x: cx, y: cy })
        }
        break
      }
      case 'a': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          cx += args[i + 5] ?? 0
          cy += args[i + 6] ?? 0
          pts.push({ x: cx, y: cy })
        }
        break
      }

      // ── ClosePath Z ───────────────────────────────────────────────────────
      case 'Z':
      case 'z': {
        pts.push({ x: startX, y: startY })
        cx = startX; cy = startY
        break
      }
    }

    // Save the current command for the S/T reflection
    prevCmd = cmd
  }

  return pts
}

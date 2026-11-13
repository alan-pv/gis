/**
 * Utility to extract paths from an SVG (pure module).
 *
 * Extracts the `<path>` elements of the SVG, preserving the original viewBox
 * so the render can scale correctly from the viewBox to the instance box.
 */

export interface SvgPathEntry {
  id: string
  d: string
}

export interface SvgInfo {
  viewBox: { width: number; height: number }
  paths: SvgPathEntry[]
}

/**
 * Extracts the viewBox and the paths with an id from a raw SVG.
 *
 * @param svg  Raw SVG content.
 * @returns    viewBox and list of { id, d } in order of appearance.
 */
export function parseSvgPaths(svg: string): SvgInfo {
  // Extract viewBox
  const vbMatch = svg.match(/viewBox="[^"]*?(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)"/)
  const vbW = vbMatch ? parseFloat(vbMatch[3] ?? '100') : 100
  const vbH = vbMatch ? parseFloat(vbMatch[4] ?? '100') : 100

  // Extract paths: two variants of id/d order
  const paths: SvgPathEntry[] = []
  const re = /<path([^>]+)>/g
  let m: RegExpExecArray | null

  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1] ?? ''

    // Extract id
    const idMatch = attrs.match(/id="([^"]+)"/)
    const id = idMatch ? (idMatch[1] ?? '') : ''

    // Extract d
    const dMatch = attrs.match(/\bd="([^"]+)"/)
    const d = dMatch ? (dMatch[1] ?? '') : ''

    if (id && d) {
      paths.push({ id, d })
    }
  }

  return { viewBox: { width: vbW, height: vbH }, paths }
}

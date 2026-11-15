import qrcode from 'qrcode-generator'

/**
 * The QR labels are small and dense, and the centre carries a little boltbook
 * mark. Error correction level H leaves 30% of the code recoverable, so a mark
 * over the middle is safe as long as it stays well under that (it is ~3% of the
 * area). Everything here is pure so it is tested without a DOM.
 */

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export interface QrMatrix {
  size: number
  /** rows[row][column] — true is a dark module. */
  rows: boolean[][]
}

export function qrMatrix(text: string, level: QrErrorCorrection = 'H'): QrMatrix {
  // 0 asks the library to choose the smallest version that fits.
  const code = qrcode(0, level)
  code.addData(text)
  code.make()
  const size = code.getModuleCount()
  const rows: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const cells: boolean[] = []
    for (let column = 0; column < size; column += 1) cells.push(code.isDark(row, column))
    rows.push(cells)
  }
  return { size, rows }
}

/** An SVG path for every dark module, with the mandatory quiet zone. */
export function qrPath(matrix: QrMatrix, quietModules = 2): string {
  const commands: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.rows[row]?.[column]) {
        commands.push(`M${column + quietModules} ${row + quietModules}h1v1h-1z`)
      }
    }
  }
  return commands.join('')
}

/** The in-app route a scanned storage label opens. */
export function locationLabelPath(locationName: string): string {
  return `#/location/${encodeURIComponent(locationName)}`
}

/** Absolute, so a camera app can open it from a printed label. */
export function locationLabelUrl(locationName: string, baseHref: string): string {
  return new URL(locationLabelPath(locationName), baseHref).href
}

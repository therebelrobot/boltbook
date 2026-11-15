/**
 * The tiled-print maths, kept pure and away from pdf.js.
 *
 * A pattern PDF is printed at its real physical size. When a page is larger
 * than the sheet, the page is cut into overlapping tiles: each sheet is the
 * whole paper, the PDF is offset by −x/−y, and the next sheet starts one sheet
 * minus the overlap. That overlap is deliberate — a printer clips its own
 * unprintable edge, and the strip on the next sheet replaces it.
 */

export type PaperSize = 'a4' | 'letter'

export interface PaperDimensionsMm {
  width: number
  height: number
}

/** ISO A4 and US Letter, portrait. */
export const PAPER_MM: Record<PaperSize, PaperDimensionsMm> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
}

export interface TilePlan {
  pageNumber: number
  row: number
  column: number
  rows: number
  columns: number
  /** Top-left of the tile in the PDF page, in millimetres. */
  xMm: number
  yMm: number
  /** The part of the tile that has PDF content; may be smaller than the sheet. */
  widthMm: number
  heightMm: number
}

export function planTiles(
  pageWidthMm: number,
  pageHeightMm: number,
  paper: PaperSize,
  overlapMm: number,
  pageNumber = 1,
): TilePlan[] {
  if (!(pageWidthMm > 0) || !(pageHeightMm > 0)) return []
  const sheet = PAPER_MM[paper]
  // More overlap than half a sheet would make the step zero or negative.
  const overlap = Math.max(0, Math.min(overlapMm, Math.min(sheet.width, sheet.height) / 2 - 1))
  const stepX = sheet.width - overlap
  const stepY = sheet.height - overlap
  const columns = Math.max(1, Math.ceil((pageWidthMm - overlap) / stepX))
  const rows = Math.max(1, Math.ceil((pageHeightMm - overlap) / stepY))

  const tiles: TilePlan[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const xMm = column * stepX
      const yMm = row * stepY
      const widthMm = Math.min(sheet.width, pageWidthMm - xMm)
      const heightMm = Math.min(sheet.height, pageHeightMm - yMm)
      if (widthMm <= 0 || heightMm <= 0) continue
      tiles.push({ pageNumber, row, column, rows, columns, xMm, yMm, widthMm, heightMm })
    }
  }
  return tiles
}

/** Millimetres to device pixels at a print resolution. */
export function mmToPixels(millimetres: number, dpi: number): number {
  return Math.round((millimetres / 25.4) * dpi)
}

/** Points (1/72 in) to millimetres, which is how a PDF page states its size. */
export function pointsToMillimetres(points: number): number {
  return (points / 72) * 25.4
}

/** "1/4 · row 2, column 3" — what is printed in the corner of each sheet. */
export function tileLabel(tile: TilePlan): string {
  return `${tile.row + 1}/${tile.rows} · ${tile.column + 1}/${tile.columns}`
}

/** How many sheets the whole job will use. */
export function sheetCount(tiles: readonly TilePlan[]): number {
  return tiles.length
}

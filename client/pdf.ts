import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { mmToPixels, planTiles, pointsToMillimetres, tileLabel, type PaperSize, type TilePlan } from './tiling'

/**
 * pdf.js lives behind a dynamic import: the pattern sheet is the only place
 * that needs it, and the worker is only fetched once a PDF is opened. The
 * document is read in the browser, so no pattern leaves the box.
 */

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((module) => {
      module.GlobalWorkerOptions.workerSrc = workerUrl
      return module
    })
  }
  return pdfjsPromise
}

interface OpenedPdf {
  pdf: PDFDocumentProxy
  close: () => Promise<void>
}

async function openDocument(data: ArrayBuffer): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // The build copies these next to the app (scripts/copy-pdfjs-assets.mjs).
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  })
  const pdf = await task.promise
  return { pdf, close: () => task.destroy() }
}

export interface PdfInspection {
  pageCount: number
  thumbnail: Blob | null
  thumbnailWidthPx: number
  thumbnailHeightPx: number
}

/** Page count and a first-page JPEG, rendered at `thumbnailWidth` CSS pixels. */
export async function inspectPdf(data: ArrayBuffer, thumbnailWidth = 360): Promise<PdfInspection> {
  const { pdf, close } = await openDocument(data)
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1, thumbnailWidth / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare a PDF preview.')

    await page.render({ canvasContext: context, canvas, viewport }).promise
    const thumbnail = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    )

    return {
      pageCount: pdf.numPages,
      thumbnail,
      thumbnailWidthPx: canvas.width,
      thumbnailHeightPx: canvas.height,
    }
  } finally {
    await close().catch(() => undefined)
  }
}

export interface RenderTilesOptions {
  paper: PaperSize
  dpi: number
  overlapMm: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface RenderedTile extends TilePlan {
  url: string
  label: string
}

/**
 * Renders every page at its real physical size, cut into sheet-sized tiles.
 * Each tile is a JPEG at the chosen DPI; the print stylesheet only positions
 * them, so the browser never has to re-render the PDF during printing.
 */
export async function renderPdfTiles(
  data: ArrayBuffer,
  options: RenderTilesOptions,
): Promise<RenderedTile[]> {
  const { pdf, close } = await openDocument(data)
  try {
    const plans: Array<{ tile: TilePlan; pageNumber: number }> = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const pageWidthMm = pointsToMillimetres(viewport.width)
      const pageHeightMm = pointsToMillimetres(viewport.height)
      for (const tile of planTiles(pageWidthMm, pageHeightMm, options.paper, options.overlapMm, pageNumber)) {
        plans.push({ tile, pageNumber })
      }
    }

    const rendered: RenderedTile[] = []
    for (const [index, { tile, pageNumber }] of plans.entries()) {
      if (options.signal?.aborted) throw new DOMException('Print cancelled.', 'AbortError')

      const page = await pdf.getPage(pageNumber)
      const scale = options.dpi / 72
      const viewport = page.getViewport({ scale })
      const widthPx = mmToPixels(tile.widthMm, options.dpi)
      const heightPx = mmToPixels(tile.heightMm, options.dpi)
      const canvas = document.createElement('canvas')
      canvas.width = widthPx
      canvas.height = heightPx
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser cannot prepare the printed pages.')

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, widthPx, heightPx)

      // The tile is the page, shifted so the wanted corner is at the canvas origin.
      const transform: [number, number, number, number, number, number] = [
        1,
        0,
        0,
        1,
        -mmToPixels(tile.xMm, options.dpi),
        -mmToPixels(tile.yMm, options.dpi),
      ]
      await page.render({ canvasContext: context, canvas, viewport, transform }).promise

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Could not encode a printed page.')

      rendered.push({ ...tile, url: URL.createObjectURL(blob), label: tileLabel(tile) })
      options.onProgress?.(index + 1, plans.length)
    }
    return rendered
  } finally {
    await close().catch(() => undefined)
  }
}

export function disposeTiles(tiles: readonly RenderedTile[]): void {
  for (const tile of tiles) URL.revokeObjectURL(tile.url)
}

/** Fetch an owned PDF with the session cookie and hand the bytes to pdf.js. */
export async function fetchPdfBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Could not read that pattern PDF.')
  return response.arrayBuffer()
}

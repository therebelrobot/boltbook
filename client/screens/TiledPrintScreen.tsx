import { useEffect, useRef, useState } from 'react'
import { patternFileUrl } from '../api'
import { PrintOverlay } from '../components/PrintOverlay'
import { disposeTiles, fetchPdfBytes, renderPdfTiles, type RenderedTile } from '../pdf'
import { PAPER_MM, type PaperSize } from '../tiling'
import type { PatternFile } from '../../shared/model'

interface TiledPrintScreenProps {
  patternName: string
  patternId: string
  file: PatternFile
  onClose: () => void
}

/**
 * A pattern PDF at its real size, cut across sheets. The browser's own print
 * dialog does not tile, so the tiles are rendered here and the stylesheet only
 * has to place one image per page.
 */
export function TiledPrintScreen({ patternName, patternId, file, onClose }: TiledPrintScreenProps) {
  const [paper, setPaper] = useState<PaperSize>('a4')
  const [dpi, setDpi] = useState(300)
  const [overlapMm, setOverlapMm] = useState(10)
  const [tiles, setTiles] = useState<RenderedTile[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tilesRef = useRef<RenderedTile[]>([])

  useEffect(() => {
    return () => disposeTiles(tilesRef.current)
  }, [])

  const clearTiles = (): void => {
    disposeTiles(tilesRef.current)
    tilesRef.current = []
    setTiles([])
  }

  const change = <T,>(set: (value: T) => void, value: T): void => {
    set(value)
    clearTiles()
    setError(null)
  }

  const render = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: 0 })
    clearTiles()
    try {
      const data = await fetchPdfBytes(patternFileUrl(patternId, file.id))
      const rendered = await renderPdfTiles(data, {
        paper,
        dpi,
        overlapMm,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      tilesRef.current = rendered
      setTiles(rendered)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not render the PDF.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const controls = (
    <>
      <div className="print-options">
        <div className="segmented" role="group" aria-label="Paper size">
          <button type="button" aria-pressed={paper === 'a4'} onClick={() => change(setPaper, 'a4')}>
            A4
          </button>
          <button type="button" aria-pressed={paper === 'letter'} onClick={() => change(setPaper, 'letter')}>
            Letter
          </button>
        </div>

        <div className="print-row">
          <label className="field" htmlFor="tile-dpi">
            <span className="label">Resolution</span>
            <select id="tile-dpi" value={dpi} onChange={(event) => change(setDpi, Number(event.target.value))}>
              <option value={200}>200 dpi</option>
              <option value={300}>300 dpi</option>
              <option value={400}>400 dpi (slow)</option>
            </select>
          </label>
          <label className="field" htmlFor="tile-overlap">
            <span className="label">Overlap</span>
            <select
              id="tile-overlap"
              value={overlapMm}
              onChange={(event) => change(setOverlapMm, Number(event.target.value))}
            >
              <option value={0}>None</option>
              <option value={5}>5 mm</option>
              <option value={10}>10 mm</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button type="button" className="button" disabled={busy} onClick={() => void render()}>
            {busy ? 'Rendering…' : tiles.length > 0 ? 'Render again' : 'Render pages'}
          </button>
          {tiles.length > 0 && (
            <button type="button" className="button primary" onClick={() => window.print()}>
              Print {tiles.length} sheet{tiles.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        <p className="muted">
          Print at <strong>100% / actual size</strong>, with margins off. Each sheet is{' '}
          {PAPER_MM[paper].width} × {PAPER_MM[paper].height} mm; the overlap is {overlapMm} mm, and the marks
          line up when the sheets are taped in order.
        </p>
        {progress && (
          <p className="muted">
            Rendering {progress.done} of {progress.total || '…'}…
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </>
  )

  return (
    <PrintOverlay title={`Print ${patternName}`} paper={paper} onClose={onClose} controls={controls}>
      {tiles.length === 0 ? (
        <p className="print-placeholder">Render the pages to see the sheets.</p>
      ) : (
        <div className="tile-sheet">
          {tiles.map((tile, index) => (
            <div className="tile-page" key={`${tile.pageNumber}-${tile.row}-${tile.column}`}>
              <img
                className="tile-image"
                src={tile.url}
                alt={`Page ${tile.pageNumber}, sheet ${index + 1}`}
                style={{ width: `${tile.widthMm}mm`, height: `${tile.heightMm}mm` }}
              />
              <span className="tile-corner tl" />
              <span className="tile-corner tr" />
              <span className="tile-corner bl" />
              <span className="tile-corner br" />
              <span className="tile-label">
                P{tile.pageNumber} · {tile.label} · {index + 1}/{tiles.length}
              </span>
              {index === 0 && (
                <span className="scale-check">
                  <span className="scale-box" />
                  50 mm
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </PrintOverlay>
  )
}

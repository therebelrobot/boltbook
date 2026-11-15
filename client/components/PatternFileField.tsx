import { useRef, useState } from 'react'
import {
  deletePatternFile,
  patternFileUrl,
  patternThumbnailUrl,
  uploadPatternFile,
  uploadPatternThumbnail,
} from '../api'
import { formatBytes, joinMeta } from '../format'
import { inspectPdf } from '../pdf'
import { TiledPrintScreen } from '../screens/TiledPrintScreen'
import type { PatternFile } from '../../shared/model'

interface PatternFileFieldProps {
  patternId: string
  patternName: string
  file: PatternFile | null
  onChanged: () => void
}

/**
 * The owned PDF: attach, replace, open, delete, and the way into tiled print.
 * Page count and the thumbnail are read in the browser, so no PDF parser or
 * renderer runs on the server (docs/technical-design.md §7).
 */
export function PatternFileField({ patternId, patternName, file, onChanged }: PatternFileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [tiledOpen, setTiledOpen] = useState(false)

  const onChosen = async (chosen: File | null): Promise<void> => {
    if (!chosen) return
    if (chosen.type !== 'application/pdf' && !chosen.name.toLowerCase().endsWith('.pdf')) {
      setError('That is not a PDF.')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const data = await chosen.arrayBuffer()
      let inspection: Awaited<ReturnType<typeof inspectPdf>> | null = null
      try {
        inspection = await inspectPdf(data)
      } catch {
        // A PDF can be valid and still defeat the preview (encrypted, odd
        // fonts). Storing it is the point; the preview is the bonus.
        inspection = null
      }

      const uploaded = await uploadPatternFile(patternId, chosen, inspection?.pageCount ?? null)
      if (inspection?.thumbnail) {
        try {
          await uploadPatternThumbnail(
            patternId,
            uploaded.id,
            inspection.thumbnail,
            inspection.thumbnailWidthPx,
            inspection.thumbnailHeightPx,
          )
        } catch {
          setNote('The PDF is stored, but its preview could not be saved.')
        }
      } else {
        setNote('The PDF is stored. This one could not be previewed.')
      }
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not store the PDF.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm('Remove the pattern PDF? The record and its views stay.')) return
    setBusy(true)
    setError(null)
    try {
      await deletePatternFile(patternId)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pattern-file">
      <div className="section-head">
        <span className="label">Pattern PDF</span>
        {file && <span className="chip">{file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : 'PDF'}</span>}
      </div>

      {file ? (
        <div className="file-card">
          {file.thumbnail ? (
            <img
              className="file-thumb"
              src={patternThumbnailUrl(patternId, file.id)}
              alt=""
              width={84}
              height={84}
            />
          ) : (
            <span className="file-thumb placeholder" aria-hidden="true">
              PDF
            </span>
          )}
          <div className="file-body">
            <a
              className="file-name"
              href={patternFileUrl(patternId, file.id)}
              target="_blank"
              rel="noreferrer"
            >
              {file.filename}
            </a>
            <span className="meta">
              {joinMeta([
                file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : null,
                formatBytes(file.byteSize),
              ])}
            </span>
            <div className="file-actions">
              <a
                className="button"
                href={patternFileUrl(patternId, file.id)}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
              <button type="button" className="button" disabled={busy} onClick={() => inputRef.current?.click()}>
                Replace
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => setTiledOpen(true)}>
                Print tiled
              </button>
              <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading the PDF…' : 'Attach a pattern PDF'}
        </button>
      )}

      {busy && file && <p className="muted">Reading the PDF…</p>}
      {error && <p className="error">{error}</p>}
      {note && <p className="muted">{note}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null
          event.target.value = ''
          void onChosen(chosen)
        }}
      />

      {tiledOpen && file && (
        <TiledPrintScreen
          patternName={patternName}
          patternId={patternId}
          file={file}
          onClose={() => setTiledOpen(false)}
        />
      )}
    </div>
  )
}

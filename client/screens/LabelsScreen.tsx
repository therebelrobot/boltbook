import { useEffect, useState } from 'react'
import { getLocations } from '../api'
import { PrintOverlay } from '../components/PrintOverlay'
import { QrSvg } from '../components/QrSvg'
import { locationLabelUrl } from '../qr'
import type { PaperSize } from '../tiling'
import type { LocationSummary } from '../../shared/model'

const LABELS_PER_PAGE = 10

function chunks<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size))
  return pages
}

function countsLine(location: LocationSummary): string {
  const parts: string[] = []
  if (location.fabricCount > 0) parts.push(`${location.fabricCount} fabric${location.fabricCount === 1 ? '' : 's'}`)
  if (location.threadCount > 0) parts.push(`${location.threadCount} thread${location.threadCount === 1 ? '' : 's'}`)
  if (location.notionCount > 0) parts.push(`${location.notionCount} notion${location.notionCount === 1 ? '' : 's'}`)
  if (location.toolCount > 0) parts.push(`${location.toolCount} tool${location.toolCount === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Empty'
}

interface LabelsScreenProps {
  onClose: () => void
}

/**
 * Storage labels. A location is a free-text field, so the sheet is built from
 * the distinct values across fabrics, thread, notions and tools. The QR opens
 * the location screen, which is the question the label exists to answer.
 */
export function LabelsScreen({ onClose }: LabelsScreenProps) {
  const [locations, setLocations] = useState<LocationSummary[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paper, setPaper] = useState<PaperSize>('a4')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getLocations()
      .then((list) => {
        if (cancelled) return
        setLocations(list)
        setSelected(new Set(list.map((location) => location.name)))
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load locations.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const chosen = (locations ?? []).filter((location) => selected.has(location.name))
  const pages = chunks(chosen, LABELS_PER_PAGE)

  const toggle = (name: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const controls = (
    <>
      {locations === null ? (
        <p className="muted">Loading locations…</p>
      ) : locations.length === 0 ? (
        <p className="muted">
          No storage locations yet. Give a fabric, thread, notion or tool a location, then come back.
        </p>
      ) : (
        <>
          <p className="muted">
            Each label opens that location in boltbook. Put the label on the bin, not on the shelf.
          </p>
          <div className="label-choices">
            {locations.map((location) => (
              <label className="label-choice" key={location.name} htmlFor={`label-${location.name}`}>
                <input
                  id={`label-${location.name}`}
                  type="checkbox"
                  checked={selected.has(location.name)}
                  onChange={() => toggle(location.name)}
                />
                <span>
                  <strong>{location.name}</strong>
                  <small>{countsLine(location)}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="print-row">
            <div className="segmented" role="group" aria-label="Paper size">
              <button type="button" aria-pressed={paper === 'a4'} onClick={() => setPaper('a4')}>
                A4
              </button>
              <button type="button" aria-pressed={paper === 'letter'} onClick={() => setPaper('letter')}>
                Letter
              </button>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="button plain"
                onClick={() => setSelected(new Set(locations.map((location) => location.name)))}
              >
                All
              </button>
              <button type="button" className="button plain" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={chosen.length === 0}
              onClick={() => window.print()}
            >
              Print {chosen.length} label{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
          <p className="muted small">Print at 100% / actual size, with margins off.</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )

  return (
    <PrintOverlay title="Storage labels" paper={paper} onClose={onClose} controls={controls}>
      {pages.length === 0 ? (
        <p className="print-placeholder">Choose at least one location to see the labels.</p>
      ) : (
        <div className="label-sheet">
          {pages.map((page, pageIndex) => (
            <div className="label-page" key={pageIndex}>
              {page.map((location) => {
                const url = locationLabelUrl(location.name, window.location.href)
                return (
                  <div className="storage-label" key={location.name}>
                    <QrSvg text={url} size={132} label={`Location ${location.name}`} />
                    <div className="label-text">
                      <span className="label-kicker">boltbook · storage</span>
                      <span className="label-name">{location.name}</span>
                      <span className="label-counts">{countsLine(location)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </PrintOverlay>
  )
}

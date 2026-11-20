import { useRef, useState } from 'react'
import { api, patternThumbnailUrl, photoUrl, uploadPhoto } from '../api'
import { useCollection } from '../useCollection'
import { EntitySheet } from '../components/EntitySheet'
import { PatternFileField } from '../components/PatternFileField'
import { PhotoField } from '../components/PhotoField'
import { Sheet } from '../components/Sheet'
import { ViewsEditor } from '../components/ViewsEditor'
import { useToast } from '../components/Toast'
import { parseEnvelope, type EnvelopeSuggestion } from '../envelope'
import { PATTERN_FIELDS } from '../fields'
import { joinMeta } from '../format'
import { recognizeEnvelope, type OcrWorkerHandle } from '../ocr'
import { preparePhoto } from '../photo'
import type { Pattern } from '../../shared/model'

const PATHS = '/api/patterns'

const STAGE_LABELS: Record<string, string> = {
  'loading tesseract core': 'Loading the reading engine…',
  'loading language traineddata': 'Loading the English model…',
  'initializing api': 'Preparing the reader…',
  'recognizing text': 'Reading the envelope…',
}

type ScanState =
  | { phase: 'reading'; previewUrl: string; progress: number; status: string }
  | {
      phase: 'review'
      previewUrl: string
      suggestion: EnvelopeSuggestion
      text: string
      confidence: number
    }

type ReviewScan = Extract<ScanState, { phase: 'review' }>

function ScanPreview({ scan }: { scan: ReviewScan }) {
  return (
    <div className="scan-preview">
      <img src={scan.previewUrl} alt="The pattern envelope" />
      <p className="muted small">Read on this device. The photo is not uploaded.</p>
    </div>
  )
}

function ScanDetails({ scan }: { scan: ReviewScan }) {
  const confidence = Math.round(scan.confidence)
  return (
    <div className="scan-details">
      <p className={confidence < 65 ? 'warn-line' : 'muted'}>
        {confidence < 65
          ? `Low confidence (${confidence}%). Check every field before saving.`
          : `Read with ${confidence}% confidence.`}
      </p>
      {scan.suggestion.views.length > 0 && (
        <p className="muted">
          Views detected: {scan.suggestion.views.join(', ')}. They will be created with the pattern.
        </p>
      )}
      <details>
        <summary>Text read from the envelope</summary>
        <pre className="scan-text">{scan.text.trim() || 'No text was found.'}</pre>
      </details>
    </div>
  )
}

export function PatternsScreen() {
  const { items, error, reload } = useCollection<Pattern>(PATHS)
  const toast = useToast()
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | { mode: 'scan' } | null>(
    null,
  )
  const [scan, setScan] = useState<ScanState | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const scanRun = useRef(0)
  const scanWorker = useRef<OcrWorkerHandle | null>(null)
  const scanPreview = useRef<string | null>(null)
  // The cover photo: held while creating, uploaded once the pattern exists.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetRef = useRef<string | null>(null)

  const editRecord = sheet?.mode === 'edit' ? (items?.find((item) => item.id === sheet.id) ?? null) : null
  const record = sheet?.mode === 'scan' && scan?.phase === 'review' ? scan.suggestion : editRecord

  const closeScan = (): void => {
    if (scanPreview.current) {
      URL.revokeObjectURL(scanPreview.current)
      scanPreview.current = null
    }
    setScan(null)
    setSheet(null)
  }

  const cancelScan = (): void => {
    scanRun.current += 1
    void scanWorker.current?.terminate().catch(() => undefined)
    scanWorker.current = null
    closeScan()
  }

  const openScan = (): void => {
    setScanError(null)
    scanInputRef.current?.click()
  }

  const onScanFile = async (file: File | null): Promise<void> => {
    if (!file) return
    setScanError(null)
    const run = ++scanRun.current
    try {
      const prepared = await preparePhoto(file)
      const previewUrl = URL.createObjectURL(prepared.blob)
      scanPreview.current = previewUrl
      setScan({ phase: 'reading', previewUrl, progress: 0, status: 'loading tesseract core' })

      const result = await recognizeEnvelope(prepared.blob, {
        onProgress: (status, progress) => {
          if (run !== scanRun.current) return
          setScan((current) => (current?.phase === 'reading' ? { ...current, status, progress } : current))
        },
        onWorker: (worker) => {
          if (run === scanRun.current) scanWorker.current = worker
        },
      })

      if (run !== scanRun.current) return
      const suggestion = parseEnvelope(result.text)
      setScan({
        phase: 'review',
        previewUrl,
        suggestion,
        text: result.text,
        confidence: result.confidence,
      })
      setSheet({ mode: 'scan' })
    } catch (caught) {
      if (run !== scanRun.current) return
      setScanError(caught instanceof Error ? caught.message : 'Could not read that envelope.')
      closeScan()
    } finally {
      if (run === scanRun.current) scanWorker.current = null
    }
  }

  const requestPhoto = (entityId: string | null): void => {
    photoTargetRef.current = entityId
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  const onPhotoChosen = async (file: File | null): Promise<void> => {
    if (!file) return
    const target = photoTargetRef.current
    if (!target) {
      // Creating: hold it until the pattern exists to attach it to.
      setPendingPhoto(file)
      return
    }
    setPhotoError(null)
    try {
      const prepared = await preparePhoto(file)
      await uploadPhoto('pattern', target, prepared.blob, prepared.widthPx, prepared.heightPx)
      await reload()
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Could not add the photo.')
    }
  }

  const save = async (values: Record<string, unknown>): Promise<void> => {
    if (sheet?.mode === 'edit') {
      await api(`${PATHS}/${sheet.id}`, { method: 'PUT', body: values })
      await reload()
      return
    }

    if (sheet?.mode === 'scan') {
      const created = await api<Pattern>(PATHS, { method: 'POST', body: values })
      const views = scan?.phase === 'review' ? scan.suggestion.views : []
      if (views.length > 0) {
        try {
          for (const label of views) {
            await api(`${PATHS}/${created.id}/views`, { method: 'POST', body: { label, description: null } })
          }
        } catch {
          toast({ message: 'Pattern saved, but its views could not be added. Add them by hand.' })
        }
      }
      await reload()
      return
    }

    const created = await api<{ id: string }>(PATHS, { method: 'POST', body: values })
    if (pendingPhoto) {
      const prepared = await preparePhoto(pendingPhoto)
      await uploadPhoto('pattern', created.id, prepared.blob, prepared.widthPx, prepared.heightPx)
      setPendingPhoto(null)
    }
    await reload()
  }

  const remove = async (): Promise<void> => {
    if (sheet?.mode !== 'edit') return
    await api(`${PATHS}/${sheet.id}`, { method: 'DELETE' })
    await reload()
    toast({ message: 'Pattern deleted.' })
  }

  const closeSheet = (): void => {
    if (sheet?.mode === 'scan') closeScan()
    else setSheet(null)
  }

  const title = sheet?.mode === 'edit' ? 'Edit pattern' : sheet?.mode === 'scan' ? 'Review the envelope' : 'New pattern'

  return (
    <>
      {error && <p className="error">{error}</p>}
      {scanError && <p className="error">{scanError}</p>}

      {items === null ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>No patterns yet.</p>
          <button type="button" className="button primary" onClick={openScan}>
            Scan an envelope
          </button>
          <button type="button" className="button" onClick={() => setSheet({ mode: 'create' })}>
            Add one by hand
          </button>
        </div>
      ) : (
        <>
          <div className="scan-actions">
            <button type="button" className="button" onClick={openScan}>
              Scan an envelope
            </button>
            <span className="muted small">Reads on this device.</span>
          </div>
          <div className="card">
            {items.map((pattern) => (
              <button
                type="button"
                className="row"
                key={pattern.id}
                onClick={() => setSheet({ mode: 'edit', id: pattern.id })}
              >
                {pattern.photos[0] ? (
                  <img
                    className="swatch"
                    src={photoUrl(pattern.photos[0].entityType, pattern.photos[0].entityId, pattern.photos[0].id)}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : pattern.file ? (
                  <img
                    className="swatch"
                    src={patternThumbnailUrl(pattern.id, pattern.file.id)}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : (
                  <span className="swatch" aria-hidden="true">
                    {pattern.name.slice(0, 2)}
                  </span>
                )}
                <span className="body">
                  <span className="title">{pattern.name}</span>
                  <span className="meta">
                    {joinMeta([
                      pattern.brand,
                      pattern.number,
                      pattern.category,
                      pattern.sizeMin && `size ${pattern.sizeMin}${pattern.sizeMax ? `–${pattern.sizeMax}` : ''}`,
                      pattern.file && `PDF${pattern.file.pageCount ? ` · ${pattern.file.pageCount} pp` : ''}`,
                      pattern.tags.length > 0 && pattern.tags.map((tag) => `#${tag}`).join(' '),
                    ]) || 'No details yet'}
                  </span>
                </span>
                <span className="right">
                  {pattern.triedAndTrue ? 'TNT' : pattern.format ?? '—'}
                  <span className="sub">
                    {pattern.views.length > 0
                      ? `${pattern.views.length} view${pattern.views.length === 1 ? '' : 's'}`
                      : 'no views'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {items !== null && items.length > 0 && (
        <button type="button" className="fab" onClick={() => setSheet({ mode: 'create' })}>
          Add pattern
        </button>
      )}

      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          void onScanFile(file)
        }}
      />

      {scan?.phase === 'reading' && (
        <Sheet title="Reading the envelope" onClose={cancelScan}>
          <div className="scan-progress">
            <img src={scan.previewUrl} alt="" />
            <p className="scan-stage">{STAGE_LABELS[scan.status] ?? 'Reading the envelope…'}</p>
            <div
              className="meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scan.progress * 100)}
            >
              <div className="remaining" style={{ width: `${Math.round(scan.progress * 100)}%` }} />
            </div>
            <p className="muted small">This runs on your device. The photo is not uploaded.</p>
            <button type="button" className="button" onClick={cancelScan}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          void onPhotoChosen(file)
        }}
      />

      {sheet && (
        <EntitySheet
          key={sheet.mode === 'edit' ? sheet.id : sheet.mode === 'scan' ? 'scan' : 'new'}
          title={title}
          fields={PATTERN_FIELDS}
          record={record as Record<string, unknown> | null}
          onSave={save}
          onDelete={sheet.mode === 'edit' ? remove : undefined}
          onClose={() => {
            closeSheet()
            setPendingPhoto(null)
          }}
          leading={
            sheet.mode === 'scan' && scan?.phase === 'review' ? (
              <ScanPreview scan={scan} />
            ) : (
              <>
                <PhotoField
                  entityType="pattern"
                  entityId={sheet.mode === 'edit' ? sheet.id : null}
                  photos={editRecord?.photos ?? []}
                  pendingFile={pendingPhoto}
                  onPendingFile={setPendingPhoto}
                  onChanged={() => void reload()}
                  onRequestPhoto={requestPhoto}
                />
                {photoError && <p className="error">{photoError}</p>}
              </>
            )
          }
        >
          {sheet.mode === 'edit' && editRecord ? (
            <>
              <PatternFileField
                patternId={sheet.id}
                patternName={editRecord.name}
                file={editRecord.file}
                onChanged={() => void reload()}
              />
              <ViewsEditor pattern={editRecord} onChanged={() => void reload()} />
            </>
          ) : sheet.mode === 'scan' && scan?.phase === 'review' ? (
            <ScanDetails scan={scan} />
          ) : (
            <p className="muted">Save the pattern, then add its views, yardage and PDF.</p>
          )}
        </EntitySheet>
      )}
    </>
  )
}

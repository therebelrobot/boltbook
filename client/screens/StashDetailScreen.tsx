import { useEffect, useRef, useState } from 'react'
import { api, photoUrl, uploadPhoto } from '../api'
import { EntitySheet } from '../components/EntitySheet'
import { PhotoField } from '../components/PhotoField'
import { useToast } from '../components/Toast'
import { navigate } from '../router'
import { preparePhoto } from '../photo'
import { remainingFraction } from '../format'
import { unitLabel } from '../units'
import { useUnit } from '../unitPreference'
import { STASH_KINDS, type StashKindConfig } from '../fields'
import { displayField } from '../formValues'
import type { Photo } from '../../shared/model'

type Record_ = Record<string, unknown>

interface StashDetailScreenProps {
  kind: StashKindConfig['key']
  id: string
}

/**
 * The read-only detail screen (design brief §3 "lists → detail"). Tapping a row
 * opens this; nothing is editable until Edit is tapped. The record's own fields
 * are the content, the photos lead, and the actions are the things you would do
 * next: Edit, Delete.
 */
export function StashDetailScreen({ kind, id }: StashDetailScreenProps) {
  const config = STASH_KINDS.find((entry) => entry.key === kind) ?? STASH_KINDS[0]!
  const { unit } = useUnit()
  const toast = useToast()
  const [record, setRecord] = useState<Record_ | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'edit' | null>(null)
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const reload = async (): Promise<void> => {
    try {
      setRecord(await api<Record_>(`${config.path}/${id}`))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this record.')
    }
  }

  useEffect(() => {
    setRecord(null)
    setError(null)
    void reload()
    // The record is addressed by kind + id; nothing else re-fetches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  const requestPhoto = (): void => {
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  const onPhotoChosen = async (file: File | null): Promise<void> => {
    if (!file) return
    setPhotoError(null)
    try {
      const prepared = await preparePhoto(file)
      await uploadPhoto(kind, id, prepared.blob, prepared.widthPx, prepared.heightPx)
      await reload()
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Could not add the photo.')
    }
  }

  const save = async (values: Record_): Promise<void> => {
    await api(`${config.path}/${id}`, { method: 'PUT', body: values })
    if (pendingPhoto) {
      const prepared = await preparePhoto(pendingPhoto)
      await uploadPhoto(kind, id, prepared.blob, prepared.widthPx, prepared.heightPx)
      setPendingPhoto(null)
    }
    await reload()
  }

  /** From the sheet or the action row: delete, then leave — the undo lives on the list this returns to. */
  const remove = async (): Promise<void> => {
    const snapshot = record
    await api(`${config.path}/${id}`, { method: 'DELETE' })
    navigate('stash', kind)
    if (snapshot) {
      // Dropping the server-owned fields, so an undo re-creates rather than conflicts.
      const storable: Record_ = {}
      for (const [key, value] of Object.entries(snapshot)) {
        if (key === 'id' || key === 'photos' || key === 'createdAt' || key === 'updatedAt') continue
        storable[key] = value
      }
      toast({
        message: `${config.singular} deleted.`,
        actionLabel: 'Undo',
        onAction: async () => {
          await api(config.path, { method: 'POST', body: storable })
        },
      })
    }
  }

  const back = (): void => {
    // Back to wherever the row was opened from, filters included — that is the
    // previous hash, not a recomputed one.
    if (window.history.length > 1) window.history.back()
    else navigate('stash', kind)
  }

  if (error) {
    return (
      <>
        <p className="error">{error}</p>
        <button type="button" className="button" onClick={back}>
          Back
        </button>
      </>
    )
  }

  if (record === null) return <p className="empty">Loading…</p>

  const photos = (record.photos as Photo[] | undefined) ?? []
  const tags = Array.isArray(record.tags) ? (record.tags as string[]) : []
  const name = String(record.name ?? record.title ?? '')
  const fraction = kind === 'fabric' ? remainingFraction(Number(record.lengthMm), Number(record.originalLengthMm)) : null

  return (
    <>
      {photos.length > 0 && (
        <div className="photo-grid detail-photos">
          {photos.map((photo) => (
            <figure key={photo.id}>
              <img
                src={photoUrl(photo.entityType, photo.entityId, photo.id)}
                alt=""
                width={photo.widthPx ?? undefined}
                height={photo.heightPx ?? undefined}
              />
            </figure>
          ))}
        </div>
      )}

      <div className="detail-head">
        <h2>{name}</h2>
        {tags.length > 0 && <p className="meta tags">{tags.map((tag) => `#${tag}`).join(' ')}</p>}
      </div>

      <dl className="detail-fields">
        {config.fields
          .filter((spec) => spec.kind !== 'tags')
          .map((spec) => {
            const shown = displayField(spec, record, unit)
            if (shown === '' || shown === false) return null
            return (
              <div className="detail-field" key={spec.name}>
                <dt>{spec.label}</dt>
                <dd>
                  {spec.name === 'repurchaseUrl' ? (
                    // Stored http(s)-only; the server refused anything else at write.
                    <a href={String(shown)} target="_blank" rel="noopener noreferrer">
                      {String(shown).replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <>
                      {typeof shown === 'boolean' ? 'Yes' : shown}
                      {/* A stored measure reads with its unit, as everywhere else. */}
                      {spec.unitKind && <span className="sub"> {unitLabel(spec.unitKind, unit)}</span>}
                    </>
                  )}
                </dd>
              </div>
            )
          })}
      </dl>

      {kind === 'fabric' && fraction !== null && (
        <div className="meter" role="img" aria-label={`${Math.round(fraction * 100)}% remaining`}>
          <div className="remaining" style={{ width: `${fraction * 100}%` }} />
        </div>
      )}

      {photoError && <p className="error">{photoError}</p>}

      <div className="actions">
        <button type="button" className="button" onClick={back}>
          Back
        </button>
        <button type="button" className="button" onClick={() => setSheet('edit')}>
          Edit
        </button>
        <button type="button" className="button danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>

      {sheet && (
        <EntitySheet
          key="detail-edit"
          title={`Edit ${config.singular.toLowerCase()}`}
          fields={config.fields}
          record={record}
          onSave={save}
          onDelete={remove}
          onClose={() => {
            setSheet(null)
            setPendingPhoto(null)
          }}
          leading={
            <>
              <PhotoField
                entityType={kind}
                entityId={id}
                photos={photos}
                pendingFile={pendingPhoto}
                onPendingFile={setPendingPhoto}
                onChanged={() => void reload()}
                onRequestPhoto={() => requestPhoto()}
              />
              {photoError && <p className="error">{photoError}</p>}
            </>
          }
        />
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
    </>
  )
}

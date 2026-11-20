import { useRef, useState } from 'react'
import { api, photoUrl, uploadPhoto } from '../api'
import { useCollection } from '../useCollection'
import { EntitySheet } from '../components/EntitySheet'
import { PhotoField } from '../components/PhotoField'
import { useToast } from '../components/Toast'
import { preparePhoto } from '../photo'
import { formatQuantity, joinMeta, remainingFraction } from '../format'
import { formatStored } from '../units'
import type { LengthUnit } from '../units'
import { useUnit } from '../unitPreference'
import { FABRIC_FIELDS, NOTION_FIELDS, THREAD_FIELDS, TOOL_FIELDS } from '../fields'
import type { FieldSpec } from '../fields'
import type { Photo, Tag } from '../../shared/model'

type Record_ = Record<string, unknown>
type Kind = 'fabric' | 'thread' | 'notion' | 'tool'

interface KindConfig {
  key: Kind
  label: string
  path: string
  fields: readonly FieldSpec[]
  singular: string
}

const KINDS: readonly KindConfig[] = [
  { key: 'fabric', label: 'Fabric', path: '/api/fabrics', fields: FABRIC_FIELDS, singular: 'Fabric' },
  { key: 'thread', label: 'Thread', path: '/api/threads', fields: THREAD_FIELDS, singular: 'Thread' },
  { key: 'notion', label: 'Notions', path: '/api/notions', fields: NOTION_FIELDS, singular: 'Notion' },
  { key: 'tool', label: 'Tools', path: '/api/tools', fields: TOOL_FIELDS, singular: 'Tool' },
]

const text = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value))
const number = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number(value))

/** Tags get their own line: in the subtitle they crowd out the fields you scan for. */
function TagLine({ item }: { item: Record_ }) {
  const tags = Array.isArray(item.tags) ? (item.tags as string[]) : []
  if (tags.length === 0) return null
  return <span className="meta tags">{tags.map((tag) => `#${tag}`).join(' ')}</span>
}

/** The row thumbnail: the record's first photo when it has one, its initials when not.
 *  The URL comes from the photo's own entityType/entityId, so a row never builds a
 *  URL from the tab it happens to be rendered under. */
function RowThumb({ photo, label }: { photo: Photo | undefined; label: string }) {
  if (photo) {
    return <img className="swatch" src={photoUrl(photo.entityType, photo.entityId, photo.id)} alt="" width={44} height={44} />
  }
  return (
    <span className="swatch" aria-hidden="true">
      {label.slice(0, 2)}
    </span>
  )
}

/** The yardage meter: remaining against original (design brief §7). */
function Meter({ remaining, original }: { remaining: number | null; original: number | null }) {
  const fraction = remainingFraction(remaining, original)
  if (fraction === null) return null
  return (
    <div className="meter" role="img" aria-label={`${Math.round(fraction * 100)}% remaining`}>
      <div className="remaining" style={{ width: `${fraction * 100}%` }} />
    </div>
  )
}

function Row({ kind, item, unit, onOpen }: { kind: Kind; item: Record_; unit: LengthUnit; onOpen: () => void }) {
  const name = String(item.name ?? item.title ?? '')
  const photos = (item.photos as Photo[] | undefined) ?? []
  /** A thread's initials are its colour's, when there is one; every other kind shows its name's. */
  const thumbFor = (fallback: string) => <RowThumb photo={photos[0]} label={fallback} />

  if (kind === 'fabric') {
    return (
      <button type="button" className="row" onClick={onOpen}>
        {thumbFor(name)}
        <span className="body">
          <span className="title">{name}</span>
          <span className="meta">{joinMeta([text(item.fibre), text(item.weight), text(item.colour), text(item.location)]) || 'No details yet'}</span>
          <TagLine item={item} />
          <Meter remaining={number(item.lengthMm)} original={number(item.originalLengthMm)} />
        </span>
        <span className="right">
          {formatStored(number(item.lengthMm), 'fabricLength', unit)}
          <span className="sub">left</span>
        </span>
      </button>
    )
  }

  if (kind === 'thread') {
    return (
      <button type="button" className="row" onClick={onOpen}>
        {thumbFor(text(item.colour)?.slice(0, 2) ?? 'th')}
        <span className="body">
          <span className="title">{name}</span>
          <span className="meta">{joinMeta([text(item.brand), text(item.fibre), text(item.colour), text(item.location)]) || 'No details yet'}</span>
          <TagLine item={item} />
        </span>
        <span className="right">{formatStored(number(item.lengthM), 'threadLength', unit)}</span>
      </button>
    )
  }

  if (kind === 'notion') {
    return (
      <button type="button" className="row" onClick={onOpen}>
        {thumbFor(name)}
        <span className="body">
          <span className="title">{name}</span>
          <span className="meta">{joinMeta([text(item.kind), text(item.colour), text(item.location), text(item.spec)]) || 'No details yet'}</span>
          <TagLine item={item} />
        </span>
        <span className="right">{formatQuantity(number(item.quantity), text(item.unit))}</span>
      </button>
    )
  }

  return (
    <button type="button" className="row" onClick={onOpen}>
      {thumbFor(name)}
      <span className="body">
        <span className="title">{name}</span>
        <span className="meta">{joinMeta([text(item.category)?.replace('_', ' '), text(item.brand), text(item.spec), text(item.location)]) || 'No details yet'}</span>
        <TagLine item={item} />
        {item.needsAttention === true && <span className="warn-line">Needs attention</span>}
      </span>
      <span className="right">{formatQuantity(number(item.quantity))}</span>
    </button>
  )
}

/** Dropping the server-owned fields, so an undo re-creates rather than conflicts. */
function storable(record: Record_): Record_ {
  const copy: Record_ = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || key === 'photos' || key === 'createdAt' || key === 'updatedAt') continue
    copy[key] = value
  }
  return copy
}

export function StashScreen() {
  const [kind, setKind] = useState<Kind>('fabric')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const config = KINDS.find((entry) => entry.key === kind) ?? KINDS[0]!
  const path = tagFilter ? `${config.path}?tag=${encodeURIComponent(tagFilter)}` : config.path
  const { items, error, reload } = useCollection<Record_>(path)
  const tagList = useCollection<Tag>('/api/tags')
  const toast = useToast()
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Read at file-arrival time, so the input does not need to be re-rendered per target.
  const photoTargetRef = useRef<string | null>(null)
  const { unit } = useUnit()

  const record = sheet?.mode === 'edit' ? items?.find((item) => item.id === sheet.id) ?? null : null

  /**
   * Open the camera. The click must happen inside a real user gesture — iOS
   * Safari refuses a programmatic click on a file input without user
   * activation, which is why this is called from the tap and not from an effect.
   */
  const requestPhoto = (fabricId: string | null): void => {
    photoTargetRef.current = fabricId
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  const onPhotoChosen = async (file: File | null): Promise<void> => {
    if (!file) return
    const target = photoTargetRef.current
    if (!target) {
      // Creating: hold it until the record exists to attach it to.
      setPendingPhoto(file)
      return
    }
    setPhotoError(null)
    try {
      const prepared = await preparePhoto(file)
      await uploadPhoto(kind, target, prepared.blob, prepared.widthPx, prepared.heightPx)
      await reload()
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Could not add the photo.')
    }
  }

  /** Fabric and notions are camera-first (design brief §7); the rest take a photo in the form. */
  const cameraFirst = kind === 'fabric' || kind === 'notion'

  const openCreate = (withCamera: boolean): void => {
    setPendingPhoto(null)
    setPhotoError(null)
    setSheet({ mode: 'create' })
    // Camera-first: the form opens *with* the camera, from this same tap.
    if (withCamera) requestPhoto(null)
  }

  const save = async (values: Record_): Promise<void> => {
    if (sheet?.mode === 'edit') {
      await api(`${config.path}/${sheet.id}`, { method: 'PUT', body: values })
    } else {
      const created = await api<{ id: string }>(config.path, { method: 'POST', body: values })
      if (pendingPhoto) {
        const prepared = await preparePhoto(pendingPhoto)
        await uploadPhoto(kind, created.id, prepared.blob, prepared.widthPx, prepared.heightPx)
      }
      setPendingPhoto(null)
    }
    await reload()
    await tagList.reload()
  }

  const remove = async (): Promise<void> => {
    if (sheet?.mode !== 'edit') return
    const snapshot = items?.find((item) => item.id === sheet.id)
    await api(`${config.path}/${sheet.id}`, { method: 'DELETE' })
    await reload()
    await tagList.reload()
    if (snapshot) {
      toast({
        message: `${config.singular} deleted.`,
        actionLabel: 'Undo',
        onAction: async () => {
          await api(config.path, { method: 'POST', body: storable(snapshot) })
          await reload()
        },
      })
    }
  }

  const photos = (record?.photos as Photo[] | undefined) ?? []

  return (
    <>
      <div className="segmented" role="group" aria-label="What to show">
        {KINDS.map((entry) => (
          <button
            type="button"
            key={entry.key}
            aria-pressed={entry.key === kind}
            onClick={() => {
              setKind(entry.key)
              setSheet(null)
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {(tagList.items ?? []).length > 0 && (
        <div className="segmented" role="group" aria-label="Filter by tag">
          <button type="button" aria-pressed={tagFilter === null} onClick={() => setTagFilter(null)}>
            All
          </button>
          {(tagList.items ?? []).map((tag) => (
            <button
              type="button"
              key={tag.id}
              aria-pressed={tagFilter === tag.name}
              onClick={() => setTagFilter(tagFilter === tag.name ? null : tag.name)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {items === null ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>Nothing in the {config.label.toLowerCase()} yet.</p>
          <button type="button" className="button primary" onClick={() => openCreate(cameraFirst)}>
            Add the first one
          </button>
        </div>
      ) : (
        <div className="card">
          {items.map((item) => (
            <Row key={String(item.id)} kind={kind} item={item} unit={unit} onOpen={() => setSheet({ mode: 'edit', id: String(item.id) })} />
          ))}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <button type="button" className="fab" onClick={() => openCreate(cameraFirst)}>
          Add {config.label.toLowerCase()}
        </button>
      )}

      {sheet && (
        <EntitySheet
          key={sheet.mode === 'edit' ? sheet.id : 'new'}
          title={sheet.mode === 'edit' ? `Edit ${config.singular.toLowerCase()}` : `New ${config.singular.toLowerCase()}`}
          fields={config.fields}
          record={record}
          onSave={save}
          onDelete={sheet.mode === 'edit' ? remove : undefined}
          onClose={() => {
            setSheet(null)
            setPendingPhoto(null)
          }}
          leading={
            <>
              <PhotoField
                entityType={kind}
                entityId={sheet.mode === 'edit' ? sheet.id : null}
                photos={photos}
                pendingFile={pendingPhoto}
                onPendingFile={setPendingPhoto}
                onChanged={() => void reload()}
                onRequestPhoto={requestPhoto}
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

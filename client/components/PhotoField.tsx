import { useEffect, useState } from 'react'
import { photoUrl } from '../api'
import type { Photo, TaggableType } from '../../shared/model'

interface PhotoFieldProps {
  /** What kind of record the photos hang on. */
  entityType: TaggableType
  /** Null while creating: the photo is held and uploaded once the record exists. */
  entityId: string | null
  photos: Photo[]
  pendingFile: File | null
  onPendingFile: (file: File | null) => void
  onChanged: () => void
  /**
   * Asks the screen to open the camera. The click has to come from a real user
   * gesture — iOS refuses a programmatic one — so the input lives on the screen
   * and this only forwards the intent.
   */
  onRequestPhoto: (entityId: string | null) => void
}

export function PhotoField({ entityType, entityId, photos, pendingFile, onPendingFile, onChanged, onRequestPhoto }: PhotoFieldProps) {
  const [removing, setRemoving] = useState(false)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  const remove = async (photoId: string): Promise<void> => {
    if (!entityId) return
    setRemoving(true)
    try {
      await fetch(photoUrl(entityType, entityId, photoId), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-boltbook-request': '1' },
      })
      onChanged()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Photos
      </span>

      {entityId
        ? photos.length > 0 && (
            <div className="photo-grid">
              {photos.map((photo) => (
                <figure key={photo.id}>
                  <img
                    src={photoUrl(entityType, entityId, photo.id)}
                    alt=""
                    width={photo.widthPx ?? undefined}
                    height={photo.heightPx ?? undefined}
                  />
                  <button type="button" aria-label="Remove photo" disabled={removing} onClick={() => void remove(photo.id)}>
                    ×
                  </button>
                </figure>
              ))}
            </div>
          )
        : pendingUrl && (
            <div className="photo-grid">
              <figure>
                <img src={pendingUrl} alt="" />
                <button type="button" aria-label="Remove photo" onClick={() => onPendingFile(null)}>
                  ×
                </button>
              </figure>
            </div>
          )}

      <button type="button" className="button" onClick={() => onRequestPhoto(entityId)}>
        {pendingFile || photos.length > 0 ? 'Add another photo' : 'Take a photo'}
      </button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { photoUrl, uploadPhoto } from '../api'
import { preparePhoto } from '../photo'
import type { FabricPhoto } from '../../shared/model'

interface PhotoFieldProps {
  /** Null while creating: the photo is held and uploaded once the fabric exists. */
  fabricId: string | null
  photos: FabricPhoto[]
  pendingFile: File | null
  onPendingFile: (file: File | null) => void
  onChanged: () => void
  /** Creating a fabric opens the camera straight away — camera-first (design brief §7). */
  autoOpenCamera?: boolean
}

/**
 * Photos are one tap from the top of the add flow. Downscale and EXIF stripping
 * happen in preparePhoto before anything leaves the device.
 */
export function PhotoField({ fabricId, photos, pendingFile, onPendingFile, onChanged, autoOpenCamera }: PhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  useEffect(() => {
    if (autoOpenCamera) inputRef.current?.click()
  }, [autoOpenCamera])

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  const choose = async (file: File | null): Promise<void> => {
    setError(null)
    if (!file) return
    if (!fabricId) {
      onPendingFile(file)
      return
    }
    setBusy(true)
    try {
      const prepared = await preparePhoto(file)
      await uploadPhoto(fabricId, prepared.blob, prepared.widthPx, prepared.heightPx)
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the photo.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (photoId: string): Promise<void> => {
    if (!fabricId) return
    setBusy(true)
    try {
      await fetch(photoUrl(fabricId, photoId), { method: 'DELETE', credentials: 'same-origin', headers: { 'x-boltbook-request': '1' } })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Photos
      </span>

      {fabricId ? (
        photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((photo) => (
              <figure key={photo.id}>
                <img src={photoUrl(fabricId, photo.id)} alt="" width={photo.widthPx ?? undefined} height={photo.heightPx ?? undefined} />
                <button type="button" aria-label="Remove photo" onClick={() => void remove(photo.id)}>
                  ×
                </button>
              </figure>
            ))}
          </div>
        )
      ) : (
        pendingUrl && (
          <div className="photo-grid">
            <figure>
              <img src={pendingUrl} alt="" />
              <button type="button" aria-label="Remove photo" onClick={() => onPendingFile(null)}>
                ×
              </button>
            </figure>
          </div>
        )
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          void choose(event.target.files?.[0] ?? null)
          event.target.value = ''
        }}
      />
      <button type="button" className="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {pendingFile || photos.length > 0 ? 'Add another photo' : 'Take a photo'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

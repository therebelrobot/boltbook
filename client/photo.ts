/**
 * Downscale before upload, and strip EXIF by re-encoding.
 *
 * Drawing the image through a canvas and encoding it again discards all
 * metadata — including the GPS tag a phone camera writes — which is why the
 * strip happens here rather than on the server (docs/technical-design.md §7).
 */

export interface PreparedPhoto {
  blob: Blob
  widthPx: number
  heightPx: number
}

export async function preparePhoto(file: File, maximumEdge = 2000, quality = 0.8): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maximumEdge / Math.max(bitmap.width, bitmap.height))
    const widthPx = Math.max(1, Math.round(bitmap.width * scale))
    const heightPx = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare images.')
    context.drawImage(bitmap, 0, 0, widthPx, heightPx)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('Could not encode the photo.')
    return { blob, widthPx, heightPx }
  } finally {
    bitmap.close()
  }
}

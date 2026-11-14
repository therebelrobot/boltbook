/**
 * Downscale before upload, and strip EXIF by re-encoding.
 *
 * Drawing the image through a canvas and encoding it again discards all
 * metadata — including the GPS tag a phone camera writes — which is why the
 * strip happens here rather than on the server (docs/technical-design.md §7).
 *
 * Decoding is tried two ways: `createImageBitmap` first, then an `<img>`. Some
 * browsers can *display* a HEIC photo (what an iPhone hands over) but refuse it
 * in `createImageBitmap`, so the fallback is what makes a camera roll work at
 * all. If both fail the message says so, rather than surfacing a decode error.
 */

export interface PreparedPhoto {
  blob: Blob
  widthPx: number
  heightPx: number
}

interface DecodedImage {
  width: number
  height: number
  draw(context: CanvasRenderingContext2D, width: number, height: number): void
  release(): void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        release: () => bitmap.close(),
      }
    } catch {
      // Fall through: the browser may still be able to render it in an <img>.
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('decode failed'))
      element.src = objectUrl
    })
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch {
    URL.revokeObjectURL(objectUrl)
    throw new Error('That image could not be read. Try a JPEG or PNG.')
  }
}

export async function preparePhoto(file: File, maximumEdge = 2000, quality = 0.8): Promise<PreparedPhoto> {
  const decoded = await decodeImage(file)
  try {
    const scale = Math.min(1, maximumEdge / Math.max(decoded.width, decoded.height))
    const widthPx = Math.max(1, Math.round(decoded.width * scale))
    const heightPx = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare images.')
    decoded.draw(context, widthPx, heightPx)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('Could not encode the photo.')
    // Some builds hand back a blob with an empty type; the server needs one.
    const typed = blob.type === '' ? blob.slice(0, blob.size, 'image/jpeg') : blob
    return { blob: typed, widthPx, heightPx }
  } finally {
    decoded.release()
  }
}

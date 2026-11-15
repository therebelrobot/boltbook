/**
 * Local envelope OCR.
 *
 * Tesseract is compiled to WebAssembly and runs in a Web Worker, served from
 * this app. The downscaled JPEG is handed to the worker in memory; it is never
 * uploaded. `tesseract.js` itself is dynamically imported so the initial app
 * bundle does not carry it.
 */

export interface OcrWorkerHandle {
  terminate: () => Promise<unknown>
}

export interface OcrOptions {
  onProgress?: (status: string, progress: number) => void
  /** Gives the caller the worker so it can cancel a slow scan. */
  onWorker?: (worker: OcrWorkerHandle) => void
}

export interface EnvelopeOcrResult {
  text: string
  confidence: number
}

export async function recognizeEnvelope(image: Blob, options: OcrOptions = {}): Promise<EnvelopeOcrResult> {
  const { createWorker, PSM } = await import('tesseract.js')

  const worker = await createWorker('eng', 1, {
    // All three are copied from node_modules by scripts/copy-ocr-assets.mjs.
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core/tesseract-core-simd-lstm.wasm.js',
    langPath: '/ocr/lang',
    // A same-origin worker path, and no blob: worker under the CSP.
    workerBlobURL: false,
    gzip: true,
    logger: (message) => {
      if (typeof message.progress === 'number') options.onProgress?.(message.status, message.progress)
    },
  })

  options.onWorker?.(worker)
  try {
    // The envelope is a single block of mixed display type, not a page of prose.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    const result = await worker.recognize(image)
    return { text: result.data.text, confidence: result.data.confidence }
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}

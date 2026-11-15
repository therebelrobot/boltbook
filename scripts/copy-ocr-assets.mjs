import { cpSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Tesseract.js loads three things at runtime that are not part of the JS
 * bundle: the worker script, the WASM core, and the English traineddata. They
 * live in node_modules, which the client does not serve, so copy the minimum
 * set into client/public/ocr before a dev or build run.
 *
 * The SIMD + LSTM-only core is the smallest modern variant. The `best_int`
 * English model is 2.8 MB and is the accuracy/size compromise for envelopes;
 * a better model can replace the file without touching the app.
 */
const root = path.resolve(import.meta.dirname, '..')
const from = path.join(root, 'node_modules')
const to = path.join(root, 'client', 'public', 'ocr')

const worker = path.join(from, 'tesseract.js', 'dist', 'worker.min.js')
const core = path.join(from, 'tesseract.js-core')
const language = path.join(from, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')

for (const required of [worker, language, path.join(core, 'tesseract-core-simd-lstm.wasm.js')]) {
  if (!existsSync(required)) throw new Error(`OCR asset missing: ${required}. Run npm install first.`)
}

mkdirSync(path.join(to, 'core'), { recursive: true })
mkdirSync(path.join(to, 'lang'), { recursive: true })

cpSync(worker, path.join(to, 'worker.min.js'))
for (const file of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm']) {
  cpSync(path.join(core, file), path.join(to, 'core', file))
}
cpSync(language, path.join(to, 'lang', 'eng.traineddata.gz'))

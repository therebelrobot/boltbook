import { cpSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * pdf.js fetches CMaps, standard fonts, wasm and ICC profiles at runtime.
 * They live in node_modules, which the client does not serve, so copy them
 * into client/public/pdfjs before a dev or build run. The directory is
 * generated (gitignored), never edited by hand.
 */
const root = path.resolve(import.meta.dirname, '..')
const from = path.join(root, 'node_modules', 'pdfjs-dist')
const to = path.join(root, 'client', 'public', 'pdfjs')

const directories = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

mkdirSync(to, { recursive: true })
for (const directory of directories) {
  const source = path.join(from, directory)
  if (!existsSync(source)) continue
  cpSync(source, path.join(to, directory), { recursive: true, force: true })
}

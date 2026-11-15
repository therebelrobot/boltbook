import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export interface StaticAsset {
  contentType: string
  body: Buffer
  /** Hashed filenames from Vite never change, so they can be cached forever. */
  isFingerprinted: boolean
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
}

/**
 * Reads the built client into an allow-list at startup: only the files that
 * existed then are servable, so there is no path-traversal surface at all.
 * An absent directory yields an empty map, which the server reports as
 * "client not built" rather than failing.
 */
export function loadStaticAssets(directory: string): Map<string, StaticAsset> {
  const assets = new Map<string, StaticAsset>()
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return assets

  const walk = (absoluteDirectory: string): void => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const child = path.join(absoluteDirectory, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      const relativePath = `/${path.relative(directory, child).split(path.sep).join('/')}`
      const contentType = CONTENT_TYPES[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream'
      assets.set(relativePath, {
        contentType,
        body: readFileSync(child),
        isFingerprinted: /-[A-Za-z0-9_]{8,}\./.test(entry.name),
      })
    }
  }

  walk(directory)
  return assets
}

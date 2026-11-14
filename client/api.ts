import type { AuthStatus, FabricPhoto } from '../shared/model'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    return new ApiError(response.status, body.error ?? 'error', body.message ?? 'Something went wrong.')
  } catch {
    return new ApiError(response.status, 'error', 'Something went wrong.')
  }
}

/**
 * The client half of the auth contract: `x-boltbook-request` on every request,
 * cookies with the request, and a typed error the screens can show.
 */
export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const hasBody = options.body !== undefined
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'x-boltbook-request': '1', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const getStatus = () => api<AuthStatus>('/api/status')
export const signIn = (passphrase: string, totpCode?: string) =>
  api<{ ok: true }>('/api/login', { method: 'POST', body: { passphrase, totpCode } })
export const claim = (setupToken: string, passphrase: string) =>
  api<{ ok: true }>('/api/setup', { method: 'POST', body: { setupToken, passphrase } })
export const signOut = () => api<{ ok: true }>('/api/logout', { method: 'POST', body: {} })

export async function uploadPhoto(fabricId: string, blob: Blob, widthPx: number, heightPx: number): Promise<FabricPhoto> {
  const response = await fetch(`/api/fabrics/${fabricId}/photos?widthPx=${widthPx}&heightPx=${heightPx}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-boltbook-request': '1', 'content-type': blob.type },
    body: blob,
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as FabricPhoto
}

export const photoUrl = (fabricId: string, photoId: string): string => `/api/fabrics/${fabricId}/photos/${photoId}`

export interface RestoreResult {
  ok: true
  photos: number
  imported: Record<string, number>
}

/** Restore an export. Raw bytes, and the mode that says "replace everything". */
export async function restoreExport(file: File): Promise<RestoreResult> {
  const response = await fetch('/api/import?mode=replace', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-boltbook-request': '1', 'content-type': 'application/zip' },
    body: file,
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as RestoreResult
}

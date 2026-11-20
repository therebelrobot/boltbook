/** Display helpers. Pure, so they are unit-tested without a DOM. */

export function formatLengthMm(millimetres: number | null | undefined): string {
  if (millimetres === null || millimetres === undefined) return '—'
  if (millimetres < 1000) return `${Math.round(millimetres)} mm`
  return `${(millimetres / 1000).toFixed(2)} m`
}

export function formatMetres(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return '—'
  return `${metres} m`
}

/** Bytes as a person reads them: 1.4 MB, not 1,431,552. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
  return `${(bytes / 1024).toFixed(0)} kB`
}

export function formatQuantity(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '—'
  return unit ? `${value} ${unit}` : String(value)
}

export function formatMoney(minorUnits: number | null | undefined, currency: string | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined || !currency) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minorUnits / 100)
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`
  }
}

export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  return isoDate.slice(0, 10)
}

/** Join the parts of a row's subtitle, dropping the empty ones. */
export function joinMeta(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

/** What fraction of the original is left, clamped to 0–1; null when unknown. */
export function remainingFraction(remaining: number | null | undefined, original: number | null | undefined): number | null {
  if (remaining === null || remaining === undefined) return null
  // With no original length the bar would read "full", which would be a lie.
  if (original === null || original === undefined || original <= 0) return null
  return Math.max(0, Math.min(1, remaining / original))
}

/**
 * A fabric's remaining length is the sum of its cuts — derived, never stored.
 * null when nothing is measured yet; an unmeasured cut contributes nothing
 * rather than inventing a zero that would understate what is on the shelf.
 */
export function fabricRemaining(
  fabric: { cuts: ReadonlyArray<{ lengthMm: number | null }> } | null | undefined,
): number | null {
  const cuts = fabric?.cuts ?? []
  if (cuts.length === 0) return null
  if (cuts.every((cut) => cut.lengthMm === null)) return null
  return cuts.reduce((sum, cut) => sum + (cut.lengthMm ?? 0), 0)
}

/** The original length behaves the same way: the sum of what the cuts were bought as. */
export function fabricOriginal(
  fabric: { cuts: ReadonlyArray<{ originalLengthMm: number | null }> } | null | undefined,
): number | null {
  const cuts = fabric?.cuts ?? []
  if (cuts.length === 0) return null
  if (cuts.every((cut) => cut.originalLengthMm === null)) return null
  return cuts.reduce((sum, cut) => sum + (cut.originalLengthMm ?? 0), 0)
}

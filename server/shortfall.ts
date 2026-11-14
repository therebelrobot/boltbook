import type { ConsumableKind, ShortfallLine } from '../shared/model'

/**
 * The allocation maths, kept pure so it is tested without a database.
 *
 * "What is left" always means *remaining minus reserved*: a project reserves
 * what it intends to use while it is active (planned, cutting, sewing), and
 * consumes it — decrementing the stash — only when it reaches done. Two active
 * projects therefore cannot each count the same metre.
 */

export interface AllocationClaim {
  kind: ConsumableKind
  targetId: string
  /** What this project intends to use; null means "allocated, amount unknown". */
  amount: number | null
}

export interface ShortfallContext {
  /** Stash remaining per `${kind}:${id}`; absent or null means none. */
  remaining: Record<string, number | null | undefined>
  /** Amount other active projects have reserved, same keys. */
  reserved: Record<string, number | undefined>
  /** Fabric widths in millimetres, same keys (fabric only). */
  widthMm?: Record<string, number | null | undefined>
  /** The pattern view's required fabric width, if it states one. */
  requiredWidthMm?: number | null
}

export const keyOf = (kind: ConsumableKind, targetId: string): string => `${kind}:${targetId}`

export function availableAmount(context: ShortfallContext, kind: ConsumableKind, targetId: string): number {
  const key = keyOf(kind, targetId)
  const remaining = context.remaining[key] ?? 0
  const reserved = context.reserved[key] ?? 0
  return Math.max(0, remaining - reserved)
}

export function computeShortfalls(claims: AllocationClaim[], context: ShortfallContext): ShortfallLine[] {
  return claims.map((claim) => {
    const available = availableAmount(context, claim.kind, claim.targetId)
    const needed = claim.amount
    const short = needed === null ? 0 : Math.max(0, needed - available)

    let tooNarrow = false
    if (claim.kind === 'fabric' && context.requiredWidthMm !== null && context.requiredWidthMm !== undefined) {
      const width = context.widthMm?.[keyOf(claim.kind, claim.targetId)]
      if (width !== null && width !== undefined && width < context.requiredWidthMm) tooNarrow = true
    }

    return { kind: claim.kind, targetId: claim.targetId, needed, available, short, tooNarrow }
  })
}

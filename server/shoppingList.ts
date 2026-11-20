import type { ShoppingListItem } from '../shared/model'
import { imperialUnitFor, toImperial, type Units } from './units'

/**
 * The shopping list's presentation: what a project is short of, as something
 * you could act on at a shop. The repository supplies canonical metric lines;
 * this converts them for the caller's unit preference and renders the text
 * form the copy button and the printer both use.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100

/** Convert amounts to the caller's units; notions are counts and never move. */
export function presentShoppingList(items: readonly ShoppingListItem[], units: Units): ShoppingListItem[] {
  if (units === 'metric') return items.map((item) => ({ ...item }))
  return items.map((item) => {
    if (item.kind === 'fabric') {
      return { ...item, amount: toImperial(item.amount, 'fabricLength'), unit: imperialUnitFor('fabricLength') }
    }
    if (item.kind === 'thread') {
      return { ...item, amount: round2(toImperial(item.amount, 'threadLength')), unit: imperialUnitFor('threadLength') }
    }
    return { ...item }
  })
}

const GROUP_LABELS: Record<ShoppingListItem['kind'], string> = {
  fabric: 'Fabric',
  thread: 'Thread',
  notion: 'Notions',
}

const amountLabel = (item: ShoppingListItem): string => {
  const unit = item.unit ?? ''
  return `${item.amount}${unit ? ` ${unit}` : ''}`
}

/**
 * The plain-text form: what the copy button puts on the clipboard and what the
 * print stylesheet lays out. Grouped by kind, short lines only, source shown
 * when the record stores one.
 */
export function shoppingListText(title: string, items: readonly ShoppingListItem[]): string {
  const header = `Shopping list — ${title}`
  if (items.length === 0) return `${header}\n\nNothing to buy — the stash covers this project.`

  const sections: string[] = [header]
  for (const kind of ['fabric', 'thread', 'notion'] as const) {
    const group = items.filter((item) => item.kind === kind)
    if (group.length === 0) continue
    sections.push('')
    sections.push(GROUP_LABELS[kind])
    for (const item of group) {
      const identified = item.detail ? `${item.name} (${item.detail})` : item.name
      const from = item.source ? ` — from ${item.source}` : ''
      sections.push(`- ${identified} — ${amountLabel(item)}${from}`)
    }
  }
  return sections.join('\n')
}

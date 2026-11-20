import { useEffect, useState } from 'react'

export interface Route {
  name: string
  id: string | null
  /**
   * The path segments after the id, decoded — for routes that carry more than
   * one piece of state (`#/stash/notion/jeans` is the notion list, filtered to
   * the jeans tag). Keeping them in the hash is what makes Back return to the
   * list exactly as it was left.
   */
  rest: string[]
}

const TABS = ['stash', 'patterns', 'projects', 'search'] as const
export type TabName = (typeof TABS)[number]
export const tabNames = TABS

function decodeSegment(segment: string | undefined): string | null {
  if (segment === undefined || segment === '') return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function parseRoute(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '')
  const [name = 'stash', ...segments] = cleaned.split('/')
  const [id, ...rest] = segments
  return { name: name || 'stash', id: decodeSegment(id), rest: rest.map((segment) => decodeSegment(segment) ?? '') }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHashChange = (): void => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}

export function navigate(name: string, id?: string, ...rest: string[]): void {
  const segments = [name, ...(id !== undefined && id !== '' ? [id] : []), ...rest.filter((segment) => segment !== '')]
  window.location.hash = `#/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}

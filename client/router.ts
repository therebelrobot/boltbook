import { useEffect, useState } from 'react'

export interface Route {
  name: string
  id: string | null
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
  const [name = 'stash', id] = cleaned.split('/')
  return { name: name || 'stash', id: decodeSegment(id) }
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

export function navigate(name: string, id?: string): void {
  window.location.hash = `#/${name}${id ? `/${encodeURIComponent(id)}` : ''}`
}

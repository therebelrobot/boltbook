import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatStored } from '../units'
import { useUnit } from '../unitPreference'
import type { SearchHit } from '../../shared/model'
import type { TabName } from '../router'

const TAB_FOR_TYPE: Record<SearchHit['type'], TabName> = {
  fabric: 'stash',
  thread: 'stash',
  tool: 'stash',
  pattern: 'patterns',
}

/** One box over everything indexed. Results do not animate — they are data (design brief §5). */
export function SearchScreen({ onOpenTab }: { onOpenTab: (tab: TabName) => void }) {
  const { unit } = useUnit()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (query.trim() === '') {
      setHits([])
      return
    }
    const timer = window.setTimeout(() => {
      api<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((result) => {
          setHits(result)
          setError(null)
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not search.'))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [query])

  return (
    <>
      <label className="field" htmlFor="search">
        <span className="label">Search the stash and the library</span>
        <input
          id="search"
          type="text"
          enterKeyHint="search"
          autoCapitalize="none"
          placeholder="linen, chambray, Grainline…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error && <p className="error">{error}</p>}

      {query.trim() !== '' && hits.length === 0 && !error && <p className="empty">Nothing found.</p>}

      {hits.length > 0 && (
        <div className="card">
          {hits.map((hit) => (
            <button type="button" className="row" key={`${hit.type}-${hit.id}`} onClick={() => onOpenTab(TAB_FOR_TYPE[hit.type])}>
              <span className="body">
                <span className="title">{hit.title}</span>
                <span className="meta">
                  <span className="chip">{hit.type}</span>
                  {hit.snippet && <span>{hit.snippet.replace(/[[\]]/g, '')}</span>}
                </span>
              </span>
              {hit.lengthMm !== null && <span className="right">{formatStored(hit.lengthMm, 'fabricLength', unit)}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

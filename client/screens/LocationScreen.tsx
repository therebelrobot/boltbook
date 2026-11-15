import { useEffect, useState, type ReactNode } from 'react'
import { api, photoUrl } from '../api'
import { formatQuantity, joinMeta } from '../format'
import { formatStored } from '../units'
import { useUnit } from '../unitPreference'
import type { Fabric, Notion, Thread, Tool } from '../../shared/model'

interface LocationScreenProps {
  name: string
}

interface AtLocation {
  fabrics: Fabric[]
  threads: Thread[]
  notions: Notion[]
  tools: Tool[]
}

const byLocation = (path: string, name: string): string => `${path}?location=${encodeURIComponent(name)}`

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section className="location-section">
      <h3 className="section-title">
        {title} <span>{count}</span>
      </h3>
      <div className="card">{children}</div>
    </section>
  )
}

/**
 * What a scanned storage label opens: every record at that location, whatever
 * kind it is. Fabric, thread, notions and tools live on different screens, so
 * this is the one view that answers "what is in this bin?".
 */
export function LocationScreen({ name }: LocationScreenProps) {
  const { unit } = useUnit()
  const [at, setAt] = useState<AtLocation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setAt(null)
    setError(null)
    Promise.all([
      api<Fabric[]>(byLocation('/api/fabrics', name)),
      api<Thread[]>(byLocation('/api/threads', name)),
      api<Notion[]>(byLocation('/api/notions', name)),
      api<Tool[]>(byLocation('/api/tools', name)),
    ])
      .then(([fabrics, threads, notions, tools]) => {
        if (!cancelled) setAt({ fabrics, threads, notions, tools })
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load this location.')
      })
    return () => {
      cancelled = true
    }
  }, [name])

  const total = at ? at.fabrics.length + at.threads.length + at.notions.length + at.tools.length : 0

  return (
    <>
      {at && (
        <p className="muted location-summary">
          {total === 0
            ? 'Nothing is recorded here.'
            : `${total} record${total === 1 ? '' : 's'} at this location.`}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {at === null ? (
        <p className="empty">Loading…</p>
      ) : total === 0 ? (
        <div className="empty">
          <p>Nothing is recorded in {name}.</p>
          <p className="muted">The label may be older than the stash, or the item moved.</p>
        </div>
      ) : (
        <>
          <Section title="Fabric" count={at.fabrics.length}>
            {at.fabrics.map((fabric) => (
              <div className="row static" key={fabric.id}>
                {fabric.photos[0] ? (
                  <img
                    className="swatch"
                    src={photoUrl(fabric.id, fabric.photos[0].id)}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : (
                  <span className="swatch" aria-hidden="true">
                    {fabric.name.slice(0, 2)}
                  </span>
                )}
                <span className="body">
                  <span className="title">{fabric.name}</span>
                  <span className="meta">
                    {joinMeta([
                      fabric.fibre,
                      fabric.widthMm ? formatStored(fabric.widthMm, 'fabricWidth', unit) : null,
                      fabric.colour,
                    ]) || 'No details yet'}
                  </span>
                </span>
                <span className="right">
                  {formatStored(fabric.lengthMm, 'fabricLength', unit)}
                  <span className="sub">left</span>
                </span>
              </div>
            ))}
          </Section>

          <Section title="Thread" count={at.threads.length}>
            {at.threads.map((thread) => (
              <div className="row static" key={thread.id}>
                <span className="swatch" aria-hidden="true">
                  {thread.colour?.slice(0, 2) ?? 'th'}
                </span>
                <span className="body">
                  <span className="title">{thread.name}</span>
                  <span className="meta">
                    {joinMeta([thread.brand, thread.fibre, thread.colour]) || 'No details yet'}
                  </span>
                </span>
                <span className="right">{formatStored(thread.lengthM, 'threadLength', unit)}</span>
              </div>
            ))}
          </Section>

          <Section title="Notions" count={at.notions.length}>
            {at.notions.map((notion) => (
              <div className="row static" key={notion.id}>
                <span className="body">
                  <span className="title">{notion.name}</span>
                  <span className="meta">
                    {joinMeta([notion.kind, notion.colour, notion.spec]) || 'No details yet'}
                  </span>
                </span>
                <span className="right">{formatQuantity(notion.quantity, notion.unit)}</span>
              </div>
            ))}
          </Section>

          <Section title="Tools" count={at.tools.length}>
            {at.tools.map((tool) => (
              <div className="row static" key={tool.id}>
                <span className="body">
                  <span className="title">{tool.name}</span>
                  <span className="meta">
                    {joinMeta([tool.category?.replace('_', ' '), tool.brand, tool.spec]) || 'No details yet'}
                  </span>
                  {tool.needsAttention && <span className="warn-line">Needs attention</span>}
                </span>
                <span className="right">{formatQuantity(tool.quantity)}</span>
              </div>
            ))}
          </Section>
        </>
      )}
    </>
  )
}

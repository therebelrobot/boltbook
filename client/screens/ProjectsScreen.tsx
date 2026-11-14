import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCollection } from '../useCollection'
import { EntitySheet } from '../components/EntitySheet'
import { useToast } from '../components/Toast'
import { PROJECT_FIELDS } from '../fields'
import { formatQuantity, joinMeta } from '../format'
import { formatStored } from '../units'
import type { LengthUnit } from '../units'
import { useUnit } from '../unitPreference'
import type { Notion, ProjectAllocations, ShortfallLine, Thread, Fabric } from '../../shared/model'

interface Project {
  id: string
  title: string
  status: string
  startedOn: string | null
  tags: string[]
  allocations: ProjectAllocations
}

const PATHS = '/api/projects'

const statusLabel = (status: string): string => status.charAt(0).toUpperCase() + status.slice(1)

function nameFor(
  line: ShortfallLine,
  fabrics: Fabric[],
  threads: Thread[],
  notions: Notion[],
  unit: LengthUnit,
): string {
  if (line.kind === 'fabric') {
    const fabric = fabrics.find((entry) => entry.id === line.targetId)
    return fabric ? `${fabric.name} (${formatStored(fabric.lengthMm, 'fabricLength', unit)} left)` : 'Unknown fabric'
  }
  if (line.kind === 'thread') {
    const thread = threads.find((entry) => entry.id === line.targetId)
    return thread ? `${thread.name}${thread.colour ? ` — ${thread.colour}` : ''}` : 'Unknown thread'
  }
  const notion = notions.find((entry) => entry.id === line.targetId)
  return notion ? notion.name : 'Unknown notion'
}

/** A shortfall is reported in the unit the claim was made in. */
const neededLabel = (kind: ShortfallLine['kind'], value: number | null, unit: LengthUnit): string =>
  kind === 'fabric'
    ? formatStored(value, 'fabricLength', unit)
    : kind === 'thread'
      ? formatStored(value, 'threadLength', unit)
      : formatQuantity(value)

/**
 * Allocation and the shortfall readout, applied the moment it changes — the one
 * piece of real domain logic, surfaced (docs/technical-design.md §8).
 */
function AllocationEditor({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const fabrics = useCollection<Fabric>('/api/fabrics')
  const threads = useCollection<Thread>('/api/threads')
  const notions = useCollection<Notion>('/api/notions')
  const { unit } = useUnit()
  const [allocations, setAllocations] = useState<ProjectAllocations>(project.allocations)
  const [lines, setLines] = useState<ShortfallLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<{ fabric: string; thread: string; notion: string }>({ fabric: '', thread: '', notion: '' })
  const [amount, setAmount] = useState<{ fabric: string; thread: string; notion: string }>({ fabric: '', thread: '', notion: '' })

  const refreshShortfall = async (): Promise<void> => {
    try {
      const result = await api<{ lines: ShortfallLine[] }>(`${PATHS}/${project.id}/shortfall`)
      setLines(result.lines)
    } catch {
      setLines([])
    }
  }

  useEffect(() => {
    void refreshShortfall()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const apply = async (next: ProjectAllocations): Promise<void> => {
    setError(null)
    try {
      await api(`${PATHS}/${project.id}/allocations`, { method: 'PUT', body: next })
      setAllocations(next)
      await refreshShortfall()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the allocation.')
    }
  }

  const toNumberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value))

  const add = (kind: 'fabrics' | 'threads' | 'notions'): void => {
    const id = choice[kind === 'fabrics' ? 'fabric' : kind === 'threads' ? 'thread' : 'notion']
    if (!id) return
    const raw = amount[kind === 'fabrics' ? 'fabric' : kind === 'threads' ? 'thread' : 'notion']
    const next: ProjectAllocations = {
      fabrics: [...allocations.fabrics],
      threads: [...allocations.threads],
      notions: [...allocations.notions],
    }
    if (kind === 'fabrics') next.fabrics.push({ fabricId: id, lengthMmUsed: toNumberOrNull(raw) })
    if (kind === 'threads') next.threads.push({ threadId: id, lengthMUsed: toNumberOrNull(raw) })
    if (kind === 'notions') next.notions.push({ notionId: id, quantityUsed: toNumberOrNull(raw) })
    void apply(next)
  }

  const removeAt = (kind: 'fabrics' | 'threads' | 'notions', index: number): void => {
    const next: ProjectAllocations = {
      fabrics: allocations.fabrics.filter((_, i) => !(kind === 'fabrics' && i === index)),
      threads: allocations.threads.filter((_, i) => !(kind === 'threads' && i === index)),
      notions: allocations.notions.filter((_, i) => !(kind === 'notions' && i === index)),
    }
    void apply(next)
  }

  const rows = [
    ...allocations.fabrics.map((entry, index) => ({ kind: 'fabrics' as const, index, line: lines.find((line) => line.kind === 'fabric' && line.targetId === entry.fabricId), label: nameFor({ kind: 'fabric', targetId: entry.fabricId, needed: entry.lengthMmUsed, available: 0, short: 0, tooNarrow: false }, fabrics.items ?? [], threads.items ?? [], notions.items ?? [], unit) })),
    ...allocations.threads.map((entry, index) => ({ kind: 'threads' as const, index, line: lines.find((line) => line.kind === 'thread' && line.targetId === entry.threadId), label: nameFor({ kind: 'thread', targetId: entry.threadId, needed: entry.lengthMUsed, available: 0, short: 0, tooNarrow: false }, fabrics.items ?? [], threads.items ?? [], notions.items ?? [], unit) })),
    ...allocations.notions.map((entry, index) => ({ kind: 'notions' as const, index, line: lines.find((line) => line.kind === 'notion' && line.targetId === entry.notionId), label: nameFor({ kind: 'notion', targetId: entry.notionId, needed: entry.quantityUsed, available: 0, short: 0, tooNarrow: false }, fabrics.items ?? [], threads.items ?? [], notions.items ?? [], unit) })),
  ]

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Allocation
      </span>

      {rows.length === 0 && <p className="muted">Nothing allocated yet. Pick what this project will use.</p>}

      {rows.map((row) => (
        <div className="row" key={`${row.kind}-${row.index}`} style={{ cursor: 'default' }}>
          <span className="body">
            <span className="title">{row.label}</span>
            <span className="meta">
              needs {row.line ? neededLabel(row.line.kind, row.line.needed, unit) : '—'} · available{' '}
              {row.line ? neededLabel(row.line.kind, row.line.available, unit) : '—'}
            </span>
            {row.line && row.line.short > 0 && (
              <span className="short-line">Short {neededLabel(row.line.kind, row.line.short, unit)}</span>
            )}
            {row.line?.tooNarrow && <span className="warn-line">Too narrow for the pattern</span>}
          </span>
          <button type="button" className="button plain" onClick={() => removeAt(row.kind, row.index)} aria-label="Remove allocation">
            Remove
          </button>
        </div>
      ))}

      <div className="field">
        <span className="label">Add fabric</span>
        <select value={choice.fabric} onChange={(event) => setChoice((current) => ({ ...current, fabric: event.target.value }))}>
          <option value="">—</option>
          {(fabrics.items ?? []).map((fabric) => (
            <option key={fabric.id} value={fabric.id}>
              {fabric.name} ({formatStored(fabric.lengthMm, 'fabricLength', unit)})
            </option>
          ))}
        </select>
        <input
          inputMode="numeric"
          placeholder="mm used"
          value={amount.fabric}
          onChange={(event) => setAmount((current) => ({ ...current, fabric: event.target.value }))}
          style={{ marginTop: '0.35rem' }}
        />
        <button type="button" className="button" onClick={() => add('fabrics')} style={{ marginTop: '0.35rem' }}>
          Add fabric
        </button>
      </div>

      <div className="field">
        <span className="label">Add thread</span>
        <select value={choice.thread} onChange={(event) => setChoice((current) => ({ ...current, thread: event.target.value }))}>
          <option value="">—</option>
          {(threads.items ?? []).map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.name}
              {thread.colour ? ` — ${thread.colour}` : ''}
            </option>
          ))}
        </select>
        <input
          inputMode="numeric"
          placeholder="metres used"
          value={amount.thread}
          onChange={(event) => setAmount((current) => ({ ...current, thread: event.target.value }))}
          style={{ marginTop: '0.35rem' }}
        />
        <button type="button" className="button" onClick={() => add('threads')} style={{ marginTop: '0.35rem' }}>
          Add thread
        </button>
      </div>

      <div className="field">
        <span className="label">Add notions</span>
        <select value={choice.notion} onChange={(event) => setChoice((current) => ({ ...current, notion: event.target.value }))}>
          <option value="">—</option>
          {(notions.items ?? []).map((notion) => (
            <option key={notion.id} value={notion.id}>
              {notion.name}
            </option>
          ))}
        </select>
        <input
          inputMode="decimal"
          placeholder="quantity used"
          value={amount.notion}
          onChange={(event) => setAmount((current) => ({ ...current, notion: event.target.value }))}
          style={{ marginTop: '0.35rem' }}
        />
        <button type="button" className="button" onClick={() => add('notions')} style={{ marginTop: '0.35rem' }}>
          Add notions
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function ProjectsScreen() {
  const { items, error, reload } = useCollection<Project>(PATHS)
  const toast = useToast()
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
  const record = sheet?.mode === 'edit' ? items?.find((item) => item.id === sheet.id) ?? null : null

  const save = async (values: Record<string, unknown>): Promise<void> => {
    if (sheet?.mode === 'edit') await api(`${PATHS}/${sheet.id}`, { method: 'PUT', body: values })
    else await api(PATHS, { method: 'POST', body: values })
    await reload()
  }

  const remove = async (): Promise<void> => {
    if (sheet?.mode !== 'edit') return
    await api(`${PATHS}/${sheet.id}`, { method: 'DELETE' })
    await reload()
    toast({ message: 'Project deleted.' })
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
          <button type="button" className="button primary" onClick={() => setSheet({ mode: 'create' })}>
            Start a project
          </button>
        </div>
      ) : (
        <div className="card">
          {items.map((project) => (
            <button type="button" className="row" key={project.id} onClick={() => setSheet({ mode: 'edit', id: project.id })}>
              <span className="body">
                <span className="title">{project.title}</span>
                <span className="meta">
                  {joinMeta([
                    statusLabel(project.status),
                    project.startedOn && `started ${project.startedOn}`,
                    project.allocations.fabrics.length > 0 && `${project.allocations.fabrics.length} fabric`,
                    project.tags.length > 0 && project.tags.map((tag) => `#${tag}`).join(' '),
                  ]) || 'No allocation'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <button type="button" className="fab" onClick={() => setSheet({ mode: 'create' })}>
          New project
        </button>
      )}

      {sheet && (
        <EntitySheet
          key={sheet.mode === 'edit' ? sheet.id : 'new'}
          title={sheet.mode === 'edit' ? 'Edit project' : 'New project'}
          fields={PROJECT_FIELDS}
          record={record as Record<string, unknown> | null}
          onSave={save}
          onDelete={sheet.mode === 'edit' ? remove : undefined}
          onClose={() => setSheet(null)}
        >
          {sheet.mode === 'edit' && record ? (
            <AllocationEditor project={record} onChanged={() => void reload()} />
          ) : (
            <p className="muted">Save the project, then allocate fabric, thread and notions.</p>
          )}
        </EntitySheet>
      )}
    </>
  )
}

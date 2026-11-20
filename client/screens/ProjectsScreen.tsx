import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, photoUrl, uploadPhoto } from '../api'
import { useCollection } from '../useCollection'
import { EntitySheet } from '../components/EntitySheet'
import { PhotoField } from '../components/PhotoField'
import { PrintOverlay } from '../components/PrintOverlay'
import { useToast } from '../components/Toast'
import { PROJECT_FIELDS } from '../fields'
import { fabricRemaining, formatQuantity, joinMeta } from '../format'
import { formatStored } from '../units'
import type { LengthUnit } from '../units'
import { useUnit } from '../unitPreference'
import { preparePhoto } from '../photo'
import type { PaperSize } from '../tiling'
import type { Notion, Photo, ProjectAllocations, ShortfallLine, ShoppingListItem, Thread, Fabric } from '../../shared/model'

interface Project {
  id: string
  title: string
  status: string
  startedOn: string | null
  notes: string | null
  photos: Photo[]
  tags: string[]
  allocations: ProjectAllocations
}

const PATHS = '/api/projects'

const statusLabel = (status: string): string => status.charAt(0).toUpperCase() + status.slice(1)

/** A cut is named by its cloth, and — when the cloth has more than one piece — by which piece it is. */
function cutLabel(fabric: Fabric, cut: Fabric['cuts'][number]): string {
  const suffix = fabric.cuts.length > 1 ? ` — cut ${cut.position + 1}` : ''
  return `${fabric.name}${suffix}`
}

function nameFor(
  line: ShortfallLine,
  fabrics: Fabric[],
  threads: Thread[],
  notions: Notion[],
  unit: LengthUnit,
): string {
  if (line.kind === 'fabric') {
    for (const fabric of fabrics) {
      const cut = fabric.cuts.find((entry) => entry.id === line.targetId)
      if (cut) return `${cutLabel(fabric, cut)} (${formatStored(cut.lengthMm, 'fabricLength', unit)} left)`
    }
    return 'Unknown fabric'
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

  /** A number typed into an allocation, or null — never NaN sent to the API. */
  const toNumberOrNull = (value: string): number | null => {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const add = (kind: 'fabrics' | 'threads' | 'notions'): void => {
    const id = choice[kind === 'fabrics' ? 'fabric' : kind === 'threads' ? 'thread' : 'notion']
    if (!id) return
    const raw = amount[kind === 'fabrics' ? 'fabric' : kind === 'threads' ? 'thread' : 'notion']
    const next: ProjectAllocations = {
      fabrics: [...allocations.fabrics],
      threads: [...allocations.threads],
      notions: [...allocations.notions],
    }
    if (kind === 'fabrics') next.fabrics.push({ cutId: id, lengthMmUsed: toNumberOrNull(raw) })
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
    ...allocations.fabrics.map((entry, index) => ({ kind: 'fabrics' as const, index, line: lines.find((line) => line.kind === 'fabric' && line.targetId === entry.cutId), label: nameFor({ kind: 'fabric', targetId: entry.cutId, needed: entry.lengthMmUsed, available: 0, short: 0, tooNarrow: false }, fabrics.items ?? [], threads.items ?? [], notions.items ?? [], unit) })),
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
        {/* A project takes a named cut — the piece the person physically cut. */}
        <select value={choice.fabric} onChange={(event) => setChoice((current) => ({ ...current, fabric: event.target.value }))}>
          <option value="">—</option>
          {(fabrics.items ?? []).flatMap((fabric) =>
            fabric.cuts.map((cut) => (
              <option key={cut.id} value={cut.id}>
                {cutLabel(fabric, cut)} ({formatStored(cut.lengthMm, 'fabricLength', unit)} left)
              </option>
            )),
          )}
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

const GROUP_LABELS: Record<ShoppingListItem['kind'], string> = {
  fabric: 'Fabric',
  thread: 'Thread',
  notion: 'Notions',
}

interface CostLine {
  kind: 'fabric' | 'thread'
  targetId: string
  name: string
  costMinor: number
  currency: string
}

interface ProjectCost {
  title: string
  lines: CostLine[]
  totals: Array<{ currency: string; minor: number }>
}

/** Money is shown in its own currency, major units; nothing is ever converted. */
const moneyLabel = (minor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

/** What the allocation cost, from the records' own cost_minor — per currency, never mixed. */
function CostSummary({ project }: { project: Project }) {
  const [cost, setCost] = useState<ProjectCost | null>(null)

  useEffect(() => {
    let cancelled = false
    setCost(null)
    api<ProjectCost>(`${PATHS}/${project.id}/cost`)
      .then((result) => {
        if (!cancelled) setCost(result)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [project.id])

  return (
    <div className="shopping-list">
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Cost
      </span>
      {cost === null ? null : cost.totals.length === 0 ? (
        <p className="muted">No costs recorded. Fabric and thread carry a price; notions do not.</p>
      ) : (
        <>
          <p style={{ margin: '0.25rem 0 0.5rem' }}>
            {cost.totals.map((total) => (
              <span key={total.currency} style={{ marginRight: '0.75rem' }}>
                <b>{moneyLabel(total.minor, total.currency)}</b>
                <span className="muted"> {total.currency}</span>
              </span>
            ))}
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {cost.lines.map((line) => (
              <li key={`${line.kind}-${line.targetId}`}>
                {line.name} <span className="muted">{moneyLabel(line.costMinor, line.currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

const KIND_ORDER: readonly ShoppingListItem['kind'][] = ['fabric', 'thread', 'notion']

/**
 * The shortfall as something to act on: the short lines, grouped, copyable as
 * text and printable on one page. Read-only — the allocation editor above it
 * does the changing.
 */
function ShoppingList({ project }: { project: Project }) {
  const [items, setItems] = useState<ShoppingListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [paper, setPaper] = useState<PaperSize>('a4')

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    api<{ items: ShoppingListItem[] }>(`${PATHS}/${project.id}/shopping-list`)
      .then((result) => {
        if (!cancelled) setItems(result.items)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the shopping list.')
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const copy = async (): Promise<void> => {
    // The clipboard gets exactly what the server renders — one source of truth.
    const response = await fetch(`${PATHS}/${project.id}/shopping-list?format=text`, { credentials: 'same-origin' })
    if (!response.ok) return
    await navigator.clipboard.writeText(await response.text())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const label = (item: ShoppingListItem): string => {
    const identified = item.detail ? `${item.name} (${item.detail})` : item.name
    const unit = item.unit ? ` ${item.unit}` : ''
    return `${identified} — ${item.amount}${unit}`
  }

  const groups = KIND_ORDER.map((kind) => ({ kind, lines: (items ?? []).filter((item) => item.kind === kind) })).filter(
    (group) => group.lines.length > 0,
  )

  const listBody = (forPrint: boolean): ReactNode => (
    <>
      {groups.map((group) => (
        <div key={group.kind} className={forPrint ? 'shopping-group' : undefined}>
          <h4>{GROUP_LABELS[group.kind]}</h4>
          <ul>
            {group.lines.map((item) => (
              <li key={item.targetId}>
                {label(item)}
                {item.source && <span className="muted"> — from {item.source}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )

  return (
    <div className="shopping-list">
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Shopping list
      </span>

      {error && <p className="error">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items !== null && items.length === 0 && <p className="muted">Nothing to buy — the stash covers this project.</p>}

      {items !== null && items.length > 0 && (
        <>
          {listBody(false)}
          <div className="inline-actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy as text'}
            </button>
            <button type="button" className="button" onClick={() => setPrinting(true)}>
              Print
            </button>
          </div>
        </>
      )}

      {printing && (
        <PrintOverlay
          title="Shopping list"
          paper={paper}
          onClose={() => setPrinting(false)}
          controls={
            <>
              <div className="segmented" role="group" aria-label="Paper size">
                <button type="button" aria-pressed={paper === 'a4'} onClick={() => setPaper('a4')}>
                  A4
                </button>
                <button type="button" aria-pressed={paper === 'letter'} onClick={() => setPaper('letter')}>
                  Letter
                </button>
              </div>
              <button type="button" className="button primary" onClick={() => window.print()}>
                Print
              </button>
            </>
          }
        >
          <div className="print-sheet shopping-print">
            <h3>{project.title}</h3>
            {listBody(true)}
          </div>
        </PrintOverlay>
      )}
    </div>
  )
}

export function ProjectsScreen() {
  const { items, error, reload } = useCollection<Project>(PATHS)
  const toast = useToast()
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
  const record = sheet?.mode === 'edit' ? items?.find((item) => item.id === sheet.id) ?? null : null
  // A held photo while creating, uploaded once the project exists.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetRef = useRef<string | null>(null)

  const requestPhoto = (entityId: string | null): void => {
    photoTargetRef.current = entityId
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  const onPhotoChosen = async (file: File | null): Promise<void> => {
    if (!file) return
    const target = photoTargetRef.current
    if (!target) {
      setPendingPhoto(file)
      return
    }
    setPhotoError(null)
    try {
      const prepared = await preparePhoto(file)
      await uploadPhoto('project', target, prepared.blob, prepared.widthPx, prepared.heightPx)
      await reload()
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Could not add the photo.')
    }
  }

  const save = async (values: Record<string, unknown>): Promise<void> => {
    if (sheet?.mode === 'edit') await api(`${PATHS}/${sheet.id}`, { method: 'PUT', body: values })
    else {
      const created = await api<{ id: string }>(PATHS, { method: 'POST', body: values })
      if (pendingPhoto) {
        const prepared = await preparePhoto(pendingPhoto)
        await uploadPhoto('project', created.id, prepared.blob, prepared.widthPx, prepared.heightPx)
        setPendingPhoto(null)
      }
    }
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
              {project.photos[0] ? (
                <img
                  className="swatch"
                  src={photoUrl(project.photos[0].entityType, project.photos[0].entityId, project.photos[0].id)}
                  alt=""
                  width={44}
                  height={44}
                />
              ) : (
                <span className="swatch" aria-hidden="true">
                  {project.title.slice(0, 2)}
                </span>
              )}
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

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          void onPhotoChosen(file)
        }}
      />

      {sheet && (
        <EntitySheet
          key={sheet.mode === 'edit' ? sheet.id : 'new'}
          title={sheet.mode === 'edit' ? 'Edit project' : 'New project'}
          fields={PROJECT_FIELDS}
          record={record as Record<string, unknown> | null}
          onSave={save}
          onDelete={sheet.mode === 'edit' ? remove : undefined}
          onClose={() => {
            setSheet(null)
            setPendingPhoto(null)
          }}
          leading={
            <>
              <PhotoField
                entityType="project"
                entityId={sheet.mode === 'edit' ? sheet.id : null}
                photos={record?.photos ?? []}
                pendingFile={pendingPhoto}
                onPendingFile={setPendingPhoto}
                onChanged={() => void reload()}
                onRequestPhoto={requestPhoto}
              />
              {photoError && <p className="error">{photoError}</p>}
            </>
          }
        >
          {sheet.mode === 'edit' && record ? (
            <>
              <AllocationEditor project={record} onChanged={() => void reload()} />
              <ShoppingList project={record} />
              <CostSummary project={record} />
            </>
          ) : (
            <p className="muted">Save the project, then allocate fabric, thread and notions.</p>
          )}
        </EntitySheet>
      )}
    </>
  )
}

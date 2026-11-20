import test from 'node:test'
import assert from 'node:assert/strict'
import { fabricWithCut, freshApp, json, readJson, type Client } from './helpers'
import type { ShortfallLine } from '../shared/model'

interface Project {
  id: string
  title: string
  status: string
  consumed: boolean
  allocations: {
    fabrics: Array<{ cutId: string; lengthMmUsed: number | null }>
    threads: Array<{ threadId: string; lengthMUsed: number | null }>
    notions: Array<{ notionId: string; quantityUsed: number | null }>
  }
}

async function makeFabric(app: Client, body: Record<string, unknown> = {}, cut: Record<string, unknown> = {}) {
  const width = body.widthMm === undefined ? { widthMm: 1500 } : {}
  return fabricWithCut(app, { name: 'Linen', ...width, ...body }, { lengthMm: 2000, ...cut })
}

async function makeProject(app: Client, body: Record<string, unknown> = {}) {
  return readJson<Project>(await app.request('/api/projects', json({ title: 'Shirt', ...body })))
}

const shortfallOf = async (app: Client, id: string) =>
  readJson<{ lines: ShortfallLine[] }>(await app.request(`/api/projects/${id}/shortfall`))

const allocationsBody = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('create, list and fetch a project', async () => {
  const app = await freshApp()
  const created = await app.request('/api/projects', json({ title: 'Archer shirt', status: 'cutting' }))
  assert.equal(created.status, 201)
  const project = await readJson<Project>(created)
  assert.equal(project.status, 'cutting')
  assert.deepEqual(project.allocations, { fabrics: [], threads: [], notions: [] })

  const listed = await readJson<Project[]>(await app.request('/api/projects'))
  assert.equal(listed.length, 1)
})

test('a project needs a title and a known status', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/projects', json({ title: '' }))).status, 400)
  assert.equal((await app.request('/api/projects', json({ title: 'X', status: 'napping' }))).status, 400)
})

test('allocations attach fabric, thread and notions', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const thread = await readJson<{ id: string }>(await app.request('/api/threads', json({ name: 'Mara 120', lengthM: 100 })))
  const notion = await readJson<{ id: string }>(await app.request('/api/notions', json({ name: 'Buttons', kind: 'button', quantity: 6 })))
  const project = await makeProject(app)

  const allocated = await app.request(
    `/api/projects/${project.id}/allocations`,
    allocationsBody({
      fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 1500 }],
      threads: [{ threadId: thread.id, lengthMUsed: 30 }],
      notions: [{ notionId: notion.id, quantityUsed: 4 }],
    }),
  )
  assert.equal(allocated.status, 200)
  const reloaded = await readJson<Project>(allocated)
  assert.equal(reloaded.allocations.fabrics.length, 1)
  assert.equal(reloaded.allocations.threads.length, 1)
  assert.equal(reloaded.allocations.notions.length, 1)
})

test('allocating something that does not exist is refused', async () => {
  const app = await freshApp()
  const project = await makeProject(app)
  const response = await app.request(
    `/api/projects/${project.id}/allocations`,
    allocationsBody({ fabrics: [{ cutId: 'ghost', lengthMmUsed: 100 }] }),
  )
  assert.equal(response.status, 400)
})

test('shortfall is zero when the stash covers the plan', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app, { lengthMm: 3000 })
  const project = await makeProject(app)
  await app.request(`/api/projects/${project.id}/allocations`, allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 2000 }] }))

  const { lines } = await shortfallOf(app, project.id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.short, 0)
})

test('shortfall names the gap when the stash is short', async () => {
  const app = await freshApp()
  const thread = await readJson<{ id: string }>(await app.request('/api/threads', json({ name: 'Mara 120', lengthM: 100 })))
  const project = await makeProject(app)
  await app.request(`/api/projects/${project.id}/allocations`, allocationsBody({ threads: [{ threadId: thread.id, lengthMUsed: 250 }] }))

  const { lines } = await shortfallOf(app, project.id)
  assert.equal(lines[0]!.short, 150)
})

test('another active project reserves what the first cannot double-count', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app, { lengthMm: 2000 })
  const first = await makeProject(app, { title: 'First' })
  const second = await makeProject(app, { title: 'Second' })

  const body = allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 1500 }] })
  await app.request(`/api/projects/${first.id}/allocations`, body)
  await app.request(`/api/projects/${second.id}/allocations`, body)

  const { lines } = await shortfallOf(app, second.id)
  assert.equal(lines[0]!.available, 500)
  assert.equal(lines[0]!.short, 1000)
})

test('a fabric narrower than the pattern asks for warns without a shortfall', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app, { lengthMm: 3000, widthMm: 1150 })
  const pattern = await readJson<{ id: string }>(await app.request('/api/patterns', json({ name: 'Wide skirt', category: 'bottoms' })))
  const view = await readJson<{ id: string }>(await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A' })))
  await app.request(`/api/patterns/${pattern.id}/views/${view.id}/requirements`, json({ role: 'main', lengthMm: 2000, fabricWidthMm: 1400 }))

  const project = await makeProject(app, { patternViewId: view.id })
  await app.request(`/api/projects/${project.id}/allocations`, allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 2000 }] }))

  const { lines } = await shortfallOf(app, project.id)
  assert.equal(lines[0]!.tooNarrow, true)
  assert.equal(lines[0]!.short, 0)
})

test('reaching done consumes the stash and stops reserving', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app, { lengthMm: 2000 })
  const project = await makeProject(app)
  await app.request(`/api/projects/${project.id}/allocations`, allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 1500 }] }))

  const finished = await app.request(`/api/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Shirt', status: 'done' }),
  })
  assert.equal((await readJson<Project>(finished)).consumed, true)

  const fabricAfter = await readJson<{ cuts: Array<{ lengthMm: number | null }> }>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.equal(fabricAfter.cuts[0]!.lengthMm, 500)

  const next = await makeProject(app, { title: 'Next' })
  await app.request(`/api/projects/${next.id}/allocations`, allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 1000 }] }))
  const { lines } = await shortfallOf(app, next.id)
  assert.equal(lines[0]!.available, 500)
  assert.equal(lines[0]!.short, 500)
})

test('deleting a project removes its allocations', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const project = await makeProject(app)
  await app.request(`/api/projects/${project.id}/allocations`, allocationsBody({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 1000 }] }))
  assert.equal((await app.request(`/api/projects/${project.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/projects/${project.id}`)).status, 404)
  assert.equal((await app.request(`/api/projects/${project.id}/shortfall`)).status, 404)
})

test('filters narrow by status', async () => {
  const app = await freshApp()
  await makeProject(app, { title: 'A', status: 'planned' })
  await makeProject(app, { title: 'B', status: 'sewing' })

  const sewing = await readJson<Project[]>(await app.request('/api/projects?status=sewing'))
  assert.deepEqual(sewing.map((p) => p.title), ['B'])
})

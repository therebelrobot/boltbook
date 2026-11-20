import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, put, readJson } from './helpers'

/**
 * Costing: presentation over data that exists. cost_minor carries its own
 * currency per row, so totals are per currency and never mixed — and nothing
 * leaves the box to compute any of it.
 */

interface CostLine {
  kind: string
  name: string
  costMinor: number
  currency: string
}
interface ProjectCost {
  title: string
  lines: CostLine[]
  totals: Array<{ currency: string; minor: number }>
}
interface Status {
  ok: boolean
  stashValue: Array<{ currency: string; minor: number }>
}

test('a project with fabric, thread and notions shows a total per currency', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(
    await app.request('/api/fabrics', json({ name: 'Washed linen', lengthMm: 2500, costMinor: 4500, currency: 'USD' })),
  )
  const thread = await readJson<{ id: string }>(
    await app.request('/api/threads', json({ name: 'Mara 120', lengthM: 900, costMinor: 500, currency: 'EUR' })),
  )
  const notion = await readJson<{ id: string }>(
    await app.request('/api/notions', json({ name: 'Corozo buttons', quantity: 24, unit: 'piece' })),
  )
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Archer shirt', status: 'planned' })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    ...put({
      fabrics: [{ fabricId: fabric.id, lengthMmUsed: 2800 }],
      threads: [{ threadId: thread.id, lengthMUsed: 400 }],
      notions: [{ notionId: notion.id, quantityUsed: 12 }],
    }),
  })

  const cost = await readJson<ProjectCost>(await app.request(`/api/projects/${project.id}/cost`))
  assert.equal(cost.title, 'Archer shirt')
  // A notion carries no cost; it is not on the breakdown and not in any total.
  assert.deepEqual(
    cost.lines.map((line) => [line.kind, line.name, line.costMinor, line.currency]),
    [
      ['fabric', 'Washed linen', 4500, 'USD'],
      ['thread', 'Mara 120', 500, 'EUR'],
    ],
  )
  // Mixed currencies produce two labelled totals, not one wrong number.
  assert.deepEqual(cost.totals, [
    { currency: 'EUR', minor: 500 },
    { currency: 'USD', minor: 4500 },
  ])
})

test('records without a cost stay off the breakdown', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Priced', lengthMm: 1000, costMinor: 1200, currency: 'USD' })))
  const free = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'A gift', lengthMm: 1000 })))
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt', status: 'planned' })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    ...put({ fabrics: [{ fabricId: fabric.id }, { fabricId: free.id }], threads: [], notions: [] }),
  })

  const cost = await readJson<ProjectCost>(await app.request(`/api/projects/${project.id}/cost`))
  assert.deepEqual(cost.lines.map((line) => line.name), ['Priced'])
  assert.deepEqual(cost.totals, [{ currency: 'USD', minor: 1200 }])
})

test('a project with no costs says so by having no totals', async () => {
  const app = await freshApp()
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt', status: 'planned' })))
  const cost = await readJson<ProjectCost>(await app.request(`/api/projects/${project.id}/cost`))
  assert.deepEqual(cost.totals, [])
  assert.deepEqual(cost.lines, [])
})

test('the stash value totals fabric, thread and tools, per currency', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', costMinor: 4500, currency: 'USD' }))
  await app.request('/api/threads', json({ name: 'Mara', costMinor: 500, currency: 'USD' }))
  await app.request('/api/tools', json({ name: 'Shears', costMinor: 6000, currency: 'EUR' }))

  const status = await readJson<Status>(await app.request('/api/summary'))
  assert.deepEqual(status.stashValue, [
    { currency: 'EUR', minor: 6000 },
    { currency: 'USD', minor: 5000 },
  ])
})

test('costing needs a real project', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/projects/ghost/cost')).status, 404)
})

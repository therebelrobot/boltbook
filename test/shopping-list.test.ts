import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, put, readJson } from './helpers'

/**
 * The shortfall as a shopping list: short lines only, named, in the claim's own
 * unit. Read-only over data the shortfall rule already produces.
 */

interface Item {
  kind: string
  name: string
  detail: string | null
  source: string | null
  amount: number
  unit: string | null
}

/** A project that is short of fabric, thread and a notion, all at once. */
async function seedShortProject() {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(
    await app.request('/api/fabrics', json({ name: 'Washed linen', colour: 'oatmeal', lengthMm: 1000, source: 'Fabricville' })),
  )
  const thread = await readJson<{ id: string }>(
    await app.request('/api/threads', json({ name: 'Mara 120', colour: 'ecru', lengthM: 100 })),
  )
  const notion = await readJson<{ id: string }>(
    await app.request('/api/notions', json({ name: 'Corozo buttons 15 mm', spec: '15 mm', quantity: 2, unit: 'piece' })),
  )
  const project = await readJson<{ id: string; title: string }>(
    await app.request('/api/projects', json({ title: 'Archer shirt', status: 'planned' })),
  )
  await app.request(`/api/projects/${project.id}/allocations`, {
    ...put({
      fabrics: [{ fabricId: fabric.id, lengthMmUsed: 2800 }],
      threads: [{ threadId: thread.id, lengthMUsed: 400 }],
      notions: [{ notionId: notion.id, quantityUsed: 12 }],
    }),
  })
  return { app, projectId: project.id, title: project.title as string }
}

test('a project short of fabric, thread and a notion produces a list naming each', async () => {
  const { app, projectId } = await seedShortProject()
  const { items } = await readJson<{ items: Item[] }>(await app.request(`/api/projects/${projectId}/shopping-list`))
  assert.deepEqual(items.map((item) => [item.kind, item.name, item.amount, item.unit]), [
    ['fabric', 'Washed linen', 1800, 'mm'],
    ['thread', 'Mara 120', 300, 'm'],
    ['notion', 'Corozo buttons 15 mm', 10, 'piece'],
  ])
})

test('a line the stash can cover is not on the list', async () => {
  const { app, projectId } = await seedShortProject()
  // Shrink only the thread claim below what the stash holds; it drops off the
  // list while the fabric and notion shortfalls stay.
  const thread = await readJson<Array<{ id: string }>>(await app.request('/api/threads'))
  const fabric = await readJson<Array<{ id: string }>>(await app.request('/api/fabrics'))
  const notion = await readJson<Array<{ id: string }>>(await app.request('/api/notions'))
  await app.request(`/api/projects/${projectId}/allocations`, {
    ...put({
      fabrics: [{ fabricId: fabric[0]!.id, lengthMmUsed: 2800 }],
      threads: [{ threadId: thread[0]!.id, lengthMUsed: 100 }],
      notions: [{ notionId: notion[0]!.id, quantityUsed: 12 }],
    }),
  })
  const { items } = await readJson<{ items: Item[] }>(await app.request(`/api/projects/${projectId}/shopping-list`))
  assert.ok(items.every((item) => item.kind !== 'thread'), 'the covered thread is not listed')
  assert.ok(items.length > 0, 'the short lines remain')
})

test('a project the stash covers produces an empty list', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Linen', lengthMm: 3000 })))
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt', status: 'planned' })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    ...put({ fabrics: [{ fabricId: fabric.id, lengthMmUsed: 2800 }], threads: [], notions: [] }),
  })
  const { items } = await readJson<{ items: Item[] }>(await app.request(`/api/projects/${project.id}/shopping-list`))
  assert.deepEqual(items, [])
})

test('amounts follow the unit preference, notions never convert', async () => {
  const { app, projectId } = await seedShortProject()
  const { items } = await readJson<{ items: Item[] }>(
    await app.request(`/api/projects/${projectId}/shopping-list?units=imperial`),
  )
  assert.deepEqual(items.map((item) => [item.name, item.amount, item.unit]), [
    ['Washed linen', 1.97, 'yd'],
    ['Mara 120', 328.08, 'yd'],
    ['Corozo buttons 15 mm', 10, 'piece'],
  ])
})

test('the text form groups by kind and names the source', async () => {
  const { app, projectId, title } = await seedShortProject()
  const response = await app.request(`/api/projects/${projectId}/shopping-list?format=text`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/plain/)
  const text = await response.text()
  assert.match(text, new RegExp(`^Shopping list — ${title}`))
  assert.match(text, /Fabric\n- Washed linen \(oatmeal\) — 1800 mm — from Fabricville/)
  assert.match(text, /Thread\n- Mara 120 \(ecru\) — 300 m\n/)
  assert.match(text, /Notions\n- Corozo buttons 15 mm \(15 mm\) — 10 piece/)
  // Amounts are never negative and short lines only — no "available" chatter.
  assert.equal(text.includes('available'), false)
})

test('an empty list says so in text, and does not invent sections', async () => {
  const app = await freshApp()
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt', status: 'planned' })))
  const response = await app.request(`/api/projects/${project.id}/shopping-list?format=text`)
  const text = await response.text()
  assert.match(text, /Nothing to buy/)
  assert.equal(text.includes('Fabric'), false)
})

test('the shopping list needs a real project', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/projects/ghost/shopping-list')).status, 404)
})

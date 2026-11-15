import test from 'node:test'
import assert from 'node:assert/strict'
import { anonymousApp, freshApp, json, readJson, type Client } from './helpers'

interface LocationSummary {
  name: string
  fabricCount: number
  threadCount: number
  toolCount: number
  notionCount: number
  total: number
}

const create = async (app: Client, path: string, body: Record<string, unknown>): Promise<Response> =>
  app.request(path, json(body))

test('locations are collected across every record that has one', async () => {
  const app = await freshApp()
  await create(app, '/api/fabrics', { name: 'Linen', location: 'Bin A' })
  await create(app, '/api/fabrics', { name: 'Chambray', location: 'bin a' })
  await create(app, '/api/fabrics', { name: 'Wool', location: 'Bin B' })
  await create(app, '/api/fabrics', { name: 'No bin' })
  await create(app, '/api/threads', { name: 'Mara', location: 'Bin A' })
  await create(app, '/api/tools', { name: 'Cutter', location: 'Bin A' })
  await create(app, '/api/notions', { name: 'Zip', location: 'Bin B' })

  const locations = await readJson<LocationSummary[]>(await app.request('/api/locations'))
  assert.deepEqual(
    locations.map((location) => location.name),
    ['Bin A', 'Bin B'],
  )
  assert.deepEqual(locations[0], {
    name: 'Bin A',
    fabricCount: 2,
    threadCount: 1,
    toolCount: 1,
    notionCount: 0,
    total: 4,
  })
  assert.deepEqual(locations[1], {
    name: 'Bin B',
    fabricCount: 1,
    threadCount: 0,
    toolCount: 0,
    notionCount: 1,
    total: 2,
  })
})

test('blank and missing locations are not labels', async () => {
  const app = await freshApp()
  await create(app, '/api/fabrics', { name: 'Nowhere', location: '   ' })
  const locations = await readJson<LocationSummary[]>(await app.request('/api/locations'))
  assert.deepEqual(locations, [])
})

test('a record moving out of a bin changes the counts', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await create(app, '/api/fabrics', { name: 'Linen', location: 'Bin A' }))
  await app.request(
    `/api/fabrics/${fabric.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Linen', location: 'Bin C' }) },
  )
  const locations = await readJson<LocationSummary[]>(await app.request('/api/locations'))
  assert.deepEqual(locations.map((location) => [location.name, location.total]), [['Bin C', 1]])
})

test('locations need a session', async () => {
  const app = anonymousApp()
  assert.equal((await app.request('/api/locations')).status, 401)
})

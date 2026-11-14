import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'

interface Thread {
  id: string
  name: string
  colour: string | null
  spools: number | null
  lengthM: number | null
}

test('create and read back a thread with its own fields', async () => {
  const app = await freshApp()
  const created = await app.request(
    '/api/threads',
    json({
      name: 'Mara 120',
      brand: 'Gütermann',
      colour: 'ecru',
      colourCode: '169',
      fibre: 'polyester',
      weight: '120',
      spools: 3,
      lengthM: 900,
      originalLengthM: 1000,
      needleSize: '80/12',
    }),
  )
  assert.equal(created.status, 201)
  const thread = await readJson<Thread>(created)
  assert.equal(thread.colour, 'ecru')
  assert.equal(thread.spools, 3)
  assert.equal(thread.lengthM, 900)
})

test('a thread needs a name', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/threads', json({ name: '' }))).status, 400)
})

test('remaining thread length cannot exceed the original', async () => {
  const app = await freshApp()
  const response = await app.request('/api/threads', json({ name: 'Silk', lengthM: 2000, originalLengthM: 500 }))
  assert.equal(response.status, 400)
})

test('filters narrow thread by colour and fibre', async () => {
  const app = await freshApp()
  await app.request('/api/threads', json({ name: 'Mara 120', colour: 'navy', fibre: 'polyester' }))
  await app.request('/api/threads', json({ name: 'Silk 50', colour: 'cream', fibre: 'silk' }))

  const navy = await readJson<Thread[]>(await app.request('/api/threads?colour=navy'))
  assert.deepEqual(navy.map((t) => t.name), ['Mara 120'])

  const silk = await readJson<Thread[]>(await app.request('/api/threads?fibre=silk'))
  assert.deepEqual(silk.map((t) => t.colour), ['cream'])
})

test('replace and delete a thread', async () => {
  const app = await freshApp()
  const thread = await readJson<Thread>(await app.request('/api/threads', json({ name: 'Mara 120', spools: 3 })))
  const updated = await app.request(
    `/api/threads/${thread.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mara 120', spools: 2 }) },
  )
  assert.equal((await readJson<Thread>(updated)).spools, 2)
  assert.equal((await app.request(`/api/threads/${thread.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/threads/${thread.id}`)).status, 404)
})

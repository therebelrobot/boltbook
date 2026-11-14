import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'

/** Meters of the API's unit mode: imperial in, imperial out, metric stored. */

test('a fabric can be created in yards and inches', async () => {
  const app = await freshApp()
  const created = await app.request('/api/fabrics', json({ name: 'Linen', lengthYd: 2.73, widthIn: 44 }))
  assert.equal(created.status, 201)

  const metric = await readJson<{ lengthMm: number; widthMm: number }>(created)
  assert.equal(metric.lengthMm, 2496)
  assert.equal(metric.widthMm, 1118)
})

test('the same fabric reads in yards when asked', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', lengthMm: 2500, widthMm: 1400 }))

  const imperial = await readJson<Array<Record<string, unknown>>>(await app.request('/api/fabrics?units=imperial'))
  assert.equal(imperial[0]!.lengthYd, 2.73)
  assert.equal(imperial[0]!.widthIn, 55.12)
  assert.equal('lengthMm' in imperial[0]!, false)

  const metric = await readJson<Array<Record<string, unknown>>>(await app.request('/api/fabrics'))
  assert.equal(metric[0]!.lengthMm, 2500)
  assert.equal('lengthYd' in metric[0]!, false)
})

test('giving both a metric and an imperial length is refused', async () => {
  const app = await freshApp()
  const response = await app.request('/api/fabrics', json({ name: 'Linen', lengthMm: 2000, lengthYd: 2 }))
  assert.equal(response.status, 400)
})

test('an unknown units value is refused', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/fabrics?units=furlongs')).status, 400)
})

test('thread reads in yards too', async () => {
  const app = await freshApp()
  await app.request('/api/threads', json({ name: 'Mara 120', lengthYd: 1094 }))
  const imperial = await readJson<Array<Record<string, unknown>>>(await app.request('/api/threads?units=imperial'))
  assert.equal(imperial[0]!.lengthYd, 1093.61)

  const metric = await readJson<Array<Record<string, unknown>>>(await app.request('/api/threads'))
  assert.equal(metric[0]!.lengthM, 1000)
})

test('a project shortfall reads in yards, and says so', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Linen', lengthMm: 2500 })))
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt' })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fabrics: [{ fabricId: fabric.id, lengthYdUsed: 3 }] }),
  })

  const imperial = await readJson<{ units: string; lines: Array<{ short: number; available: number; unit: string | null }> }>(
    await app.request(`/api/projects/${project.id}/shortfall?units=imperial`),
  )
  assert.equal(imperial.units, 'imperial')
  assert.equal(imperial.lines[0]!.unit, 'yd')
  assert.equal(imperial.lines[0]!.available, 2.73)
  assert.equal(imperial.lines[0]!.short, 0.27)

  const metric = await readJson<{ units: string; lines: Array<{ short: number }> }>(
    await app.request(`/api/projects/${project.id}/shortfall`),
  )
  assert.equal(metric.units, 'metric')
  assert.equal(metric.lines[0]!.short, 243)
})

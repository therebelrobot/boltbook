import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, put, readJson } from './helpers'

interface View {
  id: string
  label: string
  position: number
  requirements: Array<{ id: string; role: string; lengthMm: number | null }>
}
interface Pattern {
  id: string
  name: string
  brand: string | null
  triedAndTrue: boolean
  format: string | null
  views: View[]
}

const makePattern = async (app: ReturnType<typeof freshApp>, body: Record<string, unknown> = {}) =>
  readJson<Pattern>(await app.request('/api/patterns', json({ name: 'Shirt', ...body })))

test('create a pattern and read it back with no views', async () => {
  const app = freshApp()
  const created = await app.request(
    '/api/patterns',
    json({ name: 'Archer Button-Up', brand: 'Grainline', category: 'tops', format: 'pdf', triedAndTrue: true }),
  )
  assert.equal(created.status, 201)
  const pattern = await readJson<Pattern>(created)
  assert.equal(pattern.name, 'Archer Button-Up')
  assert.equal(pattern.brand, 'Grainline')
  assert.equal(pattern.triedAndTrue, true)
  assert.deepEqual(pattern.views, [])
})

test('a pattern needs a name', async () => {
  const response = await freshApp().request('/api/patterns', json({ name: '' }))
  assert.equal(response.status, 400)
})

test('an unknown format is refused', async () => {
  const response = await freshApp().request('/api/patterns', json({ name: 'X', format: 'papyrus' }))
  assert.equal(response.status, 400)
})

test('views and requirements attach to a pattern and read back nested', async () => {
  const app = freshApp()
  const pattern = await makePattern(app)

  const view = await readJson<View>(
    await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A', description: 'sleeveless' })),
  )
  assert.equal(view.label, 'A')
  assert.equal(view.position, 0)

  await app.request(
    `/api/patterns/${pattern.id}/views/${view.id}/requirements`,
    json({ role: 'main', lengthMm: 1800, fabricWidthMm: 1400 }),
  )
  await app.request(`/api/patterns/${pattern.id}/views/${view.id}/requirements`, json({ role: 'interfacing', lengthMm: 500 }))

  const reloaded = await readJson<Pattern>(await app.request(`/api/patterns/${pattern.id}`))
  assert.equal(reloaded.views.length, 1)
  assert.equal(reloaded.views[0]!.requirements.length, 2)
  assert.deepEqual(
    reloaded.views[0]!.requirements.map((r) => r.role).sort(),
    ['interfacing', 'main'],
  )
})

test('a second view gets the next position', async () => {
  const app = freshApp()
  const pattern = await makePattern(app)
  await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A' }))
  const second = await readJson<View>(await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'B' })))
  assert.equal(second.position, 1)
})

test('a requirement needs the role it is given', async () => {
  const app = freshApp()
  const pattern = await makePattern(app)
  const view = await readJson<View>(await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A' })))
  const bad = await app.request(
    `/api/patterns/${pattern.id}/views/${view.id}/requirements`,
    json({ role: 'outer', lengthMm: 1000 }),
  )
  assert.equal(bad.status, 400)
})

test('a view on the wrong pattern is a 404', async () => {
  const app = freshApp()
  const one = await makePattern(app, { name: 'One' })
  const two = await makePattern(app, { name: 'Two' })
  const view = await readJson<View>(await app.request(`/api/patterns/${one.id}/views`, json({ label: 'A' })))
  const response = await app.request(`/api/patterns/${two.id}/views/${view.id}`, put({ label: 'A' }))
  assert.equal(response.status, 404)
})

test('deleting a view cascades its requirements', async () => {
  const app = freshApp()
  const pattern = await makePattern(app)
  const view = await readJson<View>(await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A' })))
  await app.request(
    `/api/patterns/${pattern.id}/views/${view.id}/requirements`,
    json({ role: 'main', lengthMm: 1800 }),
  )
  assert.equal((await app.request(`/api/patterns/${pattern.id}/views/${view.id}`, { method: 'DELETE' })).status, 200)
  const reloaded = await readJson<Pattern>(await app.request(`/api/patterns/${pattern.id}`))
  assert.deepEqual(reloaded.views, [])
})

test('deleting a pattern removes it entirely', async () => {
  const app = freshApp()
  const pattern = await makePattern(app)
  assert.equal((await app.request(`/api/patterns/${pattern.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/patterns/${pattern.id}`)).status, 404)
})

test('filters narrow by brand, category and tried-and-true', async () => {
  const app = freshApp()
  await makePattern(app, { name: 'Archer', brand: 'Grainline', category: 'tops', triedAndTrue: true })
  await makePattern(app, { name: 'Ginger', brand: 'Closet Core', category: 'bottoms' })

  const byBrand = await readJson<Pattern[]>(await app.request('/api/patterns?brand=Grainline'))
  assert.deepEqual(byBrand.map((p) => p.name), ['Archer'])

  const byCategory = await readJson<Pattern[]>(await app.request('/api/patterns?category=bottoms'))
  assert.deepEqual(byCategory.map((p) => p.name), ['Ginger'])

  const tnt = await readJson<Pattern[]>(await app.request('/api/patterns?triedAndTrue=true'))
  assert.deepEqual(tnt.map((p) => p.name), ['Archer'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson, type Client } from './helpers'

interface Tag {
  id: string
  name: string
  usageCount: number
}
interface Tagged {
  id: string
  name?: string
  title?: string
  tags: string[]
}

test('tags are created on demand and come back on the record', async () => {
  const app = await freshApp()
  const created = await app.request('/api/fabrics', json({ name: 'Washed linen', tags: ['linen', 'summer'] }))
  assert.equal(created.status, 201)
  assert.deepEqual((await readJson<Tagged>(created)).tags, ['linen', 'summer'])

  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.deepEqual(tags.map((tag) => tag.name), ['linen', 'summer'])
  assert.equal(tags[0]!.usageCount, 1)
})

test('tag names are unique case-insensitively', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['Linen'] }))
  await app.request('/api/fabrics', json({ name: 'Two', tags: ['linen'] }))

  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.equal(tags.length, 1)
  assert.equal(tags[0]!.usageCount, 2)
})

test('updating a record replaces its tags, and clearing them is allowed', async () => {
  const app = await freshApp()
  const fabric = await readJson<Tagged>(await app.request('/api/fabrics', json({ name: 'Linen', tags: ['linen'] })))

  const updated = await app.request(
    `/api/fabrics/${fabric.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Linen', tags: ['dress', 'linen'] }) },
  )
  assert.deepEqual((await readJson<Tagged>(updated)).tags, ['dress', 'linen'])

  const cleared = await app.request(
    `/api/fabrics/${fabric.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Linen', tags: [] }) },
  )
  assert.deepEqual((await readJson<Tagged>(cleared)).tags, [])
})

test('a list can be filtered by tag', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', tags: ['linen'] }))
  await app.request('/api/fabrics', json({ name: 'Cotton', tags: ['cotton'] }))

  const linen = await readJson<Tagged[]>(await app.request('/api/fabrics?tag=linen'))
  assert.deepEqual(linen.map((fabric) => fabric.name), ['Linen'])

  // Case does not matter on the way in either.
  const upper = await readJson<Tagged[]>(await app.request('/api/fabrics?tag=LINEN'))
  assert.deepEqual(upper.map((fabric) => fabric.name), ['Linen'])
})

test('tags work on every kind of record', async () => {
  const app = await freshApp()
  const pattern = await readJson<Tagged>(await app.request('/api/patterns', json({ name: 'Archer', tags: ['shirt'] })))
  const thread = await readJson<Tagged>(await app.request('/api/threads', json({ name: 'Mara 120', tags: ['shirt'] })))
  const tool = await readJson<Tagged>(await app.request('/api/tools', json({ name: 'Rotary', tags: ['sharp'] })))
  const notion = await readJson<Tagged>(await app.request('/api/notions', json({ name: 'Buttons', tags: ['shirt'] })))
  const project = await readJson<Tagged>(await app.request('/api/projects', json({ title: 'Shirt', tags: ['shirt'] })))

  assert.deepEqual(pattern.tags, ['shirt'])
  assert.deepEqual(thread.tags, ['shirt'])
  assert.deepEqual(tool.tags, ['sharp'])
  assert.deepEqual(notion.tags, ['shirt'])
  assert.deepEqual(project.tags, ['shirt'])

  // One tag, five records across five entity types.
  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.equal(tags.find((tag) => tag.name === 'shirt')!.usageCount, 4)
})

test('search finds a record by its tag, and says which tag matched', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Something unremarkable', tags: ['ticking'] }))

  const hits = await readJson<Array<{ title: string; snippet: string | null }>>(await app.request('/api/search?q=ticking'))
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.title, 'Something unremarkable')
  assert.match(hits[0]!.snippet ?? '', /tags: ticking/)
})

test('search does not list a record twice when the tag and a field both match', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen shift', fibre: 'linen', tags: ['linen'] }))

  const hits = await readJson<unknown[]>(await app.request('/api/search?q=linen'))
  assert.equal(hits.length, 1)
})

test('deleting a tag unlinks it everywhere', async () => {
  const app = await freshApp()
  const fabric = await readJson<Tagged>(await app.request('/api/fabrics', json({ name: 'Linen', tags: ['linen'] })))
  const [tag] = await readJson<Tag[]>(await app.request('/api/tags'))

  assert.equal((await app.request(`/api/tags/${tag!.id}`, { method: 'DELETE' })).status, 200)
  assert.deepEqual((await readJson<Tagged[]>(await app.request('/api/fabrics')))[0]!.tags, [])
  assert.equal((await readJson<Tagged>(await app.request(`/api/fabrics/${fabric.id}`))).tags.length, 0)
})

test('an empty tag name is refused', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/tags', json({ name: '  ' }))).status, 400)
})

test('tags are listed most-used first', async () => {
  const app: Client = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['common', 'rare'] }))
  await app.request('/api/fabrics', json({ name: 'Two', tags: ['common'] }))

  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.equal(tags[0]!.name, 'common')
})

const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('renaming a tag moves every link with it', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linnen'] }))
  await app.request('/api/patterns', json({ name: 'Two', tags: ['linnen'] }))
  const [tag] = await readJson<Tag[]>(await app.request('/api/tags'))

  const renamed = await readJson<Tag>(await app.request(`/api/tags/${tag!.id}`, patch({ name: 'linen' })))
  assert.equal(renamed.name, 'linen')
  assert.equal(renamed.usageCount, 2)

  // The records follow the name, wherever they live.
  const fabrics = await readJson<Tagged[]>(await app.request('/api/fabrics'))
  assert.deepEqual(fabrics[0]!.tags, ['linen'])
  const patterns = await readJson<Tagged[]>(await app.request('/api/patterns'))
  assert.deepEqual(patterns[0]!.tags, ['linen'])

  // And the filter follows too.
  const filtered = await readJson<Tagged[]>(await app.request('/api/fabrics?tag=linen'))
  assert.equal(filtered.length, 1)
})

test('renaming onto a name another tag holds is a conflict, case-insensitively', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linen'] }))
  await app.request('/api/fabrics', json({ name: 'Two', tags: ['linnen'] }))
  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  const linnen = tags.find((tag) => tag.name === 'linnen')!

  const response = await app.request(`/api/tags/${linnen.id}`, patch({ name: 'Linen' }))
  assert.equal(response.status, 409)
  assert.equal((await readJson<{ error: string }>(response)).error, 'conflict')

  // Nothing changed.
  const after = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.deepEqual(after.map((tag) => tag.name).sort(), ['linen', 'linnen'])
})

test('a case-only rename stays one tag', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linen'] }))
  const [tag] = await readJson<Tag[]>(await app.request('/api/tags'))

  const renamed = await readJson<Tag>(await app.request(`/api/tags/${tag!.id}`, patch({ name: 'Linen' })))
  assert.equal(renamed.name, 'Linen')
  assert.equal(renamed.usageCount, 1)
  assert.equal((await readJson<Tag[]>(await app.request('/api/tags'))).length, 1)
})

test('merging moves every link and retires the source', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linnen'] }))
  await app.request('/api/fabrics', json({ name: 'Two', tags: ['linnen', 'linen'] }))
  const tags = await readJson<Tag[]>(await app.request('/api/tags'))
  const source = tags.find((tag) => tag.name === 'linnen')!
  const target = tags.find((tag) => tag.name === 'linen')!

  const merged = await readJson<Tag>(await app.request(`/api/tags/${source.id}/merge`, json({ into: target.id })))
  assert.equal(merged.name, 'linen')
  // Record Two carried both; the duplicate link is ignored, not double-counted.
  assert.equal(merged.usageCount, 2)

  const after = await readJson<Tag[]>(await app.request('/api/tags'))
  assert.deepEqual(after.map((tag) => tag.name), ['linen'])
  const fabrics = await readJson<Tagged[]>(await app.request('/api/fabrics'))
  assert.deepEqual(fabrics.map((fabric) => fabric.tags), [['linen'], ['linen']])
})

test('merging a tag into itself is refused', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linen'] }))
  const [tag] = await readJson<Tag[]>(await app.request('/api/tags'))

  const response = await app.request(`/api/tags/${tag!.id}/merge`, json({ into: tag!.id }))
  assert.equal(response.status, 400)
  assert.equal((await readJson<Tag[]>(await app.request('/api/tags'))).length, 1)
})

test('merging into a missing tag is a 404, and the source survives', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'One', tags: ['linen'] }))
  const [tag] = await readJson<Tag[]>(await app.request('/api/tags'))

  const response = await app.request(`/api/tags/${tag!.id}/merge`, json({ into: 'ghost' }))
  assert.equal(response.status, 404)
  assert.equal((await readJson<Tag[]>(await app.request('/api/tags'))).length, 1)
})

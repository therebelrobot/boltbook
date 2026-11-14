import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceField, displayField } from '../client/formValues'
import type { FieldSpec } from '../client/fields'

const text: FieldSpec = { name: 'name', label: 'Name', kind: 'text', required: true }
const note: FieldSpec = { name: 'notes', label: 'Notes', kind: 'textarea' }
const plainNumber: FieldSpec = { name: 'spools', label: 'Spools', kind: 'number' }
const fabricLength: FieldSpec = { name: 'lengthMm', label: 'Remaining', kind: 'number', unitKind: 'fabricLength' }
const fabricWidth: FieldSpec = { name: 'widthMm', label: 'Width', kind: 'number', unitKind: 'fabricWidth' }
const tags: FieldSpec = { name: 'tags', label: 'Tags', kind: 'tags' }
const flag: FieldSpec = { name: 'triedAndTrue', label: 'Tried and true', kind: 'boolean' }

test('text stays text — the bug that broke every create', () => {
  assert.equal(coerceField(text, 'Washed linen', null, 'metric'), 'Washed linen')
  assert.equal(coerceField(text, '  Gütermann  ', null, 'metric'), 'Gütermann')
  assert.equal(coerceField(note, 'lightweight for a shirt', null, 'metric'), 'lightweight for a shirt')
  assert.equal(coerceField(text, '120', null, 'metric'), '120')
})

test('an empty field means "not recorded"', () => {
  assert.equal(coerceField(text, '', null, 'metric'), null)
  assert.equal(coerceField(note, '   ', null, 'metric'), null)
  assert.equal(coerceField(plainNumber, '', null, 'metric'), null)
  assert.equal(coerceField(fabricLength, '', null, 'metric'), null)
})

test('numbers parse, and junk is refused rather than sent', () => {
  assert.equal(coerceField(plainNumber, '3', null, 'metric'), 3)
  assert.equal(coerceField(plainNumber, '0', null, 'metric'), 0)
  assert.equal(coerceField(plainNumber, 'many', null, 'metric'), null)
})

test('a length converts from the device unit into canonical metric', () => {
  assert.equal(coerceField(fabricLength, '2500', null, 'metric'), 2500)
  assert.equal(coerceField(fabricLength, '2.73', null, 'imperial'), 2496)
  assert.equal(coerceField(fabricWidth, '44', null, 'imperial'), 1118)
  assert.equal(coerceField(fabricWidth, '1400', null, 'metric'), 1400)
})

test('an untouched length is sent back exactly as stored', () => {
  const record = { lengthMm: 2500, widthMm: 1400 }
  // 2500 mm shows as 2.73 yd; saving without touching it must not become 2496.
  assert.equal(displayField(fabricLength, record, 'imperial'), '2.73')
  assert.equal(coerceField(fabricLength, '2.73', record, 'imperial'), 2500)
  // The same text means something else in metric — 2.73 mm — not a conversion.
  assert.equal(coerceField(fabricLength, '2.73', record, 'metric'), 3)
})

test('a changed length does convert', () => {
  const record = { lengthMm: 2500 }
  assert.equal(coerceField(fabricLength, '3', record, 'imperial'), 2743)
})

test('tags arrive as a clean list of names', () => {
  assert.deepEqual(coerceField(tags, ['linen', ' summer '], null, 'metric'), ['linen', 'summer'])
  assert.deepEqual(coerceField(tags, ['linen', '', '  '], null, 'metric'), ['linen'])
  assert.deepEqual(coerceField(tags, [], null, 'metric'), [])
})

test('booleans are booleans', () => {
  assert.equal(coerceField(flag, true, null, 'metric'), true)
  assert.equal(coerceField(flag, false, null, 'metric'), false)
})

test('displaying a record round-trips through coerce for a text field', () => {
  const record = { name: 'Washed linen' }
  const shown = displayField(text, record, 'metric')
  assert.equal(shown, 'Washed linen')
  assert.equal(coerceField(text, shown, record, 'metric'), 'Washed linen')
})

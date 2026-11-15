import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnvelope } from '../client/envelope'

test('a clean Grainline envelope prefills brand, number, name, sizes, views and format', () => {
  const result = parseEnvelope(`
    GRAINLINE STUDIO
    Archer Button-Up
    No. 1001
    Sizes 0 - 18
    View A
    View B
    PDF
  `)

  assert.equal(result.brand, 'Grainline Studio')
  assert.equal(result.number, '1001')
  assert.equal(result.name, 'Archer Button-Up')
  assert.equal(result.sizeMin, '0')
  assert.equal(result.sizeMax, '18')
  assert.deepEqual(result.views, ['A', 'B'])
  assert.equal(result.format, 'pdf')
  assert.equal(result.category, 'shirt')
})

test('a house-prefixed number is kept whole', () => {
  const result = parseEnvelope(`
    BUTTERICK
    B6842
    Misses' Dress
    Sizes 6-22
  `)
  assert.equal(result.brand, 'Butterick')
  assert.equal(result.number, 'B6842')
  assert.equal(result.sizeMin, '6')
  assert.equal(result.sizeMax, '22')
  assert.equal(result.format, 'envelope')
  assert.equal(result.category, 'dress')
})

test('independent brands, alpha sizes and slash-separated views', () => {
  const result = parseEnvelope(`
    SEW LIBERATED
    Hinterland Shirt
    Sizes XS - XL
    View A / B
  `)
  assert.equal(result.brand, 'Sew Liberated')
  assert.equal(result.name, 'Hinterland Shirt')
  assert.equal(result.sizeMin, 'XS')
  assert.equal(result.sizeMax, 'XL')
  assert.deepEqual(result.views, ['A', 'B'])
  assert.equal(result.category, 'shirt')
})

test('a year is not a pattern number, and a size range is not a number', () => {
  const result = parseEnvelope(`
    VOGUE
    Spring 2024
    Sizes 8-16
  `)
  assert.equal(result.number, null)
  assert.equal(result.sizeMin, '8')
  assert.equal(result.sizeMax, '16')
})

test('views are deduped and sorted', () => {
  const result = parseEnvelope(`
    Views B, A, A
    View C
  `)
  assert.deepEqual(result.views, ['A', 'B', 'C'])
})

test('OCR can lose the space after the view marker', () => {
  assert.deepEqual(parseEnvelope('VIEWA/B').views, ['A', 'B'])
  assert.deepEqual(parseEnvelope('ViewsA, B, C').views, ['A', 'B', 'C'])
})

test('brand aliases normalise to one spelling', () => {
  assert.equal(parseEnvelope("McCalls 1234").brand, "McCall's")
  assert.equal(parseEnvelope('McCALL’S 1234').brand, "McCall's")
})

test('categories come from the words on the envelope', () => {
  assert.equal(parseEnvelope('Ginger Jeans').category, 'bottoms')
  assert.equal(parseEnvelope('Hinterland Dress').category, 'dress')
  assert.equal(parseEnvelope('Archer Shirt').category, 'shirt')
})

test('empty or noisy text returns no guesses', () => {
  const result = parseEnvelope('   \n\n  \n')
  assert.equal(result.brand, null)
  assert.equal(result.number, null)
  assert.equal(result.name, null)
  assert.equal(result.sizeMin, null)
  assert.equal(result.sizeMax, null)
  assert.deepEqual(result.views, [])
  // The photo was of an envelope; format is context, not a guess.
  assert.equal(result.format, 'envelope')
  assert.equal(result.category, null)
})

test('a brand line is not mistaken for the pattern name', () => {
  const result = parseEnvelope(`
    SEW LIBERATED
    Sizes 0-18
  `)
  assert.equal(result.brand, 'Sew Liberated')
  assert.equal(result.name, null)
})

test('the name is not a size chart or a view line', () => {
  const result = parseEnvelope(`
    Grainline Studio
    Sizes 0 - 18
    View A
    View B
  `)
  assert.equal(result.name, null)
})

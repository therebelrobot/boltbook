import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, formatLengthMm, formatMetres, formatQuantity, joinMeta, remainingFraction } from '../client/format'

test('lengths read as millimetres up to a metre, then metres', () => {
  assert.equal(formatLengthMm(850), '850 mm')
  assert.equal(formatLengthMm(1000), '1.00 m')
  assert.equal(formatLengthMm(2500), '2.50 m')
  assert.equal(formatLengthMm(null), '—')
})

test('metres and quantities', () => {
  assert.equal(formatMetres(100), '100 m')
  assert.equal(formatMetres(null), '—')
  assert.equal(formatQuantity(4, 'spool'), '4 spool')
  assert.equal(formatQuantity(4, null), '4')
  assert.equal(formatQuantity(null), '—')
})

test('meta joins only the parts that exist', () => {
  assert.equal(joinMeta(['linen', null, 'Bin A']), 'linen · Bin A')
  assert.equal(joinMeta([false, undefined, '']), '')
})

test('file sizes are human-readable', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(15 * 1024), '15 kB')
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB')
  assert.equal(formatBytes(24 * 1024 * 1024), '24 MB')
  assert.equal(formatBytes(null), '—')
})

test('the remaining fraction is clamped, and unknown when there is no original', () => {
  assert.equal(remainingFraction(500, 1000), 0.5)
  assert.equal(remainingFraction(2000, 1000), 1)
  assert.equal(remainingFraction(-5, 1000), 0)
  assert.equal(remainingFraction(500, null), null)
  assert.equal(remainingFraction(500, 0), null)
  assert.equal(remainingFraction(null, 1000), null)
})

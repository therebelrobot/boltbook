import test from 'node:test'
import assert from 'node:assert/strict'
import { availableAmount, computeShortfalls, keyOf } from '../server/shortfall'

test('available is remaining minus what others reserved', () => {
  const context = { remaining: { [keyOf('fabric', 'f1')]: 2000 }, reserved: { [keyOf('fabric', 'f1')]: 500 } }
  assert.equal(availableAmount(context, 'fabric', 'f1'), 1500)
})

test('available never goes negative even if reservations exceed the stash', () => {
  const context = { remaining: { [keyOf('fabric', 'f1')]: 300 }, reserved: { [keyOf('fabric', 'f1')]: 900 } }
  assert.equal(availableAmount(context, 'fabric', 'f1'), 0)
})

test('a claim within the stash is not short', () => {
  const lines = computeShortfalls(
    [{ kind: 'fabric', targetId: 'f1', amount: 1500 }],
    { remaining: { [keyOf('fabric', 'f1')]: 2000 }, reserved: {} },
  )
  assert.equal(lines[0]!.short, 0)
  assert.equal(lines[0]!.available, 2000)
})

test('a claim beyond the stash reports the shortfall in the same unit', () => {
  const lines = computeShortfalls(
    [{ kind: 'thread', targetId: 't1', amount: 200 }],
    { remaining: { [keyOf('thread', 't1')]: 100 }, reserved: {} },
  )
  assert.equal(lines[0]!.short, 100)
})

test('other projects reservations count against the claim', () => {
  const lines = computeShortfalls(
    [{ kind: 'fabric', targetId: 'f1', amount: 1000 }],
    { remaining: { [keyOf('fabric', 'f1')]: 2000 }, reserved: { [keyOf('fabric', 'f1')]: 1500 } },
  )
  assert.equal(lines[0]!.available, 500)
  assert.equal(lines[0]!.short, 500)
})

test('an allocation with no amount is never short', () => {
  const lines = computeShortfalls(
    [{ kind: 'notion', targetId: 'n1', amount: null }],
    { remaining: { [keyOf('notion', 'n1')]: 1 }, reserved: {} },
  )
  assert.equal(lines[0]!.needed, null)
  assert.equal(lines[0]!.short, 0)
})

test('a fabric narrower than the pattern asks for is flagged, not short', () => {
  const lines = computeShortfalls(
    [{ kind: 'fabric', targetId: 'f1', amount: 1000 }],
    {
      remaining: { [keyOf('fabric', 'f1')]: 3000 },
      reserved: {},
      widthMm: { [keyOf('fabric', 'f1')]: 1150 },
      requiredWidthMm: 1400,
    },
  )
  assert.equal(lines[0]!.tooNarrow, true)
  assert.equal(lines[0]!.short, 0)
})

test('a wide-enough fabric is not flagged', () => {
  const lines = computeShortfalls(
    [{ kind: 'fabric', targetId: 'f1', amount: 1000 }],
    {
      remaining: { [keyOf('fabric', 'f1')]: 3000 },
      reserved: {},
      widthMm: { [keyOf('fabric', 'f1')]: 1500 },
      requiredWidthMm: 1400,
    },
  )
  assert.equal(lines[0]!.tooNarrow, false)
})

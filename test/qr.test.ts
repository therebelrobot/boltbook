import test from 'node:test'
import assert from 'node:assert/strict'
import { locationLabelPath, locationLabelUrl, qrMatrix, qrPath } from '../client/qr'

const LABEL = 'https://example.com/#/location/Bin%20A'

test('a label becomes a square QR with the three finder patterns', () => {
  const matrix = qrMatrix(LABEL)
  assert.ok(matrix.size >= 21)
  assert.equal(matrix.rows.length, matrix.size)
  assert.ok(matrix.rows.every((row) => row.length === matrix.size))

  // Top-left finder: dark ring, light ring, dark 3 × 3 centre.
  assert.equal(matrix.rows[0]![0], true)
  assert.equal(matrix.rows[0]![6], true)
  assert.equal(matrix.rows[1]![1], false)
  assert.equal(matrix.rows[2]![2], true)
  assert.equal(matrix.rows[3]![3], true)
  assert.equal(matrix.rows[6]![6], true)

  // The same pattern in the other two corners.
  assert.equal(matrix.rows[0]![matrix.size - 1], true)
  assert.equal(matrix.rows[matrix.size - 1]![0], true)
})

test('the same text always produces the same matrix', () => {
  assert.deepEqual(qrMatrix(LABEL), qrMatrix(LABEL))
  assert.notDeepEqual(qrMatrix(LABEL), qrMatrix(`${LABEL}2`))
})

test('the SVG path contains quiet-zone-adjusted dark modules only', () => {
  const matrix = qrMatrix(LABEL)
  const path = qrPath(matrix, 2)
  assert.match(path, /^M2 2h1v1h-1z/)
  assert.equal(path.includes('undefined'), false)
  const darkModules = matrix.rows.flat().filter(Boolean).length
  assert.equal((path.match(/M/g) ?? []).length, darkModules)
})

test('a location label is a route, and the QR carries an absolute URL', () => {
  assert.equal(locationLabelPath('Bin A'), '#/location/Bin%20A')
  assert.equal(locationLabelPath('Shelf/left'), '#/location/Shelf%2Fleft')
  assert.equal(locationLabelUrl('Bin A', 'https://example.com/#/stash'), 'https://example.com/#/location/Bin%20A')
  assert.equal(
    locationLabelUrl('Shelf #2', 'https://example.com/'),
    'https://example.com/#/location/Shelf%20%232',
  )
})

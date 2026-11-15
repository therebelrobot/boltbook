import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mmToPixels,
  PAPER_MM,
  planTiles,
  pointsToMillimetres,
  sheetCount,
  tileLabel,
} from '../client/tiling'

test('a page that already fits is one sheet', () => {
  const tiles = planTiles(210, 297, 'a4', 10)
  assert.equal(tiles.length, 1)
  assert.deepEqual(tiles[0], {
    pageNumber: 1,
    row: 0,
    column: 0,
    rows: 1,
    columns: 1,
    xMm: 0,
    yMm: 0,
    widthMm: 210,
    heightMm: 297,
  })
})

test('a small page is not blown up to fill the sheet', () => {
  const [tile] = planTiles(100, 150, 'a4', 10)
  assert.equal(tile!.widthMm, 100)
  assert.equal(tile!.heightMm, 150)
  assert.equal(tile!.columns, 1)
})

test('an A0 pattern on A4 is a 5 × 5 grid with a partial last row and column', () => {
  const tiles = planTiles(841, 1189, 'a4', 10)
  assert.equal(tiles.length, 25)
  assert.equal(sheetCount(tiles), 25)
  assert.equal(tiles[0]!.columns, 5)
  assert.equal(tiles[0]!.rows, 5)

  const last = tiles.at(-1)!
  assert.equal(last.column, 4)
  assert.equal(last.row, 4)
  assert.equal(last.xMm, 800)
  assert.equal(last.yMm, 1148)
  assert.equal(last.widthMm, 41)
  assert.equal(last.heightMm, 41)
})

test('an A3 page on A4 is four overlapping sheets', () => {
  const tiles = planTiles(297, 420, 'a4', 10)
  assert.deepEqual(
    tiles.map((tile) => [tile.row, tile.column, tile.xMm, tile.yMm, tile.widthMm, tile.heightMm]),
    [
      [0, 0, 0, 0, 210, 297],
      [0, 1, 200, 0, 97, 297],
      [1, 0, 0, 287, 210, 133],
      [1, 1, 200, 287, 97, 133],
    ],
  )
})

test('Letter is a different sheet, not a scaled A4', () => {
  assert.deepEqual(PAPER_MM.letter, { width: 215.9, height: 279.4 })
  const tiles = planTiles(215.9, 279.4, 'letter', 0)
  assert.equal(tiles.length, 1)
})

test('the overlap never makes the step zero or negative', () => {
  const tiles = planTiles(500, 500, 'a4', 10_000)
  assert.ok(tiles.length > 0)
  assert.ok(tiles.every((tile) => tile.widthMm > 0 && tile.heightMm > 0))
})

test('a page with no size is no sheets', () => {
  assert.deepEqual(planTiles(0, 297, 'a4', 10), [])
  assert.deepEqual(planTiles(210, -1, 'a4', 10), [])
})

test('physical units survive the trip through points and pixels', () => {
  assert.equal(pointsToMillimetres(72), 25.4)
  assert.equal(pointsToMillimetres(144), 50.8)
  assert.equal(mmToPixels(25.4, 300), 300)
  assert.equal(mmToPixels(210, 300), 2480)
})

test('each sheet says where it belongs', () => {
  const [, second] = planTiles(297, 420, 'a4', 10)
  assert.equal(tileLabel(second!), '1/2 · 2/2')
})

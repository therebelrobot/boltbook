import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FABRIC_MEASURES,
  fromImperial,
  normalizeMeasures,
  parseUnits,
  presentMeasures,
  presentShortfallLines,
  toImperial,
} from '../server/units'
import { formatStored, fromStored, toStored } from '../client/units'

test('units parse, defaulting to metric', () => {
  assert.equal(parseUnits(undefined), 'metric')
  assert.equal(parseUnits('metric'), 'metric')
  assert.equal(parseUnits('imperial'), 'imperial')
  assert.throws(() => parseUnits('furlongs'))
})

test('fabric lengths convert to yards and widths to inches', () => {
  assert.equal(toImperial(914.4, 'fabricLength'), 1)
  assert.equal(toImperial(2500, 'fabricLength'), 2.73)
  assert.equal(toImperial(1400, 'fabricWidth'), 55.12)
  assert.equal(fromImperial(1, 'fabricLength'), 914)
  assert.equal(fromImperial(44, 'fabricWidth'), 1118)
})

test('thread converts metres to yards', () => {
  assert.equal(toImperial(1000, 'threadLength'), 1093.61)
  assert.equal(fromImperial(1000, 'threadLength'), 914)
})

test('an imperial write is normalised to canonical metric', () => {
  const normalised = normalizeMeasures({ name: 'Linen', lengthYd: 2.73, widthIn: 44 }, FABRIC_MEASURES)
  assert.equal(normalised.lengthMm, 2496)
  assert.equal(normalised.widthMm, 1118)
  assert.equal('lengthYd' in normalised, false)
})

test('giving both names for one measure is refused', () => {
  assert.throws(() => normalizeMeasures({ lengthMm: 2000, lengthYd: 2 }, FABRIC_MEASURES))
})

test('a metric record passes through untouched', () => {
  const fabric = { name: 'Linen', lengthMm: 2500 }
  assert.deepEqual(presentMeasures(fabric, FABRIC_MEASURES, 'metric'), fabric)
})

test('an imperial response renames the measure fields', () => {
  const presented = presentMeasures({ name: 'Linen', lengthMm: 2500, widthMm: 1400 }, FABRIC_MEASURES, 'imperial') as Record<string, unknown>
  assert.equal(presented.lengthYd, 2.73)
  assert.equal(presented.widthIn, 55.12)
  assert.equal('lengthMm' in presented, false)
  assert.equal('widthMm' in presented, false)
})

test('shortfall lines carry their unit when imperial', () => {
  const lines = [
    { kind: 'fabric' as const, targetId: 'f1', needed: 2800, available: 2500, short: 300, tooNarrow: false },
    { kind: 'notion' as const, targetId: 'n1', needed: 12, available: 24, short: 0, tooNarrow: false },
  ]
  const metric = presentShortfallLines(lines, 'metric')
  assert.equal(metric.lines[0]!.short, 300)
  assert.equal(metric.lines[0]!.unit, undefined)

  const imperial = presentShortfallLines(lines, 'imperial')
  assert.equal(imperial.lines[0]!.short, 0.33)
  assert.equal(imperial.lines[0]!.unit, 'yd')
  // A count is not a length, so it is left alone.
  assert.equal(imperial.lines[1]!.short, 0)
  assert.equal(imperial.lines[1]!.unit, null)
})

test('the client agrees with the server about conversion', () => {
  assert.equal(fromStored(2500, 'fabricLength', 'imperial'), 2.73)
  assert.equal(fromStored(1400, 'fabricWidth', 'imperial'), 55.12)
  assert.equal(toStored(2.73, 'fabricLength', 'imperial'), 2496)
  assert.equal(formatStored(2500, 'fabricLength', 'metric'), '2.50 m')
  assert.equal(formatStored(2500, 'fabricLength', 'imperial'), '2.73 yd')
  assert.equal(formatStored(850, 'fabricLength', 'metric'), '850 mm')
  assert.equal(formatStored(1400, 'fabricWidth', 'imperial'), '55.12 in')
  assert.equal(formatStored(900, 'threadLength', 'metric'), '900 m')
})

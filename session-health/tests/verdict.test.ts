import { describe, expect, test } from 'claude-code/testing'
import { DEFAULTS, turnsLeft, verdict } from '../hooks/verdict.ts'

const base = { compactions: 0, turns: 10 }

describe('turnsLeft', () => {
  test('undefined with fewer than 2 readings', () => {
    expect(turnsLeft([], 160_000)).toBe(undefined)
    expect(turnsLeft([50_000], 160_000)).toBe(undefined)
  })
  test('undefined when context never grew', () => {
    expect(turnsLeft([60_000, 60_000, 55_000], 160_000)).toBe(undefined)
  })
  test('averages the last 5 positive growths', () => {
    // growths: 10k,10k,10k,10k,10k → (160k-100k)/10k = 6
    expect(turnsLeft([50_000, 60_000, 70_000, 80_000, 90_000, 100_000], 160_000)).toBe(6)
  })
  test('ignores negative growth (a compaction) in the average', () => {
    // growths: +20k, -60k (ignored), +20k → avg 20k; (160k-60k)/20k = 5
    expect(turnsLeft([80_000, 100_000, 40_000, 60_000], 160_000)).toBe(5)
  })
  test('0 when already past the auto-compact point', () => {
    expect(turnsLeft([150_000, 170_000], 160_000)).toBe(0)
  })
})

describe('verdict levels', () => {
  test('healthy below every threshold', () => {
    expect(verdict({ ...base, percent: 30 }).level).toBe('healthy')
  })
  test('healthy when nothing is known (first turn)', () => {
    expect(verdict({ ...base }).level).toBe('healthy')
  })
  test('heavy at 45%', () => expect(verdict({ ...base, percent: 45 }).level).toBe('heavy'))
  test('heavy at <=8 turns left', () =>
    expect(verdict({ ...base, percent: 20, turnsLeft: 8 }).level).toBe('heavy'))
  test('compact at 60%', () => expect(verdict({ ...base, percent: 60 }).level).toBe('compact'))
  test('compact at <=4 turns left', () =>
    expect(verdict({ ...base, percent: 20, turnsLeft: 4 }).level).toBe('compact'))
  test('fresh when compact-worthy and compacted twice', () =>
    expect(verdict({ ...base, percent: 61, compactions: 2 }).level).toBe('fresh'))
  test('fresh when compact-worthy and over 150 turns', () =>
    expect(verdict({ ...base, percent: 61, turns: 151 }).level).toBe('fresh'))
  test('not fresh when compacted twice but light', () =>
    expect(verdict({ ...base, percent: 30, compactions: 2 }).level).toBe('healthy'))
  test('custom thresholds apply', () =>
    expect(verdict({ ...base, percent: 50 }, { ...DEFAULTS, compactPct: 50 }).level).toBe('compact'))
})

describe('budget overlay', () => {
  test('none when rate limits are absent', () =>
    expect(verdict({ ...base, percent: 10 }).budget).toBe(undefined))
  test('none below 90', () =>
    expect(verdict({ ...base, fiveHour: { percent: 89.9 }, week: { percent: 50 } }).budget).toBe(undefined))
  test('names the higher window', () =>
    expect(verdict({ ...base, fiveHour: { percent: 91 }, week: { percent: 95, resetsAt: 'X' } }).budget)
      .toEqual({ kind: 'wk', percent: 95, resetsAt: 'X' }))
  test('ties go to five-hour', () =>
    expect(verdict({ ...base, fiveHour: { percent: 92 }, week: { percent: 92 } }).budget?.kind).toBe('5h'))
  test('overlay is independent of level', () => {
    const v = verdict({ ...base, percent: 10, fiveHour: { percent: 90 } })
    expect(v.level).toBe('healthy')
    expect(v.budget?.kind).toBe('5h')
  })
})

import { describe, expect, test } from 'claude-code/testing'
import { TALLY_MAX, countOf, isTally, put } from '../hooks/tally.ts'

describe('compaction tally per session', () => {
  test('0 for an unknown session or no tally', () => {
    expect(countOf(undefined, 's1')).toBe(0)
    expect(countOf({ s2: { count: 3, at: 1 } }, 's1')).toBe(0)
  })
  test('put records the given count per session id', () => {
    const a = put(undefined, 's1', 1, 10)
    const b = put(a, 's1', 2, 20)
    const c = put(b, 's2', 1, 30)
    expect(countOf(c, 's1')).toBe(2)
    expect(countOf(c, 's2')).toBe(1)
    expect(c.s1!.at).toBe(20)
  })
  test('put overwrites a stored count that fell behind', () =>
    expect(countOf(put({ s1: { count: 1, at: 1 } }, 's1', 4, 2), 's1')).toBe(4))
  test(`keeps only the ${TALLY_MAX} most recently compacted sessions`, () => {
    let t = put(undefined, 'old', 1, 0)
    for (let i = 1; i <= TALLY_MAX; i++) t = put(t, `s${i}`, 1, i)
    expect(Object.keys(t).length).toBe(TALLY_MAX)
    expect(countOf(t, 'old')).toBe(0)
    expect(countOf(t, `s${TALLY_MAX}`)).toBe(1)
  })
  test('isTally rejects junk', () => {
    expect(isTally({ s1: { count: 1, at: 2 } })).toBe(true)
    expect(isTally(null)).toBe(false)
    expect(isTally([])).toBe(false)
    expect(isTally({ s1: { count: 'x', at: 2 } })).toBe(false)
  })
})

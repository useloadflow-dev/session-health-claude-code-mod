import { describe, expect, test } from 'claude-code/testing'
import { TALLY_MAX, bump, countOf, isTally } from '../hooks/tally.ts'

describe('compaction tally per session', () => {
  test('0 for an unknown session or no tally', () => {
    expect(countOf(undefined, 's1')).toBe(0)
    expect(countOf({ s2: { count: 3, at: 1 } }, 's1')).toBe(0)
  })
  test('bump counts up per session id', () => {
    const a = bump(undefined, 's1', 10)
    const b = bump(a, 's1', 20)
    const c = bump(b, 's2', 30)
    expect(countOf(c, 's1')).toBe(2)
    expect(countOf(c, 's2')).toBe(1)
    expect(c.s1!.at).toBe(20)
  })
  test(`keeps only the ${TALLY_MAX} most recently compacted sessions`, () => {
    let t = bump(undefined, 'old', 0)
    for (let i = 1; i <= TALLY_MAX; i++) t = bump(t, `s${i}`, i)
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

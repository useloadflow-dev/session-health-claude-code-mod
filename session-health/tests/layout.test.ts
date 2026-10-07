import { describe, expect, test } from 'claude-code/testing'
import { buttonsWidth, fitLine1, line1, line2, width, type BandModel } from '../hooks/layout.ts'

const now = Date.parse('2026-10-07T12:00:00Z')
const full: BandModel = {
  percent: 58, tokens: 116_000, window: 200_000, turnsLeft: 14, compactions: 1,
  fiveHour: { percent: 31, resetsAt: '2026-10-07T14:14:00Z' },
  week: { percent: 64, resetsAt: '2026-10-10T13:00:00Z' },
  level: 'healthy', phase: 'idle', now,
}
const text = (s: { text: string }[]) => s.map(x => x.text).join('')

describe('line1 tiers', () => {
  test('tier 0 has everything', () => {
    const t = text(line1(full, 0))
    expect(t).toContain('CONTEXT')
    expect(t).toContain('116k/200k')
    expect(t).toContain('~14 turns')
    expect(t).toContain('⟲1')
    expect(t).toContain('SESSION')
    expect(t).toContain('2h14m')
    expect(t).toContain('WEEK')
    expect(t).toContain('3d')
  })
  test('tier 1 drops token counts', () => expect(text(line1(full, 1))).not.toContain('116k'))
  test('tier 2 uses short labels', () => {
    const t = text(line1(full, 2))
    expect(t).toContain('ctx')
    expect(t).not.toContain('CONTEXT')
  })
  test('tier 4 has no bar glyphs', () => expect(text(line1(full, 4))).not.toMatch(/[█░]/))
  test('tier 5 is minimal', () => expect(text(line1(full, 5))).toBe(' 58% · 31% · 64% ●'))
})

describe('fitLine1 never overflows', () => {
  for (const cols of [200, 120, 100, 80, 60, 40, 30]) {
    test(`fits ${cols} columns or is the minimal tier`, () => {
      const segs = fitLine1(full, cols)
      expect(width(segs) <= cols || text(segs) === text(line1(full, 5))).toBe(true)
    })
  }
  test('picks the widest tier that fits', () =>
    expect(text(fitLine1(full, 200))).toBe(text(line1(full, 0))))
})

describe('missing data', () => {
  test('no rate limits → no SESSION/WEEK', () => {
    const t = text(line1({ ...full, fiveHour: undefined, week: undefined }, 0))
    expect(t).not.toContain('SESSION')
    expect(t).not.toContain('WEEK')
  })
  test('no percent → CONTEXT —', () => {
    const t = text(line1({ ...full, percent: undefined, tokens: undefined, turnsLeft: undefined }, 0))
    expect(t).toContain('CONTEXT —')
  })
  test('no turns estimate → shows —', () =>
    expect(text(line1({ ...full, turnsLeft: undefined }, 0))).toContain('~— turns'))
  test('⟲ hidden at 0 compactions', () =>
    expect(text(line1({ ...full, compactions: 0 }, 0))).not.toContain('⟲'))
})

describe('line2', () => {
  test('absent when healthy, idle, no budget', () => expect(line2(full, 120)).toBe(undefined))
  test('heavy offers compact only', () => {
    const l = line2({ ...full, level: 'heavy', turnsLeft: 6 }, 120)!
    expect(text(l.segments)).toContain('getting heavy')
    expect(l.actions).toEqual(['compact'])
  })
  test('compact offers both', () =>
    expect(line2({ ...full, level: 'compact', turnsLeft: 3 }, 120)!.actions).toEqual(['compact', 'fresh']))
  test('fresh offers fresh only', () => {
    const l = line2({ ...full, level: 'fresh', compactions: 2 }, 120)!
    expect(text(l.segments)).toContain('compacted 2×')
    expect(l.actions).toEqual(['fresh'])
  })
  test('budget overlays a healthy verdict', () => {
    const l = line2({ ...full, budget: { kind: '5h', percent: 92, resetsAt: '2026-10-07T12:24:00Z' } }, 120)!
    expect(text(l.segments)).toContain('⚠ 5h budget 92% — resets in 24m, pace yourself')
  })
  test('writing hides buttons', () =>
    expect(line2({ ...full, level: 'compact', phase: 'writing' }, 120)!.actions).toEqual([]))
  test('resumed shows age', () =>
    expect(text(line2({ ...full, phase: 'resumed', phaseAt: now - 12 * 60_000 }, 120)!.segments))
      .toContain('↪ resumed from hand-off (12m ago)'))
  test('buttons dropped under 40 columns', () =>
    expect(line2({ ...full, level: 'compact' }, 39)!.actions).toEqual([]))
})

describe('line2 fits its row with buttons (review I-6)', () => {
  const busy: BandModel = {
    ...full, level: 'compact', turnsLeft: 3,
    budget: { kind: '5h', percent: 92, resetsAt: '2026-10-07T12:24:00Z' },
  }
  for (const cols of [40, 50, 60, 80, 100, 160]) {
    test(`text + buttons ≤ ${cols} columns`, () => {
      const l = line2(busy, cols)!
      expect(width(l.segments) + buttonsWidth(l.actions)).toBeLessThanOrEqual(cols)
    })
  }
  test('truncated text ends with …', () => {
    const l = line2(busy, 60)!
    expect(text(l.segments).endsWith('…')).toBe(true)
  })
  test('wide rows keep the whole text', () =>
    expect(text(line2(busy, 160)!.segments)).toContain('pace yourself'))
  test('buttons give way when they would leave under 16 cells of text', () =>
    expect(line2(busy, 40)!.actions).toEqual([]))
})

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
    expect(t).not.toContain('turns')
    expect(t).toContain('⟲1')
    expect(t).toContain('SESSION')
    expect(t).toContain('2h14m')
    expect(t).toContain('WEEK')
    expect(t).toContain('3d')
  })
  test('short-label tiers keep the context tokens next to ctx', () => {
    for (const tier of [1, 2]) {
      const t = text(line1(full, tier))
      expect(t).toContain('ctx')
      expect(t).not.toContain('CONTEXT')
      expect(t).toContain('116k/200k')
    }
  })
  test('tier 3 has no bar glyphs or token counts', () => {
    const t = text(line1(full, 3))
    expect(t).not.toMatch(/[█░]/)
    expect(t).not.toContain('116k')
  })
  test('tier 4 is minimal', () => expect(text(line1(full, 4))).toBe(' 58% · 31% · 64% ●'))
})

describe('fitLine1 never overflows', () => {
  for (const cols of [200, 120, 100, 80, 60, 40, 30]) {
    test(`fits ${cols} columns or is the minimal tier`, () => {
      const segs = fitLine1(full, cols)
      expect(width(segs) <= cols || text(segs) === text(line1(full, 4))).toBe(true)
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
  test('the next-step advice still names the turns left', () => {
    expect(text(line2({ ...full, level: 'heavy', turnsLeft: 6 }, 160)!.segments)).toContain('(~6 turns left)')
    expect(text(line2({ ...full, level: 'compact', turnsLeft: 3 }, 160)!.segments)).toContain('auto-compact in ~3 turns')
  })
  test('fresh offers fresh only', () => {
    const l = line2({ ...full, level: 'fresh', compactions: 2 }, 120)!
    expect(text(l.segments)).toContain('compacted 2×')
    expect(l.actions).toEqual(['fresh'])
  })
  test('a healthy nudge is a dim hint with [fresh start]', () => {
    const l = line2({ ...full, compactions: 2, nudge: true }, 120)!
    expect(text(l.segments)).toContain('compacted 2×')
    expect(text(l.segments)).toContain('fresh start')
    expect(l.segments.find(s => s.text.includes('compacted'))?.dim).toBe(true)
    expect(l.actions).toEqual(['fresh'])
  })
  test('a heavy nudge suggests fresh over another compact and offers both', () => {
    const l = line2({ ...full, level: 'heavy', compactions: 2, nudge: true }, 120)!
    expect(text(l.segments)).toContain('getting heavy')
    expect(text(l.segments)).toContain('compacted 2×')
    expect(l.actions).toEqual(['compact', 'fresh'])
  })
  test('the nudge waits while a hand-off is being written', () =>
    expect(text(line2({ ...full, compactions: 2, nudge: true, phase: 'writing' }, 120)!.segments))
      .not.toContain('compacted'))
  test('the nudge sits beside a budget warning', () => {
    const l = line2({ ...full, compactions: 2, nudge: true, budget: { kind: 'wk', percent: 93 } }, 200)!
    expect(text(l.segments)).toContain('compacted 2×')
    expect(text(l.segments)).toContain('⚠ wk budget 93%')
  })
  test('budget overlays a healthy verdict', () => {
    const l = line2({ ...full, budget: { kind: '5h', percent: 92, resetsAt: '2026-10-07T12:24:00Z' } }, 120)!
    expect(text(l.segments)).toContain('⚠ 5h budget 92% — resets in 24m, pace yourself')
  })
  test('writing hides buttons', () =>
    expect(line2({ ...full, level: 'compact', phase: 'writing' }, 120)!.actions).toEqual([]))
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

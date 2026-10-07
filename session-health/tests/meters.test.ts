import { describe, expect, test } from 'claude-code/testing'
import { AMBER, CORAL, LIME, bar, barColor, kTokens, relTime } from '../hooks/meters.ts'

describe('barColor', () => {
  test('lime below 70', () => expect(barColor(69.9)).toBe(LIME))
  test('amber from 70', () => expect(barColor(70)).toBe(AMBER))
  test('amber through 89', () => expect(barColor(89.9)).toBe(AMBER))
  test('coral from 90', () => expect(barColor(90)).toBe(CORAL))
  test('lime is the requested #aaff00', () => expect(LIME).toBe('#aaff00'))
})

describe('bar', () => {
  test('empty at 0', () => expect(bar(0, 10)).toEqual({ filled: '', empty: '░'.repeat(10) }))
  test('full at 100', () => expect(bar(100, 10)).toEqual({ filled: '█'.repeat(10), empty: '' }))
  test('clamps above 100 and below 0', () => {
    expect(bar(140, 10).filled).toBe('█'.repeat(10))
    expect(bar(-5, 10).filled).toBe('')
  })
  test('58% of 10 cells is 5 full + ▊', () =>
    expect(bar(58, 10)).toEqual({ filled: '█████▊', empty: '░░░░' }))
  test('always exactly `cells` wide', () => {
    for (let p = 0; p <= 100; p += 0.7) {
      const b = bar(p, 10)
      expect(b.filled.length + b.empty.length).toBe(10)
      const s = bar(p, 5)
      expect(s.filled.length + s.empty.length).toBe(5)
    }
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  test('undefined when absent or unparsable', () => {
    expect(relTime(undefined, now)).toBe(undefined)
    expect(relTime('garbage', now)).toBe(undefined)
  })
  test('now when in the past', () => expect(relTime('2026-10-07T11:00:00Z', now)).toBe('now'))
  test('minutes under an hour', () => expect(relTime('2026-10-07T12:24:00Z', now)).toBe('24m'))
  test('hours+minutes under 48h', () => expect(relTime('2026-10-07T14:14:00Z', now)).toBe('2h14m'))
  test('days from 48h', () => expect(relTime('2026-10-10T13:00:00Z', now)).toBe('3d'))
})

describe('kTokens', () => {
  test('under 1000 raw', () => expect(kTokens(950)).toBe('950'))
  test('thousands', () => expect(kTokens(116_400)).toBe('116k'))
  test('millions', () => expect(kTokens(1_000_000)).toBe('1M'))
  test('fractional millions', () => expect(kTokens(1_500_000)).toBe('1.5M'))
})

import { describe, expect, test } from 'claude-code/testing'
import { toastsFor } from '../hooks/toasts.ts'

const fresh = { level: 'healthy' as const, budget: {} }

describe('level toasts', () => {
  test('escalation toasts once', () => {
    const a = toastsFor(fresh, { level: 'compact' })
    expect(a.messages).toEqual(['◑ Compact now — context is filling up'])
    const b = toastsFor(a.memory, { level: 'compact' })
    expect(b.messages).toEqual([])
  })
  test('de-escalation is silent and resets', () => {
    const a = toastsFor({ level: 'compact', budget: {} }, { level: 'healthy' })
    expect(a.messages).toEqual([])
    expect(toastsFor(a.memory, { level: 'heavy' }).messages.length).toBe(1)
  })
  test('healthy never toasts', () => expect(toastsFor(fresh, { level: 'healthy' }).messages).toEqual([]))
})

describe('budget toasts', () => {
  const w = (percent: number) => ({ percent, resetsAt: 'R1' })
  test('75 then 90, each once', () => {
    const a = toastsFor(fresh, { level: 'healthy', fiveHour: w(76) })
    expect(a.messages).toEqual(['5-hour budget at 76%'])
    const b = toastsFor(a.memory, { level: 'healthy', fiveHour: w(80) })
    expect(b.messages).toEqual([])
    const c = toastsFor(b.memory, { level: 'healthy', fiveHour: w(91) })
    expect(c.messages).toEqual(['⚠ 5-hour budget at 91% — pace yourself'])
  })
  test('a new reset window toasts again', () => {
    const a = toastsFor(fresh, { level: 'healthy', week: w(76) })
    const b = toastsFor(a.memory, { level: 'healthy', week: { percent: 77, resetsAt: 'R2' } })
    expect(b.messages).toEqual(['Weekly budget at 77%'])
  })
  test('jumping straight past 90 toasts only the 90 message', () =>
    expect(toastsFor(fresh, { level: 'healthy', week: w(95) }).messages)
      .toEqual(['⚠ Weekly budget at 95% — pace yourself']))
})

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { current, lapse, newer } from '../hooks/budgets.ts'

// Budgets are the account's: every session shows the newest reading any of them heard.
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}
const NOW = Date.parse('2026-10-08T12:00:00Z')
const LATER = '2026-10-08T15:00:00Z'
const NEXT_WEEK = '2026-10-12T00:00:00Z'

function host(on: On, opts: { store?: Record<string, unknown>; usage?: unknown[] } = {}) {
  const store = new Map(Object.entries(opts.store ?? {}))
  const clock = mock.clock(on, { now: NOW })
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: opts.usage ?? [] } }) as never)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { store, clock }
}

const start = { cwd: '/proj', surface: 'terminal', isInteractive: true } as never
const limits = (five: number, week: number) => [
  { kind: 'five_hour', percentUsed: five, resetsAt: LATER },
  { kind: 'seven_day', percentUsed: week, resetsAt: NEXT_WEEK },
]
const measure = (five: number, week: number) =>
  ({ context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: limits(five, week), changed: ['rateLimits'] }) as never

test('newer picks the reading heard last', () => {
  const a = { at: 1, fiveHour: { percent: 10 } }
  const b = { at: 2, fiveHour: { percent: 20 } }
  expect(newer(a, b)).toBe(b)
  expect(newer(b, a)).toBe(b)
  expect(newer(undefined, a)).toBe(a)
})

test('a window past its reset reads empty', () => {
  expect(lapse({ percent: 80, resetsAt: '2026-10-08T11:00:00Z' }, NOW)).toEqual({ percent: 0 })
  expect(lapse({ percent: 80, resetsAt: LATER }, NOW)).toEqual({ percent: 80, resetsAt: LATER })
  expect(current({ at: 5, week: { percent: 3 } }, NOW)).toEqual({ at: 5, week: { percent: 3 } })
})

test('a measured response is shared with other sessions', async ($, on) => {
  const h = host(on)
  await $.session.measure(measure(42, 17))
  expect(h.store.get('budgets')).toEqual({
    at: NOW,
    fiveHour: { percent: 42, resetsAt: LATER },
    week: { percent: 17, resetsAt: NEXT_WEEK },
  })
})

test('an idle session picks up a newer reading another session heard', async ($, on) => {
  const h = host(on, { usage: limits(10, 5) })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /10%/ })).toBeDefined()

  h.store.set('budgets', { at: NOW + 1000, fiveHour: { percent: 63, resetsAt: LATER }, week: { percent: 28, resetsAt: NEXT_WEEK } })
  await h.clock.advance(15_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /63%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /28%/ })).toBeDefined()
  await ui.unmount()
})

test('an older shared reading does not overwrite a fresher one of our own', async ($, on) => {
  const h = host(on, { store: { budgets: { at: NOW - 60_000, fiveHour: { percent: 5 }, week: { percent: 1 } } } })
  await $.session.start(start)
  await $.session.measure(measure(50, 20))
  await h.clock.advance(15_000)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
  expect((h.store.get('budgets') as { at: number }).at).toBe(NOW)
  await ui.unmount()
})

test('the 5-hour meter empties once its window resets', async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  await $.session.measure(measure(88, 20))
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /88%/ })).toBeDefined()
  await h.clock.set(Date.parse(LATER) + 1)
  await h.clock.advance(15_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /88%/ })).toBe(undefined)
  await ui.unmount()
})

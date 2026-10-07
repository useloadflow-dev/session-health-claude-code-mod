import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Review fixes: the band and hand-off against the session's own events (measure, /clear, reload).
declare const setTimeout: (fn: () => void, ms: number) => unknown
const tick = () => new Promise<void>(r => setTimeout(() => r(), 1))
const cmd = (command: string) => ({ command }) as never

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}

type Host = { store: Map<string, unknown>; files: Map<string, string>; toasts: string[]; turns: { n: number }; completes: string[] }

function host(on: On, opts: { sessionId?: string; store?: Record<string, unknown>; messages?: { role: string; text: string }[] } = {}): Host {
  const h: Host = { store: new Map(Object.entries(opts.store ?? {})), files: new Map(), toasts: [], turns: { n: 5 }, completes: [] }
  mock.clock(on)
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: opts.sessionId ?? 's1' }))
  on('session.turns', () => ({ value: h.turns.n }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.messages', () => ({ value: opts.messages ?? [] }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('model.complete', (_$, e) => {
    h.completes.push(e.prompt)
    return { value: { isAnswered: true, text: 'invented brief', usage: USAGE } }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.write', (_$, e) => {
    h.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    h.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return h
}

const measure = (percent: number, tokens: number) =>
  ({ context: { tokens, window: 200_000, percent }, rateLimits: [], changed: ['context'] }) as never
const clear = { reason: 'clear', sessionId: 's1', resume: {} } as never
const start = { cwd: '/proj', surface: 'terminal', isInteractive: true } as never

test('I-1: /clear drops the old conversation’s context figures', async ($, on) => {
  host(on)
  await $.session.measure(measure(75, 150_000))
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined()
  await $.session.end(clear)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /75%/ })).toBe(undefined)
  expect(await ui.find({ key: 'compact' })).toBe(undefined)
  await ui.unmount()
})

test('I-1: nothing to fork and an empty transcript writes no brief and keeps the waiting one', async ($, on) => {
  const waiting = { path: '/proj/.claude/handoff.md', writtenAt: Date.now(), sessionId: 'old', consumed: false }
  const h = host(on, { store: { 'handoff:/proj': waiting } })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  const r = await $.command.run(cmd('handoff'))
  expect(r.text).toContain('not written')
  expect(h.completes).toEqual([])
  expect(h.files.size).toBe(0)
  expect(h.store.get('handoff:/proj')).toEqual(waiting)
})

test('I-2: two fast [fresh start] presses fork once', { options: { compactPct: 0, freshCompactions: 0 } }, async ($, on) => {
  host(on)
  let forks = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('model.fork', async () => {
    forks += 1
    await gate
    return { value: { isAnswered: true, text: 'brief', usage: USAGE } }
  })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  const a = ui.press({ key: 'fresh' })
  const b = ui.press({ key: 'fresh' })
  for (let i = 0; i < 20; i++) await tick()
  release()
  await Promise.all([a, b])
  expect(forks).toBe(1)
  await ui.unmount()
})

test('I-3: a reload clears a hand-off left "writing"', async ($, on) => {
  host(on)
  let forks = 0
  on('model.fork', async () => {
    forks += 1
    if (forks === 1) await new Promise<void>(() => {}) // the worker that ran it is gone
    return { value: { isAnswered: true, text: 'brief', usage: USAGE } }
  })
  void $.command.run(cmd('handoff'))
  for (let i = 0; i < 20 && forks === 0; i++) await tick()
  await $.session.start(start)
  const r = await $.command.run(cmd('handoff'))
  expect(r.text).toContain('run /clear')
  expect(forks).toBe(2)
})

test(
  'M-3: a compaction finishing does not wipe a hand-off that became ready meanwhile',
  { options: { compactPct: 0 } },
  async ($, on) => {
    host(on)
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    let compacting = false
    on('session.compact', async () => {
      compacting = true
      await gate
      return { skip: 'test' }
    })
    on('model.fork', () => ({ value: { isAnswered: true, text: 'brief', usage: USAGE } }))
    const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
    const pressing = ui.press({ key: 'compact' })
    for (let i = 0; i < 20 && !compacting; i++) await tick()
    expect(compacting).toBe(true)
    const r = await $.command.run(cmd('handoff'))
    expect(r.text).toContain('run /clear')
    release()
    await pressing
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBeDefined()
    await ui.unmount()
  },
)

test('M-4: "hand-off ready" gives way after three more turns', async ($, on) => {
  const h = host(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'brief', usage: USAGE } }))
  await $.command.run(cmd('handoff'))
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBeDefined()
  h.turns.n = 8
  await $.session.measure(measure(30, 60_000))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBe(undefined)
  await ui.unmount()
})

test('M-4: /resume also clears "hand-off ready"', async ($, on) => {
  host(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'brief', usage: USAGE } }))
  await $.command.run(cmd('handoff'))
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as never)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBe(undefined)
  await ui.unmount()
})

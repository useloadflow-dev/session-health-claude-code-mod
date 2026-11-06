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

type Host = { store: Map<string, unknown>; files: Map<string, string>; toasts: string[]; turns: { n: number }; completes: string[]; commands: string[]; id: { v: string }; failSets: { n: number } }

function host(on: On, opts: { sessionId?: string; store?: Record<string, unknown>; messages?: { role: string; text: string }[] } = {}): Host {
  const h: Host = { store: new Map(Object.entries(opts.store ?? {})), files: new Map(), toasts: [], turns: { n: 5 }, completes: [], commands: [], id: { v: opts.sessionId ?? 's1' }, failSets: { n: 0 } }
  mock.clock(on)
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: h.id.v }))
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
    if (h.failSets.n > 0) {
      h.failSets.n--
      throw new Error('store unavailable')
    }
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
  on('command.register', (_$, e) => {
    h.commands.push(e.name)
    return { value: undefined } as never
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [{ name: 'pickup-save' }] as never }))
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

const FRESH = { options: { compactPct: 0, freshCompactions: 0 } }
const saved = { text: 'Saved hand-off to .claude/handoff.md. Run /clear to start fresh from it.' }

test('I-3: a reload clears a hand-off left "saving"', FRESH, async ($, on) => {
  host(on)
  let saves = 0
  on('command.run', { command: 'pickup-save' }, async () => {
    saves += 1
    if (saves === 1) await new Promise<void>(() => {}) // the worker that ran it is gone
    return saved
  })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  void ui.press({ key: 'fresh' })
  for (let i = 0; i < 20 && saves === 0; i++) await tick()
  await $.session.start(start)
  await ui.redraw()
  await ui.press({ key: 'fresh' })
  expect(saves).toBe(2)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBeDefined()
  await ui.unmount()
})

test('M-4: "hand-off ready" gives way after three more turns', FRESH, async ($, on) => {
  const h = host(on)
  on('command.run', { command: 'pickup-save' }, () => saved)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fresh' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBeDefined()
  h.turns.n = 8
  await $.session.measure(measure(30, 60_000))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBe(undefined)
  await ui.unmount()
})

test('M-4: /resume also clears "hand-off ready"', FRESH, async ($, on) => {
  host(on)
  on('command.run', { command: 'pickup-save' }, () => saved)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fresh' })
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBe(undefined)
  await ui.unmount()
})

test('a compaction of the main conversation shows as ⟲1 on line 1', async ($, on) => {
  host(on)
  const summary = [{ role: 'user', text: 'summary', toolUses: [] }] as never
  on('session.compact', () => ({ messages: summary }))
  await $.session.measure(measure(30, 60_000))
  await $.session.compact({ trigger: 'manual', messages: summary } as never)
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /⟲1/ })).toBeDefined()
  await ui.unmount()
})

test('/smart-compact is registered for the session', async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  expect(h.commands).toContain('smart-compact')
  // /handoff now belongs to project-pickup.
  expect(h.commands.includes('handoff')).toBe(false)
})

test('/smart-compact runs /compact with the smart instructions', async ($, on) => {
  host(on)
  const asked: string[] = []
  on('command.run', { command: 'compact' }, (_$, e) => {
    asked.push(e.args)
    return { text: '' }
  })
  const r = await $.command.run({ command: 'smart-compact', args: '' } as never)
  for (let i = 0; i < 20 && asked.length === 0; i++) await tick()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('Preserve: the current goal')
  expect(r.text).toContain('Compacting')
  // Let the detached compaction finish its phase bookkeeping before the test ends.
  for (let i = 0; i < 10; i++) await tick()
})

const SUMMARY = [{ role: 'user', text: 'summary', toolUses: [] }] as never

test('each compaction is recorded under the session id in the store', async ($, on) => {
  const h = host(on)
  on('session.compact', () => ({ messages: SUMMARY }))
  await $.session.measure(measure(30, 60_000))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect((h.store.get('compactions') as Record<string, { count: number }>).s1!.count).toBe(2)
})

test('a session resumed in a new process picks its count back up', async ($, on) => {
  host(on, { store: { compactions: { s1: { count: 3, at: 1 } } } })
  await $.session.start({ cwd: '/proj', source: 'resume' } as never)
  await $.session.measure(measure(30, 60_000))
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /⟲3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compacted 3×/ })).toBeDefined()
  await ui.unmount()
})

test('/clear starts the new conversation at 0; /resume back restores its count', async ($, on) => {
  const h = host(on)
  on('session.compact', () => ({ messages: SUMMARY }))
  await $.session.measure(measure(30, 60_000))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)

  await $.session.end(clear)
  h.id.v = 's2'
  await $.session.measure(measure(10, 20_000))
  let ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /⟲/ })).toBe(undefined)
  await ui.unmount()

  await $.session.end({ reason: 'resume', sessionId: 's2', resume: {} } as never)
  h.id.v = 's1'
  await $.session.measure(measure(30, 60_000))
  ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /⟲1/ })).toBeDefined()
  await ui.unmount()
})

test('a failed store write is made good by the next compaction', async ($, on) => {
  const h = host(on)
  on('session.compact', () => ({ messages: SUMMARY }))
  await $.session.measure(measure(30, 60_000))
  h.failSets.n = 1
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  expect(h.store.get('compactions')).toBe(undefined)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  expect((h.store.get('compactions') as Record<string, { count: number }>).s1!.count).toBe(2)
})

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The kit's own $ takes the engine's full inputs; the host fills origin and the rest.
declare const setTimeout: (fn: () => void, ms: number) => unknown
const cmd = (command: string) => ({ command }) as never
const prompt = (text: string) => ({ text }) as never

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The host beneath the plugin: a project root, a session id and turn count, files in memory.
type Host = { files: Map<string, string>; store: Map<string, unknown>; toasts: string[]; statuses: string[] }

function host(
  on: On,
  opts: { sessionId: string; turns: number; now?: number; files?: Map<string, string>; store?: Record<string, unknown> },
): Host {
  const files = opts.files ?? new Map<string, string>()
  const store = new Map(Object.entries(opts.store ?? {}))
  const toasts: string[] = []
  const statuses: string[] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    statuses.push(String(e.text))
    return { value: undefined }
  })
  mock.clock(on, opts.now === undefined ? undefined : { now: opts.now })
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: opts.sessionId }))
  on('session.turns', () => ({ value: opts.turns }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  return { files, store, toasts, statuses }
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}

test('/handoff writes the brief from a fork and records it', async ($, on) => {
  const h = host(on, { sessionId: 's1', turns: 5 })
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '# Hand-off — proj\n## Goal\nship it', usage: USAGE } }
  })
  const r = await $.command.run(cmd('handoff'))
  expect(r.text).toContain('run /clear')
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('## Gotchas')
  expect(h.files.get('/proj/.claude/handoff.md')).toContain('ship it')
  const rec = h.store.get('handoff:/proj') as { consumed: boolean; sessionId: string }
  expect(rec.consumed).toBe(false)
  expect(rec.sessionId).toBe('s1')
  expect(h.toasts).toContain('Hand-off ready — run /clear')
})

test(
  '/handoff while a [fresh start] brief is being written does not fork again',
  { options: { compactPct: 0, freshCompactions: 0 } },
  async ($, on) => {
    host(on, { sessionId: 's1', turns: 5 })
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    let forks = 0
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    on('model.fork', async () => {
      forks += 1
      await gate
      return { value: { isAnswered: true, text: 'brief', usage: USAGE } }
    })
    const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
    const pressing = ui.press({ key: 'fresh' })
    for (let i = 0; i < 50 && forks === 0; i++) await new Promise<void>(r => setTimeout(() => r(), 1))
    const second = await $.command.run(cmd('handoff'))
    release()
    await pressing
    expect(forks).toBe(1)
    expect(second.text).toContain('already being written')
    await ui.unmount()
  },
)

test('a fork failure reports and leaves no record', async ($, on) => {
  const h = host(on, { sessionId: 's1', turns: 5 })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))
  const r = await $.command.run(cmd('handoff'))
  expect(r.text).toContain('not written')
  expect(h.store.get('handoff:/proj')).toBe(undefined)
  expect(h.toasts).toContain('Hand-off failed: empty-reply')
})

const RECORD = (now: number, sessionId: string) => ({
  'handoff:/proj': { path: '/proj/.claude/handoff.md', writtenAt: now - 60_000, sessionId, consumed: false },
})

test('the brief loads into the first prompt of a new conversation, once', async ($, on) => {
  const now = Date.now()
  const h = host(on, {
    sessionId: 'new', turns: 0, now, store: RECORD(now, 'old'),
    files: new Map([['/proj/.claude/handoff.md', 'THE BRIEF']]),
  })
  const contexts: (readonly string[])[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text }
  })

  await $.prompt.submit(prompt('what were we doing?'))
  expect(h.statuses).toEqual([])
  expect(contexts[0]).toEqual(['Hand-off from the previous session:\n\nTHE BRIEF'])
  expect((h.store.get('handoff:/proj') as { consumed: boolean }).consumed).toBe(true)

  await $.prompt.submit(prompt('and again'))
  expect(contexts[1]).toEqual([])
})

test('the brief does not load back into the conversation that wrote it', async ($, on) => {
  const now = Date.now()
  host(on, {
    sessionId: 'same', turns: 0, now, store: RECORD(now, 'same'),
    files: new Map([['/proj/.claude/handoff.md', 'THE BRIEF']]),
  })
  const contexts: (readonly string[])[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text }
  })
  await $.prompt.submit(prompt('hi'))
  expect(contexts).toEqual([[]])
})

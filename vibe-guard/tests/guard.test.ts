import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// vibe-guard against a project's vibe-wise notes: asking once, holding edits, pausing.
declare const setTimeout: (fn: () => void, ms: number) => unknown
const tick = () => new Promise<void>(r => setTimeout(() => r(), 1))

const START = 'Start learning'
const NEVER = 'Not in this project'
const LATER = 'Ask me later'

const ACTIVE = '# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n'
const PAUSED = '# Learner Profile\n\nLearning mode: paused\nOnboarding: complete\n'
const PENDING = '# Learning Progress\n\n## Pending decision\n\n- Decision: Folder membership\n- Stage: awaiting implementation approval\n'
const CLEAR = '# Learning Progress\n\nNo learning events recorded yet.\n'

type Host = {
  files: Map<string, string>
  store: Map<string, unknown>
  asked: string[]
  answer: { value: string | undefined }
  runs: { command: string; args: string }[]
  status: (string | undefined)[]
  clock: { advance: (ms: number) => Promise<void> }
}

function host(on: On, opts: { files?: Record<string, string>; dirs?: string[]; store?: Record<string, unknown>; installed?: boolean } = {}): Host {
  const h: Host = {
    files: new Map(Object.entries(opts.files ?? {})),
    store: new Map(Object.entries(opts.store ?? {})),
    asked: [],
    answer: { value: START },
    runs: [],
    status: [],
    clock: mock.clock(on),
  }
  const dirs = new Set(opts.dirs ?? [])
  for (const path of h.files.keys()) dirs.add(path.slice(0, path.lastIndexOf('/')))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: h.files.has(e.path) || dirs.has(e.path) }))
  on('fs.read', (_$, e) => {
    const text = h.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    h.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.list', () => ({
    value: opts.installed === false ? [] : [{ name: 'vibe-wise:learn', description: 'Learn', source: 'plugin' }],
  }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('command.run', (_$, e) => {
    h.runs.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = (e.questions as { question: string }[])[0]!.question
    h.asked.push(q)
    if (h.answer.value === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q]: h.answer.value } } } as never
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: { ok: true } }) as never)
  on('ui.status', (_$, e) => {
    h.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => e as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return h
}

const start = { cwd: '/proj', surface: 'terminal', isInteractive: true } as never
const prompt = (text: string) => ({ text, wait: false }) as never
const edit = (file_path: string) => ({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as never
const write = (file_path: string) => ({ tool: 'Write', file_path, content: 'x' }) as never
const learning = (progress: string, profile = ACTIVE) => ({
  '/proj/.vibe-wise/profile.md': profile,
  '/proj/.vibe-wise/progress.md': progress,
})
const run = (args: string) => ({ command: 'learning', args }) as never

// Holding edits

test('an edit is held while a decision is pending', async ($, on) => {
  host(on, { files: learning(PENDING) })
  await $.session.start(start)
  const r = await $.tool.call(edit('/proj/src/notes.ts'))
  expect(r.deny).toContain('Folder membership')
  expect(r.deny).toContain('implementation approval')
})

test('a relative path is held too', async ($, on) => {
  host(on, { files: learning(PENDING) })
  await $.session.start(start)
  const r = await $.tool.call(write('src/folders.ts'))
  expect(r.deny).toContain('Folder membership')
})

test('vibe-wise can still write its own notes while a decision is pending', async ($, on) => {
  host(on, { files: learning(PENDING) })
  await $.session.start(start)
  const r = await $.tool.call(edit('/proj/.vibe-wise/progress.md'))
  expect(r.deny).toBe(undefined)
})

test('edits pass once the decision is resolved', async ($, on) => {
  const h = host(on, { files: learning(PENDING) })
  await $.session.start(start)
  expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBeDefined()
  h.files.set('/proj/.vibe-wise/progress.md', CLEAR)
  expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBe(undefined)
})

test('edits pass while learning is paused', async ($, on) => {
  host(on, { files: learning(PENDING, PAUSED) })
  await $.session.start(start)
  expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBe(undefined)
})

test('edits pass in a project without vibe-wise notes', async ($, on) => {
  host(on)
  await $.session.start(start)
  expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBe(undefined)
})

// Asking once per project

test('the first prompt in a project without notes asks; Start runs vibe-wise with the prompt', async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  const r = await $.prompt.submit(prompt('build a notes app'))
  await h.clock.advance(10)
  for (let i = 0; i < 20 && h.runs.length === 0; i++) await tick()
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('proj')
  expect(h.runs).toEqual([{ command: 'vibe-wise:learn', args: 'build a notes app' }])
  expect(r.drop).toBeDefined()
})

test('Not in this project is remembered across sessions', async ($, on) => {
  const h = host(on)
  h.answer.value = NEVER
  await $.session.start(start)
  const r = await $.prompt.submit(prompt('fix the bug'))
  expect(r.text).toBe('fix the bug')
  await $.session.start(start)
  await $.prompt.submit(prompt('another'))
  expect(h.asked.length).toBe(1)
  expect(h.runs).toEqual([])
})

test('Ask me later asks again next session, not this one', async ($, on) => {
  const h = host(on)
  h.answer.value = LATER
  await $.session.start(start)
  expect((await $.prompt.submit(prompt('one'))).text).toBe('one')
  await $.prompt.submit(prompt('two'))
  expect(h.asked.length).toBe(1)
  await $.session.start(start)
  await $.prompt.submit(prompt('three'))
  expect(h.asked.length).toBe(2)
})

test('a dismissed question lets the prompt through', async ($, on) => {
  const h = host(on)
  h.answer.value = undefined
  await $.session.start(start)
  expect((await $.prompt.submit(prompt('go'))).text).toBe('go')
  expect(h.runs).toEqual([])
})

test('never asks where learning is set up or paused', async ($, on) => {
  const h = host(on, { files: { '/proj/.vibe-wise/profile.md': PAUSED } })
  await $.session.start(start)
  expect((await $.prompt.submit(prompt('go'))).text).toBe('go')
  expect(h.asked).toEqual([])
})

test('never asks when vibe-wise is not installed', async ($, on) => {
  const h = host(on, { installed: false })
  await $.session.start(start)
  await $.prompt.submit(prompt('go'))
  expect(h.asked).toEqual([])
})

test('a slash command is never interrupted', async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  await $.prompt.submit(prompt('/help'))
  expect(h.asked).toEqual([])
})

// Status and pause / resume

test('the status line names the pending checkpoint', async ($, on) => {
  const h = host(on, { files: learning(PENDING) })
  await $.session.start(start)
  expect(h.status.at(-1)).toContain('Folder membership')
})

test('/learning pause and resume flip the profile', async ($, on) => {
  const h = host(on, { files: learning(CLEAR) })
  await $.session.start(start)
  const paused = await $.command.run(run('pause'))
  expect(paused.text).toContain('paused')
  expect(h.files.get('/proj/.vibe-wise/profile.md')).toContain('Learning mode: paused')
  expect(h.status.at(-1)).toContain('paused')
  await $.command.run(run('resume'))
  expect(h.files.get('/proj/.vibe-wise/profile.md')).toContain('Learning mode: active')
})

test('/learning with no notes says how to start', async ($, on) => {
  host(on)
  await $.session.start(start)
  const r = await $.command.run(run(''))
  expect(r.text).toContain('/vibe-wise:learn')
})

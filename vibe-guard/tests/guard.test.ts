import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// vibe-guard against a project's vibe-wise notes: holding edits, pausing.

const ACTIVE = '# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n'
const PAUSED = '# Learner Profile\n\nLearning mode: paused\nOnboarding: complete\n'
const PENDING = '# Learning Progress\n\n## Pending decision\n\n- Decision: Folder membership\n- Stage: awaiting implementation approval\n'
const CLEAR = '# Learning Progress\n\nNo learning events recorded yet.\n'

type Host = {
  files: Map<string, string>
  status: (string | undefined)[]
}

function host(on: On, opts: { files?: Record<string, string>; dirs?: string[]} = {}): Host {
  const h: Host = {
    files: new Map(Object.entries(opts.files ?? {})),
    status: [],
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
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: { ok: true } }) as never)
  on('ui.status', (_$, e) => {
    h.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_$, e) => e as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return h
}

const start = { cwd: '/proj', surface: 'terminal', isInteractive: true } as never
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

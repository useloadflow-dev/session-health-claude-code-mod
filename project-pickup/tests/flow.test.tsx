import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const cmd = (command: string, args = '') => ({ command, args }) as never
const prompt = (text: string) => ({ text }) as never
const DAY = 86_400_000

type Host = { files: Map<string, string>; store: Map<string, unknown>; statuses: (string | undefined)[]; toasts: string[]; panes: Map<string, boolean> }

// The engine beneath the mod: a project at /proj, files in memory, a session id and turn count.
function host(on: On, opts: { files?: Record<string, string>; turns?: number; sessionId?: string; now?: number; store?: Record<string, unknown>; placed?: boolean } = {}): Host {
  const files = new Map(Object.entries(opts.files ?? {}))
  const store = new Map(Object.entries(opts.store ?? {}))
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const now = opts.now ?? 100 * DAY
  mock.clock(on, { now })
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: opts.sessionId ?? 's1' }))
  on('session.turns', () => ({ value: opts.turns ?? 0 }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.messages', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // Open panes by id; the value says whether it is the tab on show.
  const panes = new Map<string, boolean>()
  on('ui.open', (_$, e) => {
    if (opts.placed === false) return { value: { isPlaced: false, reason: 'no surface' } }
    panes.set(e.id, true)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes].map(([id, isShown]) => ({ id, title: id, isShown, isFocused: false, isPlaced: true })),
  }))
  on('fs.list', (_$, e) => {
    const dir = `${e.path ?? '/proj'}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: 1, mtimeMs: now - 2 * DAY, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path)! }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: now - 2 * DAY, isLink: false } }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return { files, store, statuses, toasts, panes }
}

const LEGACY = '# VanSync handoff\n- Step 5 CONFIRMED + IMPLEMENTED\n## Next\nTestFlight build'
const start = ($: Parameters<TestBody>[0]) =>
  $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

test('finds HANDOFF.md at the root and shows where the project stands', async ($, on) => {
  const h = host(on, { files: { '/proj/HANDOFF.md': LEGACY } })
  await start($)
  expect(h.statuses.at(-1)).toBe('◆ proj · step 5 done · next: TestFlight build · saved 2d ago')
  expect((h.store.get('projects') as Record<string, { path: string }>)['/proj']!.path).toBe('HANDOFF.md')
})

test('prefers .claude/handoff.md over one at the root', async ($, on) => {
  const h = host(on, { files: { '/proj/.claude/handoff.md': '## Steps\n- [x] a\n- [ ] b', '/proj/handoff.md': LEGACY } })
  await start($)
  expect(h.statuses.at(-1)).toContain('1/2')
})

test('the first prompt of a conversation carries the hand-off, once', async ($, on) => {
  host(on, { files: { '/proj/handoff.md': LEGACY } })
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await start($)
  await $.prompt.submit(prompt('what next?'))
  await $.prompt.submit(prompt('again'))
  expect(seen[0]![0]).toContain('Project hand-off for proj, from handoff.md (saved 2d ago)')
  expect(seen[0]![0]).toContain('Step 5 CONFIRMED')
  expect(seen[1] ?? []).toEqual([])
})

test('a conversation already under way is not briefed', async ($, on) => {
  host(on, { files: { '/proj/handoff.md': LEGACY }, turns: 4 })
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await $.prompt.submit(prompt('hi'))
  expect(seen[0] ?? []).toEqual([])
})

test('an edit marks unsaved progress; editing the hand-off itself clears it', async ($, on) => {
  const h = host(on, { files: { '/proj/handoff.md': LEGACY } })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/app.ts', old_string: 'a', new_string: 'b' } as never)
  expect(h.statuses.at(-1)).toContain('unsaved progress — /pickup-save')
  await $.tool.call({ tool: 'Edit', file_path: '/proj/handoff.md', old_string: 'a', new_string: 'b' } as never)
  expect(h.statuses.at(-1)).not.toContain('unsaved')
})

test('/pickup-save merges into the existing file where it is', async ($, on) => {
  const h = host(on, { files: { '/proj/HANDOFF.md': LEGACY } })
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '# Pickup — proj\n## Steps\n- [x] 1. a\n- [ ] 2. b\n## Next action\nb', usage: USAGE } }
  })
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/x.ts', content: '' } as never)
  const r = await $.command.run(cmd('pickup-save'))
  expect(r.text).toBe('Saved hand-off to HANDOFF.md (1/2). Run /clear to start fresh from it.')
  expect(prompts[0]).toContain('Step 5 CONFIRMED')
  expect(h.files.get('/proj/HANDOFF.md')).toContain('# Pickup — proj')
  expect(h.files.has('/proj/.claude/handoff.md')).toBe(false)
  expect(h.statuses.at(-1)).not.toContain('unsaved')
})

test('/pickup-save in a project without one writes .claude/handoff.md', async ($, on) => {
  const h = host(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '# Pickup — proj', usage: USAGE } }))
  await start($)
  const r = await $.command.run(cmd('pickup-save'))
  expect(r.text).toContain('Saved hand-off to .claude/handoff.md')
  expect(h.files.get('/proj/.claude/handoff.md')).toBe('# Pickup — proj')
})

test('a save with nothing to go on says so and writes nothing', async ($, on) => {
  const h = host(on)
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage: USAGE } }))
  await start($)
  const r = await $.command.run(cmd('pickup-save'))
  expect(r.text).toBe('Hand-off not saved: nothing to save yet')
  expect(h.files.size).toBe(0)
})

test('in a fresh conversation, save tidies the existing hand-off without a fork', async ($, on) => {
  const h = host(on, { files: { '/proj/handoff.md': LEGACY } })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage: USAGE } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '# Pickup — proj\n## Steps\n- [x] 1. five', usage: USAGE } }))
  await start($)
  const r = await $.command.run(cmd('pickup-save'))
  expect(r.text).toContain('Saved hand-off to handoff.md (1/1)')
  expect(h.files.get('/proj/handoff.md')).toContain('# Pickup')
})

test('/pickup-save <path> imports a hand-off from outside the project', async ($, on) => {
  const h = host(on, { files: { '/tmp/other handoff.md': 'Written by another skill' } })
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '# Pickup — proj\n## Steps\n- [ ] 1. a', usage: USAGE } }
  })
  await start($)
  const r = await $.command.run(cmd('pickup-save', '/tmp/other\\ handoff.md'))
  expect(r.text).toBe('Saved hand-off to .claude/handoff.md (0/1), imported from /tmp/other handoff.md. Run /clear to start fresh from it.')
  expect(prompts[0]).toContain('Written by another skill')
  expect(h.files.get('/tmp/other handoff.md')).toBe('Written by another skill')
})

test('an import merges with the hand-off already in the project', async ($, on) => {
  const h = host(on, { files: { '/proj/handoff.md': LEGACY, '/home/me/notes.md': 'Imported notes' } })
  const prompts: string[] = []
  on('model.fork', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '# Pickup — proj', usage: USAGE } }
  })
  await start($)
  await $.command.run(cmd('pickup-save', '~/notes.md'))
  expect(prompts[0]).toContain('Imported notes')
  expect(prompts[0]).toContain('Step 5 CONFIRMED')
  expect(h.files.get('/proj/handoff.md')).toBe('# Pickup — proj')
})

test('an import works in a fresh conversation with no hand-off yet', async ($, on) => {
  const h = host(on, { files: { '/tmp/h.md': 'Notes' } })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage: USAGE } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '# Pickup — proj', usage: USAGE } }))
  await start($)
  const r = await $.command.run(cmd('pickup-save', '/tmp/h.md'))
  expect(r.text).toContain('Saved hand-off to .claude/handoff.md')
  expect(h.files.get('/proj/.claude/handoff.md')).toBe('# Pickup — proj')
})

test('an import that cannot be read writes nothing and names the path', async ($, on) => {
  const h = host(on, { files: { '/tmp/blank.md': '  \n' } })
  await start($)
  expect((await $.command.run(cmd('pickup-save', '/tmp/gone.md'))).text).toBe("Hand-off not saved: can't read /tmp/gone.md")
  expect((await $.command.run(cmd('pickup-save', '/tmp/blank.md'))).text).toBe('Hand-off not saved: /tmp/blank.md is empty')
  expect(h.files.has('/proj/.claude/handoff.md')).toBe(false)
})

test('/pickup still saves for an older session-health, and names what else it was given', async ($, on) => {
  const h = host(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '# Pickup — proj', usage: USAGE } }))
  await start($)
  expect((await $.command.run(cmd('pickup', 'save'))).text).toContain('Saved hand-off')
  expect((await $.command.run(cmd('pickup', 'Save it'))).text).toContain('(got "Save it")')
  expect(h.files.get('/proj/.claude/handoff.md')).toBe('# Pickup — proj')
})

test('/projects lists every project, most recent first, in a pane', async ($, on) => {
  host(on, {
    store: {
      projects: {
        '/a': { name: 'Flattn', root: '/a', path: 'handoff.md', summary: { done: 1, total: 3, next: 'auth' }, savedAt: 99 * DAY, seenAt: 1 },
        '/b': { name: 'VanSync', root: '/b', path: 'HANDOFF.md', summary: { done: 5 }, savedAt: 98 * DAY, seenAt: 2 },
      },
    },
  })
  const r = await $.command.run(cmd('projects'))
  expect(r.text).toBe('VanSync — step 5 done · saved 2d ago\nFlattn — 1/3 · auth · saved 24h ago')
  const ui = await $.ui.mount({
    plugin: 'project-pickup',
    component: 'Pane',
    requestId: 'projects',
    surface: 'desktop',
    props: { title: 'Projects', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /next: auth/ }))?.text).toBe('next: auth')
  await ui.unmount()
})

const GROUPED = '# Pickup — proj\n## Steps\n### Backend\n- [x] 1. Auth\n- [~] 2. Sync\n### Launch\n- [ ] 3. TestFlight\n## Next action\nSync'
const bucketPane = ($: Parameters<TestBody>[0]) =>
  $.ui.mount({
    plugin: 'project-pickup',
    component: 'Pane',
    requestId: 'task-bucket',
    surface: 'desktop',
    props: { title: 'Task bucket', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })

test('/task-bucket shows the hand-off steps in their groups, in a pane', async ($, on) => {
  host(on, { files: { '/proj/.claude/handoff.md': GROUPED } })
  await start($)
  const r = await $.command.run(cmd('task-bucket'))
  expect(r.text).toBe('Task bucket opened.')
  const ui = await bucketPane($)
  expect((await ui.find({ type: 'Text', text: /Backend/ }))?.text).toBe('Backend 1/2')
  expect((await ui.find({ type: 'Text', text: /Launch/ }))?.text).toBe('Launch 0/1')
  expect((await ui.find({ type: 'Text', text: /Sync/ }))?.text).toBe('◐ Sync')
  expect((await ui.find({ type: 'Text', text: /TestFlight/ }))?.text).toBe('○ TestFlight')
  await ui.unmount()
})

test('/task-bucket reads the hand-off afresh, so hand edits show', async ($, on) => {
  const h = host(on, { files: { '/proj/.claude/handoff.md': GROUPED } })
  await start($)
  h.files.set('/proj/.claude/handoff.md', GROUPED.replace('- [ ] 3.', '- [x] 3.'))
  await $.command.run(cmd('task-bucket'))
  const ui = await bucketPane($)
  expect((await ui.find({ type: 'Text', text: /TestFlight/ }))?.text).toBe('✓ TestFlight')
  await ui.unmount()
})

test('/task-bucket closes the pane when it is open, and reopens it with the steps intact', async ($, on) => {
  const h = host(on, { files: { '/proj/.claude/handoff.md': GROUPED } })
  await start($)
  await $.command.run(cmd('task-bucket'))
  expect(h.panes.has('task-bucket')).toBe(true)
  const closed = await $.command.run(cmd('task-bucket'))
  expect(closed.text).toBe('Task bucket closed. /task-bucket opens it again.')
  expect(h.panes.has('task-bucket')).toBe(false)
  const reopened = await $.command.run(cmd('task-bucket'))
  expect(reopened.text).toBe('Task bucket opened.')
  expect(h.panes.has('task-bucket')).toBe(true)
  const ui = await bucketPane($)
  expect((await ui.find({ type: 'Text', text: /Sync/ }))?.text).toBe('◐ Sync')
  await ui.unmount()
})

test('/task-bucket picks up edits made while the pane was closed', async ($, on) => {
  const h = host(on, { files: { '/proj/.claude/handoff.md': GROUPED } })
  await start($)
  await $.command.run(cmd('task-bucket'))
  await $.command.run(cmd('task-bucket'))
  h.files.set('/proj/.claude/handoff.md', GROUPED.replace('- [ ] 3.', '- [x] 3.'))
  await $.command.run(cmd('task-bucket'))
  const ui = await bucketPane($)
  expect((await ui.find({ type: 'Text', text: /TestFlight/ }))?.text).toBe('✓ TestFlight')
  await ui.unmount()
})

test('/task-bucket behind another tab opens rather than closes', async ($, on) => {
  const h = host(on, { files: { '/proj/.claude/handoff.md': GROUPED } })
  await start($)
  await $.command.run(cmd('task-bucket'))
  h.panes.set('task-bucket', false)
  const r = await $.command.run(cmd('task-bucket'))
  expect(r.text).toBe('Task bucket opened.')
  expect(h.panes.has('task-bucket')).toBe(true)
})

test('/task-bucket prints the list when no pane can be drawn', async ($, on) => {
  host(on, { files: { '/proj/.claude/handoff.md': GROUPED }, placed: false })
  await start($)
  const r = await $.command.run(cmd('task-bucket'))
  expect(r.text).toContain('✓ Auth\n◐ Sync')
  expect(r.text).toContain('○ TestFlight')
})

test('/task-bucket says what to do in a project with no checklist', async ($, on) => {
  host(on, { placed: false })
  await start($)
  expect((await $.command.run(cmd('task-bucket'))).text).toBe('No hand-off here yet. /pickup-save writes one.')
  const ui = await bucketPane($)
  expect(await ui.find({ type: 'Text', text: /No hand-off here yet/ })).toBeDefined()
  await ui.unmount()
})

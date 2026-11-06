import { describe, expect, test } from 'claude-code/testing'
import { ago, bucket, groupHeader, importPath, injection, overview, savePrompt, statusLine, summarize, taskGroups } from '../hooks/pickup.ts'

const STANDARD = `# Pickup — VanSync
_Saved 2026-11-02 08:40_
## Goal
Ship v1 to TestFlight.
## Steps
- [x] 1. Auth
- [x] 2. Customer page
- [~] 3. **Messages**
- [ ] 4. TestFlight build
## Next action
- Wire the WhatsApp deep link in \`MessageView.swift\`
## Decisions (and why)
- [ ] not a step: a checklist outside Steps is ignored
`

describe('taskGroups', () => {
  const GROUPED = `## Steps
- [x] 1. Sketch
### Backend
- [x] 2. **Auth**
- [~] 3. Sync
### Empty
### Launch
- [ ] 4. TestFlight
## Next action
- [ ] not a step
`

  test('splits the Steps checklist at its subheadings, dropping empty groups', () =>
    expect(taskGroups(GROUPED)).toEqual([
      { steps: [{ text: 'Sketch', state: 'done' }] },
      {
        name: 'Backend',
        steps: [
          { text: 'Auth', state: 'done' },
          { text: 'Sync', state: 'doing' },
        ],
      },
      { name: 'Launch', steps: [{ text: 'TestFlight', state: 'todo' }] },
    ]))
  test('a flat checklist is one unnamed group', () => {
    const groups = taskGroups(STANDARD)
    expect(groups.length).toBe(1)
    expect(groups[0]!.name).toBeUndefined()
    expect(groups[0]!.steps.length).toBe(4)
  })
  test('groups do not change the summary count', () => expect(summarize(GROUPED).total).toBe(4))
  test('a file with no checklist has no groups', () => expect(taskGroups('# Notes\nhello')).toEqual([]))
})

describe('groupHeader', () => {
  const step = (state: 'done' | 'doing' | 'todo') => ({ text: 's', state })

  test('counts only finished steps', () =>
    expect(groupHeader({ name: 'Backend', steps: [step('done'), step('doing'), step('todo')] })).toBe('Backend 1/3'))
  test('a finished group is ticked', () =>
    expect(groupHeader({ name: 'Backend', steps: [step('done'), step('done')] })).toBe('✓ Backend 2/2'))
  test('an unnamed group is called Tasks', () => expect(groupHeader({ steps: [step('todo')] })).toBe('Tasks 0/1'))
  test('the text list carries the headers', () =>
    expect(bucket([{ name: 'Backend', steps: [{ text: 'Auth', state: 'done' }] }])).toBe('✓ Backend 1/1\n✓ Auth'))
})

describe('summarize', () => {
  test('counts the Steps checklist and finds the step in progress', () => {
    const s = summarize(STANDARD)
    expect(s.done).toBe(2)
    expect(s.total).toBe(4)
    expect(s.current).toBe('Messages')
  })
  test('takes the first line of Next action, bullets and code ticks dropped', () =>
    expect(summarize(STANDARD).next).toBe('Wire the WhatsApp deep link in MessageView.swift'))
  test('falls back to the first unchecked step when none is in progress', () =>
    expect(summarize('## Steps\n- [x] a\n- [ ] b\n- [ ] c').current).toBe('b'))
  test('reads prose progress in older hand-offs', () => {
    const s = summarize('- Step 4 COMPLETE: merged\n- Step 5 CONFIRMED + IMPLEMENTED (branch step-5)\n- Step 6: todo')
    expect(s.done).toBe(5)
    expect(s.total).toBe(undefined)
  })
  test('a file with no steps has no progress', () => expect(summarize('# Notes\nhello')).toEqual({ done: 0 }))
})

describe('statusLine', () => {
  const now = 10 * 86_400_000
  test('shows progress, next action and age', () =>
    expect(statusLine('VanSync', summarize(STANDARD), now - 2 * 86_400_000, now, false)).toBe(
      '◆ VanSync · 2/4 · next: Wire the WhatsApp deep link in MessageView.swift · saved 2d ago',
    ))
  test('asks for a save once files changed', () =>
    expect(statusLine('VanSync', { done: 0 }, now, now, true)).toBe('◆ VanSync · saved just now · unsaved progress — /pickup-save'))
  test('a project with no hand-off says so', () =>
    expect(statusLine('Flattn', undefined, undefined, now, false)).toBe('◆ Flattn · no hand-off yet'))
  test('a long next action is clipped', () =>
    expect(statusLine('x', { done: 0, next: 'a'.repeat(80) }, now, now, false)).toContain(`${'a'.repeat(47)}…`))
})

test('ago reads minutes, hours, then days', () => {
  expect(ago(30_000)).toBe('just now')
  expect(ago(5 * 60_000)).toBe('5m ago')
  expect(ago(30 * 3_600_000)).toBe('30h ago')
  expect(ago(3 * 86_400_000)).toBe('3d ago')
})

test('the save prompt merges into an existing hand-off and fixes the layout', () => {
  const p = savePrompt('VanSync', '2026-11-02 09:00', 'OLD BRIEF')
  expect(p).toContain('<current-handoff>\nOLD BRIEF\n</current-handoff>')
  expect(p).toContain('## Steps')
  expect(p).toContain('# Pickup — VanSync')
  expect(p).toContain('### Part name')
  expect(savePrompt('VanSync', 'now')).not.toContain('current-handoff')
})

test('a long hand-off is cut before it is injected', () => {
  const text = injection('p', 'HANDOFF.md', '2d ago', 'x'.repeat(30_000))
  expect(text.length < 25_000).toBe(true)
  expect(text).toContain('read HANDOFF.md for the rest')
})

test('the overview lists each project on a line', () =>
  expect(
    overview([{ name: 'VanSync', root: '/v', path: 'handoff.md', summary: { done: 2, total: 4, next: 'ship' }, savedAt: 0, seenAt: 0 }], 3_600_000),
  ).toBe('VanSync — 2/4 · ship · saved 1h ago'))

describe('importPath', () => {
  test('keeps an absolute path', () => expect(importPath('/tmp/h.md', '/proj', '/home/me')).toBe('/tmp/h.md'))
  test('puts a relative path under the project', () => expect(importPath('notes/h.md', '/proj', '/home/me')).toBe('/proj/notes/h.md'))
  test('expands home', () => expect(importPath('~/h.md', '/proj', '/home/me')).toBe('/home/me/h.md'))
  test('takes off quotes', () => expect(importPath('"/tmp/my h.md"', '/proj', undefined)).toBe('/tmp/my h.md'))
  test('takes off a dragged path\'s backslashes', () => expect(importPath('/tmp/my\\ h.md', '/proj', undefined)).toBe('/tmp/my h.md'))
})

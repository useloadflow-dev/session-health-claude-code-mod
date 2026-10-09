import { expect, test } from 'claude-code/testing'
import { isInside, locate, parsePending, parseProfile, setMode } from '../hooks/notes.ts'

// Reading vibe-wise's own notes: the profile's mode line and progress.md's pending decision.
const PROFILE = '# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n\n## Project\n'

test('a profile is active unless it says paused', () => {
  expect(parseProfile(PROFILE)).toBe('active')
  expect(parseProfile('# Learner Profile\n\nLearning mode: paused\n')).toBe('paused')
  expect(parseProfile('# Learner Profile\nlearning mode:   PAUSED  \n')).toBe('paused')
  // Older profiles without a mode line count as active, as vibe-wise's own hook reads them.
  expect(parseProfile('# Learner Profile\n\n## Project\n')).toBe('active')
  expect(parseProfile('  \n\n')).toBe('none')
})

test('no pending decision when the section is absent', () => {
  expect(parsePending('# Learning Progress\n\nNo learning events recorded yet.\n')).toBe(undefined)
})

test('reads the pending decision, its name and its stage', () => {
  const progress = [
    '# Learning Progress',
    '',
    '## Pending decision',
    '',
    '- Decision: Folder membership',
    '- Stage: awaiting implementation approval',
    '- Proposed: links table of note_id and folder_id',
    '',
    '## Data modelling',
    '- Introduced: join tables',
  ].join('\n')
  expect(parsePending(progress)).toEqual({ name: 'Folder membership', stage: 'implementation approval' })
})

test('a pending decision with no recognisable name still holds', () => {
  const progress = '## Pending decision\n\nWaiting on the learner to explain their caching idea (awaiting reasoning).\n'
  expect(parsePending(progress)).toEqual({
    name: 'Waiting on the learner to explain their caching idea (awaiting reasoning).',
    stage: 'reasoning',
  })
})

test('an empty pending section holds too', () => {
  expect(parsePending('## Pending decision\n\n## Other\n')).toEqual({ name: 'a decision' })
})

test('setMode rewrites the mode line, or adds one under the title', () => {
  expect(setMode(PROFILE, 'paused')).toContain('Learning mode: paused\nOnboarding: complete')
  expect(setMode('# Learner Profile\n\n## Project\n', 'paused')).toBe('# Learner Profile\n\nLearning mode: paused\n\n## Project\n')
})

test('isInside', () => {
  expect(isInside('/p/.vibe-wise/progress.md', '/p/.vibe-wise')).toBe(true)
  expect(isInside('/p/.vibe-wise', '/p/.vibe-wise')).toBe(true)
  expect(isInside('/p/.vibe-wise-other/x', '/p/.vibe-wise')).toBe(false)
  expect(isInside('/p/src/a.ts', '/p/.vibe-wise')).toBe(false)
})

test('locate walks up to the notes, stopping at the repository boundary', async () => {
  const has = (paths: string[]) => async (p: string) => paths.includes(p)
  expect(await locate('/r/app/src', has(['/r/app/.vibe-wise', '/r/app/.git']))).toEqual({ root: '/r/app', dir: '/r/app/.vibe-wise' })
  expect(await locate('/r/app', has(['/r/app/.sensible-vibes']))).toEqual({ root: '/r/app', dir: '/r/app/.sensible-vibes' })
  // A parent repository's notes are another project's.
  expect(await locate('/r/app', has(['/r/app/.git', '/r/.vibe-wise']))).toEqual({ root: '/r/app' })
  // No repository: the project is where the session started.
  expect(await locate('/r/app', has([]))).toEqual({ root: '/r/app' })
})

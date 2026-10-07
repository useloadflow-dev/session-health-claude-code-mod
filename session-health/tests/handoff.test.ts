import { describe, expect, test } from 'claude-code/testing'
import { MAX_AGE_MS, briefPrompt, handoffPath, injection, shouldLoad, transcriptPrompt } from '../hooks/handoff.ts'

const now = 1_800_000_000_000
const rec = { path: '/p/.claude/handoff.md', writtenAt: now - 60_000, sessionId: 's1', consumed: false }

describe('shouldLoad', () => {
  test('loads a fresh unconsumed brief on the first prompt', () => expect(shouldLoad(rec, now, 0)).toBe(true))
  test('not after the first turn', () => expect(shouldLoad(rec, now, 1)).toBe(false))
  test('not when consumed', () => expect(shouldLoad({ ...rec, consumed: true }, now, 0)).toBe(false))
  test('not when older than 24h', () =>
    expect(shouldLoad({ ...rec, writtenAt: now - MAX_AGE_MS - 1 }, now, 0)).toBe(false))
  test('not when there is none', () => expect(shouldLoad(undefined, now, 0)).toBe(false))
})

describe('text', () => {
  test('path is under .claude', () => expect(handoffPath('/a/b')).toBe('/a/b/.claude/handoff.md'))
  test('prompt names every section', () => {
    const p = briefPrompt('proj', '2026-10-07 14:32')
    for (const h of ['# Hand-off — proj — 2026-10-07 14:32', '## Goal', '## Current state', '## Decisions (and why)',
      '## Files touched', '## Next steps', '## Gotchas']) expect(p).toContain(h)
    expect(p).toContain('600 words')
  })
  test('injection frames the brief', () =>
    expect(injection('BODY')).toBe('Hand-off from the previous session:\n\nBODY'))
  test('transcript fallback keeps the newest messages within budget', () => {
    const msgs = Array.from({ length: 500 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i} ` + 'x'.repeat(500) }))
    const p = transcriptPrompt(msgs)
    expect(p).toContain('m499')
    expect(p.length).toBeLessThan(130_000)
  })
})

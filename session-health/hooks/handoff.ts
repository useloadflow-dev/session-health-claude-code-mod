export const COMPACT_INSTRUCTIONS =
  'Preserve: the current goal and acceptance criteria; open tasks and their status; key decisions and the reasons for them; ' +
  'files created or modified and their purpose; unresolved errors or blockers; exact names of functions, commands and paths in play. ' +
  'Drop: exploratory dead ends, verbose tool output, superseded plans.'

export type HandoffRecord = { path: string; writtenAt: number; sessionId: string; consumed: boolean }

export const MAX_AGE_MS = 24 * 60 * 60 * 1000
const TRANSCRIPT_BUDGET = 120_000

export const handoffPath = (root: string) => `${root}/.claude/handoff.md`
export const storeKey = (root: string) => `handoff:${root}`

export function briefPrompt(project: string, stamp: string): string {
  return [
    'Write a hand-off brief so a brand-new Claude Code session can continue this work without re-reading the codebase.',
    'Use only what this conversation established. Be concrete: exact file paths, function names, commands, error messages.',
    'Output Markdown only, under 600 words, with exactly these headings in this order:',
    '',
    `# Hand-off — ${project} — ${stamp}`,
    '## Goal',
    '## Current state',
    '## Decisions (and why)',
    '## Files touched',
    '## Next steps',
    '## Gotchas',
  ].join('\n')
}

export function transcriptPrompt(messages: readonly { role: string; text: string }[]): string {
  const lines: string[] = []
  let size = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `${messages[i]!.role.toUpperCase()}: ${messages[i]!.text}`
    if (size + line.length > TRANSCRIPT_BUDGET) break
    lines.unshift(line)
    size += line.length
  }
  return `<transcript>\n${lines.join('\n\n')}\n</transcript>\n\n`
}

export function shouldLoad(rec: HandoffRecord | undefined, now: number, turnsSoFar: number): boolean {
  return rec !== undefined && !rec.consumed && turnsSoFar === 0 && now - rec.writtenAt <= MAX_AGE_MS
}

export const injection = (brief: string) => `Hand-off from the previous session:\n\n${brief}`

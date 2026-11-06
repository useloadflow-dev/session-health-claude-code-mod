// Where a hand-off may live, searched in this order; names match case-insensitively.
export const SEARCH_DIRS = ['.claude', '', 'docs'] as const
export const FILE_NAME = 'handoff.md'
export const DEFAULT_PATH = '.claude/handoff.md'

// What one new conversation is handed; a longer file is cut with a note.
const INJECT_BUDGET = 24_000
const TRANSCRIPT_BUDGET = 120_000

import type { Group, Step, Summary } from '../types'

type Entry = {
  name: string
  root: string
  path: string
  summary: Summary
  savedAt: number
  seenAt: number
}

export type Registry = Record<string, Entry>
export const REGISTRY_KEY = 'projects'

export const projectName = (root: string) => root.split('/').filter(Boolean).pop() ?? root

export const isRegistry = (v: unknown): v is Registry => typeof v === 'object' && v !== null && !Array.isArray(v)

const CHECK = /^\s*[-*]\s+\[( |x|X|~|>)\]\s+(?:\d+[.)]\s*)?(.*\S)\s*$/
const LEGACY = /\bstep\s+(\d+)\b[^\n]*?\b(complete|completed|confirmed|implemented|done|merged|shipped)\b/gi

// The `## heading` section's lines, up to the next heading of that level or above.
function section(md: string, heading: RegExp): string[] | undefined {
  const lines = md.split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && heading.test(l))
  if (start < 0) return undefined
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break
    out.push(l)
  }
  return out
}

const plain = (s: string) => s.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').trim()

// The lines that hold the plan: its section, or the whole file when it has none.
const planLines = (md: string) => section(md, /steps|roadmap|plan|progress/i) ?? md.split('\n')

const stateOf = (mark: string): Step['state'] => (mark === 'x' || mark === 'X' ? 'done' : mark === ' ' ? 'todo' : 'doing')

// The plan's checklist, split at its `### name` subheadings; a group with no steps is dropped.
export function taskGroups(md: string): Group[] {
  const groups: Group[] = []
  let open: Group | undefined
  for (const line of planLines(md)) {
    const head = /^#{3,}\s+(.*\S)\s*$/.exec(line)
    if (head) {
      open = { name: plain(head[1]!), steps: [] }
      groups.push(open)
      continue
    }
    const m = CHECK.exec(line)
    if (!m) continue
    if (!open) {
      open = { steps: [] }
      groups.push(open)
    }
    open.steps.push({ text: plain(m[2]!), state: stateOf(m[1]!) })
  }
  return groups.filter(g => g.steps.length > 0)
}

export const STEP_MARK: Record<Step['state'], string> = { done: '✓', doing: '◐', todo: '○' }

// The line above a group's steps: its name and count, the same count the status line
// keeps (only finished steps), ticked once the group is done so the eye can skip it.
export function groupHeader(group: Group): string {
  const done = group.steps.filter(s => s.state === 'done').length
  const total = group.steps.length
  return `${done === total ? '✓ ' : ''}${group.name ?? 'Tasks'} ${done}/${total}`
}

// The groups as plain text, for when no pane can be drawn.
export const bucket = (groups: readonly Group[]) =>
  groups.map(g => [groupHeader(g), ...g.steps.map(s => `${STEP_MARK[s.state]} ${s.text}`)].join('\n')).join('\n\n')

export const noTasks = (rel: string | undefined) =>
  rel ? `${rel} has no Steps checklist yet. /pickup-save adds one.` : 'No hand-off here yet. /pickup-save writes one.'

export function summarize(md: string): Summary {
  const items = planLines(md).map(l => CHECK.exec(l)).filter((m): m is RegExpExecArray => m !== null)
  const out: Summary = { done: 0 }
  if (items.length > 0) {
    out.total = items.length
    out.done = items.filter(m => m[1] === 'x' || m[1] === 'X').length
    const now = items.find(m => m[1] === '~' || m[1] === '>') ?? items.find(m => m[1] === ' ')
    if (now) out.current = plain(now[2]!)
  } else {
    // Older hand-offs track progress as prose: "Step 5 CONFIRMED + IMPLEMENTED".
    for (const m of md.matchAll(LEGACY)) out.done = Math.max(out.done, Number(m[1]))
  }
  const next = section(md, /next/i)?.map(plain).find(l => l.length > 0)
  if (next) out.next = next
  return out
}

export function ago(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

const clip = (s: string, n: number) => ([...s].length <= n ? s : [...s].slice(0, n - 1).join('') + '…')

export function progress(s: Summary): string | undefined {
  if (s.total !== undefined) return `${s.done}/${s.total}`
  return s.done > 0 ? `step ${s.done} done` : undefined
}

export function statusLine(name: string, s: Summary | undefined, savedAt: number | undefined, now: number, dirty: boolean): string {
  if (s === undefined || savedAt === undefined) {
    return dirty ? `◆ ${name} · no hand-off yet — /pickup-save` : `◆ ${name} · no hand-off yet`
  }
  const parts = [`◆ ${name}`]
  const p = progress(s)
  if (p) parts.push(p)
  const next = s.next ?? s.current
  if (next) parts.push(`next: ${clip(next, 48)}`)
  parts.push(`saved ${ago(now - savedAt)}`)
  if (dirty) parts.push('unsaved progress — /pickup-save')
  return parts.join(' · ')
}

export function injection(name: string, relPath: string, savedAgo: string, text: string): string {
  const body = text.length > INJECT_BUDGET ? `${text.slice(0, INJECT_BUDGET)}\n\n[… cut; read ${relPath} for the rest]` : text
  return [
    `Project hand-off for ${name}, from ${relPath} (saved ${savedAgo}).`,
    'It is where this project stood at the end of the last session: start from it, and check what it says against the code before relying on it.',
    '',
    body,
  ].join('\n')
}

export type Imported = { path: string; text: string }

// The file /pickup-save was pointed at, as an absolute path. Quotes and the backslashes
// of a dragged-in path come off, `~/` is home, and anything else sits under the project.
export function importPath(arg: string, root: string, home: string | undefined): string {
  const path = arg.replace(/^(['"])(.*)\1$/, '$2').replace(/\\(.)/g, '$1')
  if (home && path.startsWith('~/')) return `${home}${path.slice(1)}`
  return path.startsWith('/') ? path : `${root}/${path}`
}

// How an imported hand-off ranks against this conversation and the current hand-off.
const IMPORT_RULE = [
  'Carry everything still true in it into the hand-off you write.',
  'Where it disagrees with this conversation or the current hand-off, keep whichever is more recent.',
]

export function savePrompt(name: string, stamp: string, existing?: string, imported?: Imported): string {
  const lines = [
    `Write the project hand-off for ${name}, so a brand-new Claude Code session days from now can pick the work up without re-reading the codebase.`,
    'Use what this conversation established. Be concrete: exact file paths, function names, commands, branch names, error messages.',
  ]
  if (imported !== undefined) {
    lines.push(
      '',
      `A hand-off was written elsewhere, at ${imported.path}, and is below.`,
      ...IMPORT_RULE,
      '',
      '<imported-handoff>',
      imported.text,
      '</imported-handoff>',
    )
  }
  if (existing !== undefined) {
    lines.push(
      'The current hand-off is below. Merge into it rather than starting over: keep what is still true, update each step\'s status,',
      'move finished work to done, keep decisions and their reasons, and drop anything this conversation proved stale.',
      'If it uses another layout, carry its content over into the layout below.',
      '',
      '<current-handoff>',
      existing,
      '</current-handoff>',
    )
  }
  lines.push(
    '',
    'Output Markdown only, under 900 words, with exactly these headings in this order:',
    '',
    `# Pickup — ${name}`,
    `_Saved ${stamp}_`,
    '## Goal',
    '## Steps',
    'A numbered checklist of the whole plan: `- [x] 1. …` done, `- [~] 2. …` in progress, `- [ ] 3. …` not started.',
    'When the plan has distinct parts, group its steps under `### Part name` subheadings, numbering straight on across them. Keep the names and order of groups already there.',
    '## Next action',
    'One line: the very next concrete thing to do.',
    '## Decisions (and why)',
    '## Open questions',
    '## Files and commands',
    '## Gotchas',
  )
  return lines.join('\n')
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
  return lines.length === 0 ? '' : `<transcript>\n${lines.join('\n\n')}\n</transcript>\n\n`
}

export function overview(entries: readonly Entry[], now: number): string {
  if (entries.length === 0) return 'No projects yet: open a session in a project folder and they show up here.'
  return entries
    .map(e => {
      const bits = [progress(e.summary), e.summary.next ?? e.summary.current, `saved ${ago(now - e.savedAt)}`]
      return `${e.name} — ${bits.filter(Boolean).join(' · ')}`
    })
    .join('\n')
}

export const byRecent = (r: Registry) => Object.values(r).sort((a, b) => b.seenAt - a.seenAt)

import type { EngineInterface, Register } from 'claude-code'
import { absolute, isInside, locate, parsePending, parseProfile, setMode, type Located, type Mode, type Pending } from './notes.ts'

type $ = EngineInterface
type Look = Located & { mode: Mode; pending?: Pending }

const LEARN = 'vibe-wise:learn'
const START = 'Start learning'
const NEVER = 'Not in this project'
const LATER = 'Ask me later'

// Asked at most once a session; "Ask me later" waits for the next one.
let asked = false

async function readOr($: $, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

// What vibe-wise's notes say right now: read fresh each time, since vibe-wise edits them mid-turn.
async function look($: $): Promise<Look> {
  const loc = await locate(await $.session.root(), p => $.fs.exists(p))
  if (!loc.dir) return { ...loc, mode: 'none' }
  const mode = parseProfile((await readOr($, `${loc.dir}/profile.md`)) ?? '')
  if (mode !== 'active') return { ...loc, mode }
  const pending = parsePending((await readOr($, `${loc.dir}/progress.md`)) ?? '')
  return pending ? { ...loc, mode, pending } : { ...loc, mode }
}

function describe(s: Look): string | undefined {
  if (s.mode === 'paused') return '✦ VibeWise · paused · /learning resume'
  if (s.mode !== 'active') return undefined
  if (!s.pending) return '✦ VibeWise · learning on'
  const stage = s.pending.stage ? ` (${s.pending.stage})` : ''
  return `✦ VibeWise · waiting on you: ${s.pending.name}${stage}`
}

async function refresh($: $): Promise<Look> {
  const s = await look($)
  $.ui.status(describe(s))
  return s
}

const project = (root: string) => root.split('/').filter(Boolean).pop() ?? root
const neverKey = (root: string) => `never:${root}`

function held(s: Look & { pending: Pending }): string {
  const stage = s.pending.stage ? ` (${s.pending.stage})` : ''
  return (
    `vibe-guard: the VibeWise checkpoint "${s.pending.name}" is still waiting on the learner${stage}. ` +
    `Don't change project files yet. Present the checkpoint, ask the learner, and wait for their reply. ` +
    `Only after they approve, clear the "## Pending decision" section in ${s.dir}/progress.md as the VibeWise guide says; ` +
    `edits are allowed again once it is gone. Never clear it without the learner's answer.`
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    asked = false
    await $.command.register({
      name: 'learning',
      description: 'VibeWise status, or /learning pause | resume',
      argumentHint: '[pause|resume]',
      immediate: true,
    })
    try {
      await refresh($)
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      await refresh($)
    } catch {}
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isUsers = e.origin === undefined || e.origin.kind === 'composer'
    if (asked || !isUsers || e.text.trimStart().startsWith('/') || e.attachments?.length) return next(e)
    if (!(await $.command.list()).some(c => c.name === LEARN)) return next(e)
    const s = await look($)
    if (s.mode !== 'none' || (await $.store.get(neverKey(s.root)))) return next(e)

    asked = true
    let answer: string
    try {
      answer = await $.ui.ask(`Start vibe-wise learning in ${project(s.root)}?`, {
        options: [START, NEVER, LATER],
        header: 'VibeWise',
      })
    } catch {
      return next(e)
    }
    if (answer === NEVER) await $.store.set(neverKey(s.root), true)
    if (answer !== START) return next(e)
    // A prompt.submit hook may not run a command (it would wait on the turn it holds): start it just after.
    const text = e.text
    $.clock.after(1, () => {
      void $.command.run({ command: LEARN, args: text }).catch((err: unknown) =>
        $.ui.toast(`VibeWise didn't start: ${err instanceof Error ? err.message : String(err)}`),
      )
    })
    return { drop: 'Starting VibeWise learning; your prompt goes with it.' }
  }).catch(($, e, next) => next(e))

  for (const tool of ['Edit', 'Write', 'NotebookEdit'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const raw = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      const path = absolute(raw, await $.session.cwd())
      const s = await look($)
      const ownNotes = s.dir !== undefined && isInside(path, s.dir)
      if (s.mode === 'active' && s.pending && !ownNotes) return { deny: held({ ...s, pending: s.pending }) }
      const r = await next(e)
      if (ownNotes) await refresh($)
      return r
    }).catch(($, e, next) => next(e))
  }

  on('command.run', { command: 'learning' }, async ($, e) => {
    const s = await look($)
    if (!s.dir || s.mode === 'none') {
      return { text: `No VibeWise notes in ${project(s.root)}. Run /${LEARN} to start learning here.` }
    }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pause' || arg === 'resume') {
      const path = `${s.dir}/profile.md`
      await $.fs.write(path, setMode((await readOr($, path)) ?? '', arg === 'pause' ? 'paused' : 'active'))
      await refresh($)
      return {
        text: arg === 'pause'
          ? 'VibeWise paused: edits are no longer held. /learning resume turns it back on.'
          : 'VibeWise learning resumed.',
      }
    }
    return { text: describe(await refresh($)) ?? '' }
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Here } from '../types'
import {
  DEFAULT_PATH,
  FILE_NAME,
  REGISTRY_KEY,
  SEARCH_DIRS,
  STEP_MARK,
  ago,
  bucket,
  byRecent,
  groupHeader,
  injection,
  isRegistry,
  noTasks,
  overview,
  progress,
  projectName,
  savePrompt,
  statusLine,
  summarize,
  taskGroups,
  transcriptPrompt,
  type Registry,
} from './pickup.ts'

type $ = EngineInterface

const PANE = 'projects'
const BUCKET_PANE = 'task-bucket'
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const here = atom({ plugin: 'project-pickup', key: 'here' } as const, null as Here | null, { shape: 'here-2' })
const dirty = atom({ plugin: 'project-pickup', key: 'dirty' } as const, false)
const briefed = atom({ plugin: 'project-pickup', key: 'briefed' } as const, '')

// One save at a time; a second /pickup save while one runs says so.
let saving = false

// The hand-off's path relative to root, whatever case its name is spelled in.
async function discover($: $, root: string): Promise<string | undefined> {
  for (const dir of SEARCH_DIRS) {
    const entries = await $.fs.list(dir ? `${root}/${dir}` : root).catch(() => [])
    const hit = entries.find(f => f.kind === 'file' && f.name.toLowerCase() === FILE_NAME)
    if (hit) return dir ? `${dir}/${hit.name}` : hit.name
  }
  return undefined
}

async function registry($: $): Promise<Registry> {
  const v = await $.store.get(REGISTRY_KEY).catch(() => undefined)
  return isRegistry(v) ? v : {}
}

// Reads the project's hand-off afresh, and files it in the cross-project registry.
async function refresh($: $): Promise<Here> {
  const root = await $.session.root()
  const rel = await discover($, root)
  const now = await $.clock.now()
  let h: Here = { root }
  if (rel) {
    const text = await $.fs.read(`${root}/${rel}`)
    const stat = await $.fs.stat(`${root}/${rel}`)
    h = { root, rel, summary: summarize(text), groups: taskGroups(text), savedAt: stat.mtimeMs || now }
    const all = await registry($)
    all[root] = { name: projectName(root), root, path: rel, summary: h.summary!, savedAt: h.savedAt!, seenAt: now }
    await $.store.set(REGISTRY_KEY, all).catch(() => {})
  }
  await update($, here, () => h)
  await paint($)
  return h
}

async function paint($: $) {
  const h = await read($, here)
  if (!h) return
  $.ui.status(statusLine(projectName(h.root), h.summary, h.savedAt, await $.clock.now(), await read($, dirty)))
}

async function save($: $): Promise<string> {
  if (saving) return 'A hand-off is already being saved.'
  saving = true
  try {
    const root = await $.session.root()
    const name = projectName(root)
    const found = await discover($, root)
    const rel = found ?? DEFAULT_PATH
    const existing = found ? await $.fs.read(`${root}/${found}`) : undefined
    const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace('T', ' ')
    const prompt = savePrompt(name, stamp, existing)

    let r = await $.model.fork({ prompt })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      // A fresh conversation: tidy the hand-off that is there into the standard layout.
      const transcript = transcriptPrompt(await $.session.messages())
      if (transcript === '' && existing === undefined) throw new Error('nothing to save yet')
      r = await $.model.complete({ model: await $.session.model(), prompt: transcript + prompt })
    }
    if (!r.isAnswered) throw new Error(r.reason)

    await $.fs.write(`${root}/${rel}`, r.text)
    await update($, dirty, () => false)
    const h = await refresh($)
    const p = h.summary ? progress(h.summary) : undefined
    // session-health's [fresh start] reads the leading "Saved".
    return `Saved hand-off to ${rel}${p ? ` (${p})` : ''}. Run /clear to start fresh from it.`
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    $.ui.toast(`Hand-off not saved: ${why}`)
    return `Hand-off not saved: ${why}`
  } finally {
    saving = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pickup', description: 'Where this project stands; /pickup save writes the hand-off', argumentHint: '[save]' })
    await $.command.register({ name: 'projects', description: 'Show where each of your projects stands' })
    await $.command.register({ name: 'task-bucket', description: "Show this project's hand-off steps, in groups, in a pane" })
    saving = false
    await refresh($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'pickup' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'save') return { text: await save($) }
    if (arg !== '') return { text: 'Usage: /pickup to see where this project stands, /pickup save to write the hand-off.' }
    const h = await refresh($)
    const line = statusLine(projectName(h.root), h.summary, h.savedAt, await $.clock.now(), await read($, dirty))
    return { text: h.rel ? `${line}\n${h.rel}` : `${line}\n/pickup save writes one to ${DEFAULT_PATH}.` }
  })

  on('command.run', { command: 'projects' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Projects' })
    return { text: overview(byRecent(await registry($)), await $.clock.now()) }
  })

  on('command.run', { command: 'task-bucket' }, async $ => {
    const h = await refresh($)
    const opened = await $.ui.open({ id: BUCKET_PANE, title: 'Task bucket' })
    if (opened.isPlaced) return { text: 'Task bucket opened.' }
    // No surface can draw the pane: the list still reaches the person.
    return { text: h.groups?.length ? bucket(h.groups) : noTasks(h.rel) }
  })

  // The first prompt of each conversation carries the hand-off: a new session, or one after /clear.
  on('prompt.submit', async ($, e, next) => {
    const id = await $.session.id()
    if ((await $.session.turns()) > 0 || (await read($, briefed)) === id) return next(e)
    await update($, briefed, () => id)
    const h = await refresh($)
    if (!h.rel || h.savedAt === undefined) return next(e)
    const text = await $.fs.read(`${h.root}/${h.rel}`)
    const brief = injection(projectName(h.root), h.rel, ago((await $.clock.now()) - h.savedAt), text)
    return next({ ...e, context: [...(e.context ?? []), brief] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!EDIT_TOOLS.has(e.tool)) return r
    const args = e as { file_path?: string; notebook_path?: string }
    const path = args.file_path ?? args.notebook_path ?? ''
    const h = await read($, here)
    if (h?.rel && path === `${h.root}/${h.rel}`) {
      // Claude edited the hand-off itself: that counts as saving it.
      await update($, dirty, () => false)
      await refresh($)
    } else {
      await update($, dirty, () => true)
      await paint($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // The conversation that made the changes is gone; nothing is left to save from.
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, dirty, () => false)
      await paint($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: BUCKET_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // Not named `h`: JSX compiles to calls of the global `h`.
    const project = await read($, here)
    const groups = project?.groups ?? []
    if (groups.length === 0) return <Text dimColor>{noTasks(project?.rel)}</Text>
    return (
      <Box flexDirection="column">
        {groups.map(g => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{groupHeader(g)}</Text>
            {g.steps.map(s => (
              <Text dimColor={s.state === 'done'} bold={s.state === 'doing'}>
                {STEP_MARK[s.state]} {s.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = byRecent(await registry($))
    const now = await $.clock.now()
    const mine = (await read($, here))?.root
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No projects with a hand-off yet. /pickup save writes one.</Text>}
        {list.map(p => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>
              {p.root === mine ? '◆ ' : ''}
              {p.name}
              {progress(p.summary) ? `  ${progress(p.summary)}` : ''}
            </Text>
            {(p.summary.next ?? p.summary.current) && <Text>next: {p.summary.next ?? p.summary.current}</Text>}
            <Text dimColor>
              saved {ago(now - p.savedAt)} · {p.path}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}

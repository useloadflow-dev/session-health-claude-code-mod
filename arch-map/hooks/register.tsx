import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ArchEdge,
  ArchNode,
  ArchRisk,
  Diagram,
  Explanation,
  NodeKind,
  ProjectRecord,
  RiskSeverity,
} from '../types'

const PANE = 'arch-map'
const TITLE = 'Architecture'
const TOOL = 'update_architecture'
const FULL_TOOL = `mcp__arch-map__${TOOL}`
/** Versions kept per project; older ones drop off the front. */
const MAX_HISTORY = 25

const legacy = atom({ plugin: 'arch-map', key: 'diagram' } as const, null, {
  shape: 'diagram-1',
})
const history = atom({ plugin: 'arch-map', key: 'history' } as const, [], {
  shape: 'history-1',
})
const viewing = atom({ plugin: 'arch-map', key: 'viewing' } as const, null, {
  shape: 'viewing-1',
})
const enabled = atom({ plugin: 'arch-map', key: 'enabled' } as const, true, {
  shape: 'enabled-1',
})
// True once the person closes the pane: updates then stop reopening it.
const dismissed = atom({ plugin: 'arch-map', key: 'dismissed' } as const, false, {
  shape: 'dismissed-1',
})

const selected = atom({ plugin: 'arch-map', key: 'selected' } as const, null, {
  shape: 'selected-1',
})
const explanations = atom(
  { plugin: 'arch-map', key: 'explanations' } as const,
  {} as Record<string, Explanation>,
  { shape: 'explanations-1' },
)
/** The model a click asks; one call per part per version, then cached. */
const EXPLAIN_MODEL = 'sonnet'

const KINDS: readonly NodeKind[] = [
  'user',
  'client',
  'server',
  'service',
  'worker',
  'database',
  'cache',
  'queue',
  'storage',
  'external',
]

const STYLE: Record<NodeKind, { tag: string; color: string }> = {
  user: { tag: 'person', color: 'suggestion' },
  client: { tag: 'client', color: 'ide' },
  server: { tag: 'server', color: 'claude' },
  service: { tag: 'service', color: 'claude' },
  worker: { tag: 'worker', color: 'planMode' },
  database: { tag: 'database', color: 'success' },
  cache: { tag: 'cache', color: 'warning' },
  queue: { tag: 'queue', color: 'merged' },
  storage: { tag: 'storage', color: 'success' },
  external: { tag: 'external', color: 'subtle' },
}

const ADDED = 'success'
const CHANGED = 'warning'
const REMOVED = 'error'

const SEVERITIES: readonly RiskSeverity[] = ['low', 'medium', 'high']
const RISK_COLOR: Record<RiskSeverity, string> = { high: 'error', medium: 'warning', low: 'subtle' }
/** Risks kept per version. */
const MAX_RISKS = 8

const GUIDE = `# Architecture map (arch-map mod)
The person is teaching themselves system design. A side pane shows a diagram of what is being built in this project, fed only by the ${FULL_TOOL} tool. Past versions are kept, and the pane highlights what each version added, changed or removed.
- When the work involves building or changing a system (an app, service, script with moving parts, pipeline, integration), call ${FULL_TOOL} once the shape is known, and again whenever a component or connection is added, removed or changes role. Skip it for trivial edits, pure Q&A, or when nothing architectural changed.
- Each call replaces the whole diagram: send every node and edge, not just the change. Keep node ids stable across versions so changes are highlighted correctly.
- Keep it to 3-10 nodes at the level a whiteboard sketch would use (components, not files or functions). Use plain names ("Web app", "API server", "Postgres").
- Edge labels say what travels or happens ("HTTP POST /orders", "SQL insert", "enqueue job").
- why: one sentence naming what changed since the last version and the problem it solves ("Added Redis because product pages hit Postgres on every request"). Leave it out on a first diagram.
- flow: 3-7 steps tracing one real request or job end to end.
- lesson: one design concept the latest change illustrates (e.g. "Separation of concerns", "Caching", "Async work via a queue", "Stateless servers"), explained in 2-3 plain sentences tied to this project.
- risks: security risks the design itself shows, each pinned to a node id, an edge as "from->to", or no target for the whole system. Only flag what this diagram actually implies (an unauthenticated public endpoint, secrets shipped to a client, user input reaching SQL or a shell, sensitive data sent to an external service, a database reachable from outside, a missing trust boundary), with a one-line fix. Skip generic advice; leave risks out when there are none. Carry a risk forward until a change fixes it, and drop it in the version that does (say so in why).
- Mention the update in one short line at most; don't repeat the diagram in chat.`

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What is being built, a few words.' },
    summary: {
      type: 'string',
      description: 'One sentence: what the system does and how, at a glance.',
    },
    why: {
      type: 'string',
      description:
        'What changed since the previous version and the reason, one sentence. Omit on the first diagram.',
    },
    nodes: {
      type: 'array',
      description: '3-10 components. Keep ids stable across versions.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short unique id, e.g. "api".' },
          label: { type: 'string', description: 'Display name, e.g. "API server".' },
          kind: { type: 'string', enum: KINDS },
          note: { type: 'string', description: 'Optional: its job in a few words.' },
        },
        required: ['id', 'label', 'kind'],
      },
    },
    edges: {
      type: 'array',
      description: 'Directed connections: who calls or sends to whom.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: 'string', description: 'What travels, e.g. "HTTP GET /items".' },
        },
        required: ['from', 'to'],
      },
    },
    flow: {
      type: 'array',
      items: { type: 'string' },
      description: 'One request or job traced end to end, 3-7 steps.',
    },
    lesson: {
      type: 'object',
      properties: {
        concept: { type: 'string' },
        explanation: { type: 'string', description: '2-3 plain sentences.' },
      },
      required: ['concept', 'explanation'],
    },
    risks: {
      type: 'array',
      description: `Design-level security risks this diagram shows, at most ${MAX_RISKS}. Omit when there are none.`,
      items: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'A node id, or an edge as "from->to". Omit for a system-wide risk.',
          },
          severity: { type: 'string', enum: SEVERITIES },
          issue: { type: 'string', description: 'What could go wrong, one sentence.' },
          fix: { type: 'string', description: 'The usual fix, one short sentence.' },
        },
        required: ['severity', 'issue'],
      },
    },
  },
  required: ['title', 'nodes', 'edges'],
}

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined

/** Turns the model's arguments into a Diagram, or the reason it can't. */
export function parseDiagram(
  input: Record<string, unknown>,
  version: number,
): Diagram | string {
  const title = str(input.title, 80)
  if (!title) return 'title is required.'
  if (!Array.isArray(input.nodes) || input.nodes.length === 0)
    return 'nodes must be a non-empty array.'

  const nodes: ArchNode[] = []
  for (const raw of input.nodes.slice(0, 16)) {
    const n = (raw ?? {}) as Record<string, unknown>
    const id = str(n.id, 40)
    const label = str(n.label, 40)
    if (!id || !label) return 'every node needs an id and a label.'
    if (nodes.some(m => m.id === id)) return `node id "${id}" is used twice.`
    const kind = KINDS.includes(n.kind as NodeKind) ? (n.kind as NodeKind) : 'service'
    nodes.push({ id, label, kind, note: str(n.note, 80) })
  }

  const ids = new Set(nodes.map(n => n.id))
  const edges: ArchEdge[] = []
  for (const raw of Array.isArray(input.edges) ? input.edges.slice(0, 40) : []) {
    const e = (raw ?? {}) as Record<string, unknown>
    const from = str(e.from, 40)
    const to = str(e.to, 40)
    if (!from || !to || !ids.has(from) || !ids.has(to))
      return `edge ${String(e.from)} -> ${String(e.to)} names a node that isn't in nodes.`
    edges.push({ from, to, label: str(e.label, 60) })
  }

  const flow = Array.isArray(input.flow)
    ? input.flow.map(s => str(s, 160)).filter((s): s is string => !!s).slice(0, 10)
    : undefined
  const l = (input.lesson ?? {}) as Record<string, unknown>
  const concept = str(l.concept, 60)
  const explanation = str(l.explanation, 500)

  const edgeKeys = new Set(edges.map(edgeKey))
  const risks: ArchRisk[] = []
  for (const raw of Array.isArray(input.risks) ? input.risks.slice(0, MAX_RISKS) : []) {
    const r = (raw ?? {}) as Record<string, unknown>
    const issue = str(r.issue, 200)
    if (!issue) continue
    // "web -> api" and "web->api" name the same edge.
    const target = str(r.target, 90)?.replace(/\s*->\s*/, '->')
    if (target && !ids.has(target) && !edgeKeys.has(target))
      return `risk target "${target}" is neither a node id nor an edge "from->to" in this diagram.`
    const severity = SEVERITIES.includes(r.severity as RiskSeverity)
      ? (r.severity as RiskSeverity)
      : 'medium'
    risks.push({ target, severity, issue, fix: str(r.fix, 160) })
  }

  return {
    title,
    summary: str(input.summary, 240),
    why: str(input.why, 240),
    nodes,
    edges,
    flow: flow && flow.length > 0 ? flow : undefined,
    lesson: concept && explanation ? { concept, explanation } : undefined,
    risks: risks.length > 0 ? risks : undefined,
    version,
  }
}

/**
 * Puts each node on a layer: the longest path from a node nothing points to.
 * Edges that would close a cycle are ignored for layering.
 */
export function layer(d: Pick<Diagram, 'nodes' | 'edges'>): ArchNode[][] {
  const depth = new Map<string, number>(d.nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let changed = false
    for (const e of d.edges) {
      if (e.from === e.to) continue
      const next = (depth.get(e.from) ?? 0) + 1
      if (next > (depth.get(e.to) ?? 0) && next < d.nodes.length) {
        depth.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }
  const layers: ArchNode[][] = []
  for (const n of d.nodes) {
    const i = depth.get(n.id) ?? 0
    ;(layers[i] ??= []).push(n)
  }
  return layers.filter(l => l && l.length > 0)
}

type Mark = 'added' | 'changed' | undefined
export type Diff = {
  nodes: Map<string, Mark>
  edges: Map<string, Mark>
  removedNodes: ArchNode[]
  removedEdges: ArchEdge[]
}

const edgeKey = (e: ArchEdge) => `${e.from}->${e.to}`

/** What `cur` added, changed and removed against `prev`; no prev, no marks. */
export function diff(prev: Diagram | undefined, cur: Diagram): Diff {
  const out: Diff = { nodes: new Map(), edges: new Map(), removedNodes: [], removedEdges: [] }
  if (!prev) return out

  const before = new Map(prev.nodes.map(n => [n.id, n]))
  for (const n of cur.nodes) {
    const p = before.get(n.id)
    if (!p) out.nodes.set(n.id, 'added')
    else if (p.label !== n.label || p.kind !== n.kind || p.note !== n.note)
      out.nodes.set(n.id, 'changed')
  }
  const now = new Set(cur.nodes.map(n => n.id))
  out.removedNodes = prev.nodes.filter(n => !now.has(n.id))

  const beforeEdges = new Map(prev.edges.map(e => [edgeKey(e), e]))
  for (const e of cur.edges) {
    const p = beforeEdges.get(edgeKey(e))
    if (!p) out.edges.set(edgeKey(e), 'added')
    else if (p.label !== e.label) out.edges.set(edgeKey(e), 'changed')
  }
  const nowEdges = new Set(cur.edges.map(edgeKey))
  out.removedEdges = prev.edges.filter(e => !nowEdges.has(edgeKey(e)))
  return out
}

export function explainPrompt(d: Diagram, n: ArchNode): string {
  const links = d.edges
    .filter(e => e.from === n.id || e.to === n.id)
    .map(e => `${e.from} -> ${e.to}${e.label ? ` (${e.label})` : ''}`)
  return `You are tutoring someone who is teaching themselves system design. They clicked one component of the architecture diagram below and want to understand it.

System: ${d.title}${d.summary ? ` - ${d.summary}` : ''}
Components: ${d.nodes.map(x => `${x.id} = ${x.label} [${x.kind}]${x.note ? ` (${x.note})` : ''}`).join('; ')}
Connections: ${d.edges.map(e => `${e.from} -> ${e.to}${e.label ? ` (${e.label})` : ''}`).join('; ')}

Clicked: ${n.label} [${n.kind}]${n.note ? ` - ${n.note}` : ''}
Its connections: ${links.join('; ') || 'none'}

Answer in plain text, no markdown, under 110 words, as exactly three short paragraphs starting with these labels:
Why it's here: what job it does in THIS system and what would go wrong without it.
Alternatives: one or two other ways to fill this role, and the trade-off.
Under load: what breaks or slows first as traffic grows, and the usual fix.`
}

const projectKey = async ($: EngineInterface) => `project:${await $.session.root()}`

async function loadProject($: EngineInterface): Promise<ProjectRecord> {
  const raw = (await $.store.get(await projectKey($))) as Partial<ProjectRecord> | undefined
  return {
    enabled: raw?.enabled !== false,
    history: Array.isArray(raw?.history) ? raw.history : [],
  }
}

async function saveProject($: EngineInterface, patch: Partial<ProjectRecord>) {
  const cur = await loadProject($)
  await $.store.set(await projectKey($), { ...cur, ...patch })
}

const isPaneOpen = async ($: EngineInterface) =>
  (await $.ui.panes()).some(p => p.id === PANE)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'arch',
      description: 'Show or hide the architecture diagram pane',
    })
    await $.command.register({
      name: 'arch-on',
      description: 'Turn the architecture map on for this project',
    })
    await $.command.register({
      name: 'arch-off',
      description: 'Turn the architecture map off for this project',
    })
    await $.tool.register({
      name: TOOL,
      description:
        "Redraw the architecture diagram in the person's side pane: the components of what is being built in this project, how they connect, what changed and why, one request traced through them, one design lesson, and any security risks the design shows. Each call replaces the whole diagram and adds a version to the history.",
      inputSchema: SCHEMA,
      isDeferred: false,
    })

    // The project's saved record is the source of truth; a v0.1 diagram in
    // this session's state seeds it once.
    const project = await loadProject($)
    let list = project.history
    const old = await read($, legacy)
    if (list.length === 0 && old) {
      list = [old]
      await saveProject($, { history: list })
    }
    if (old) await update($, legacy, () => null)
    await update($, history, () => list)
    await update($, enabled, () => project.enabled)

    if (project.enabled && list.length > 0 && !(await read($, dismissed)))
      void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (!(await read($, enabled))) return out
    return {
      sections: [...out.sections, { id: 'arch-map:guide', text: GUIDE, scope: 'session' }],
    }
  })

  on('command.run', { command: 'arch' }, async $ => {
    if (!(await read($, enabled)))
      return { text: 'The architecture map is off for this project. /arch-on turns it on.' }
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE })
      await update($, dismissed, () => true)
      return { text: 'Architecture pane hidden. /arch brings it back.' }
    }
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Architecture pane opened.' }
  })

  on('command.run', { command: 'arch-on' }, async $ => {
    await saveProject($, { enabled: true })
    await update($, enabled, () => true)
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    const n = (await read($, history)).length
    return {
      text: `Architecture map on for this project${n > 0 ? ` (${n} saved version${n === 1 ? '' : 's'})` : ''}. Claude will keep the diagram updated as you build.`,
    }
  })

  on('command.run', { command: 'arch-off' }, async $ => {
    await saveProject($, { enabled: false })
    await update($, enabled, () => false)
    if (await isPaneOpen($)) await $.ui.close({ id: PANE })
    return {
      text: 'Architecture map off for this project. Its history is kept; /arch-on turns it back on.',
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('tool.call', { tool: FULL_TOOL }, async ($, e) => {
    if (!(await read($, enabled)))
      return {
        result: 'The architecture map is off for this project (the person ran /arch-off). Do not call this tool.',
        isError: true,
      }

    const saved = (await loadProject($)).history
    const last = saved[saved.length - 1]
    const parsed = parseDiagram(e as unknown as Record<string, unknown>, (last?.version ?? 0) + 1)
    if (typeof parsed === 'string')
      return { result: `Diagram not updated: ${parsed}`, isError: true }

    const list = [...saved, parsed].slice(-MAX_HISTORY)
    await saveProject($, { history: list })
    await update($, history, () => list)
    await update($, viewing, () => null)
    await update($, selected, () => null)
    if (!(await isPaneOpen($)) && !(await read($, dismissed)))
      void $.ui.open({ id: PANE, title: TITLE })

    const d = diff(last, parsed)
    const count = (m: Mark) => [...d.nodes.values()].filter(x => x === m).length
    const changes = last
      ? ` Since v${last.version}: ${count('added')} added, ${count('changed')} changed, ${d.removedNodes.length} removed components.`
      : ''
    const nRisks = parsed.risks?.length ?? 0
    const risky = nRisks > 0 ? ` ${nRisks} security risk${nRisks === 1 ? '' : 's'} flagged.` : ''
    return {
      result: `Diagram v${parsed.version} drawn: ${parsed.nodes.length} components, ${parsed.edges.length} connections.${changes}${risky}`,
    }
  }).catch(() => ({ result: 'Diagram not updated: the arch-map mod failed.', isError: true }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isOn = await read($, enabled)
    const list = await read($, history)

    if (!isOn) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">Architecture map is off for this project</Text>
          <Text dimColor>/arch-on turns it back on. Saved versions are kept.</Text>
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">No diagram yet</Text>
          <Text dimColor wrap="wrap">
            Once Claude starts building something with moving parts, its architecture appears
            here: the pieces, how they talk, what changed and why, and one design idea behind it.
          </Text>
          <Text dimColor wrap="wrap">Or ask: "draw the architecture of this project".</Text>
          <Text dimColor>/arch hides this pane · /arch-off turns it off here.</Text>
        </Box>
      )
    }

    const want = await read($, viewing)
    const last = list.length - 1
    const at = want === null ? last : Math.max(0, Math.min(last, want))
    const d = list[at]!
    const prev = at > 0 ? list[at - 1] : undefined
    const ch = diff(prev, d)
    const isLatest = at === last

    const pickedId = await read($, selected)
    const picked = d.nodes.find(n => n.id === pickedId)
    const cache = await read($, explanations)
    const expKey = (n: ArchNode) => `${d.version}:${n.id}`
    const shown = picked ? cache[expKey(picked)] : undefined

    const explain = async (n: ArchNode) => {
      if (pickedId === n.id) return update($, selected, () => null)
      await update($, selected, () => n.id)
      const k = expKey(n)
      const have = (await read($, explanations))[k]
      if (have && have.status !== 'error') return
      await update($, explanations, all => ({ ...all, [k]: { status: 'loading' as const, text: '' } }))
      const set = (x: Explanation) => update($, explanations, all => ({ ...all, [k]: x }))
      try {
        const r = await $.model.complete({
          model: EXPLAIN_MODEL,
          prompt: explainPrompt(d, n),
          maxTokens: 500,
        })
        await set(
          r.isAnswered
            ? { status: 'done', text: r.text.trim() }
            : { status: 'error', text: `No explanation (${r.reason}). Click again to retry.` },
        )
      } catch {
        await set({ status: 'error', text: 'The explanation request failed. Click again to retry.' })
      }
    }

    const go = (i: number | null) => () =>
      void update($, viewing, () => (i === null || i >= last ? null : Math.max(0, i)))

    const byId = new Map([...(prev?.nodes ?? []), ...d.nodes].map(n => [n.id, n]))
    const layers = layer(d)
    const depthOf = new Map<string, number>()
    layers.forEach((l, i) => l.forEach(n => depthOf.set(n.id, i)))
    const name = (id: string) => byId.get(id)?.label ?? id
    const back = d.edges.filter(x => (depthOf.get(x.to) ?? 0) <= (depthOf.get(x.from) ?? 0))
    const markColor = (m: Mark) => (m === 'added' ? ADDED : m === 'changed' ? CHANGED : undefined)
    const markGlyph = (m: Mark) => (m === 'added' ? '+ ' : m === 'changed' ? '~ ' : '')
    const hasChanges =
      !!prev &&
      (ch.nodes.size > 0 || ch.edges.size > 0 || ch.removedNodes.length > 0 || ch.removedEdges.length > 0)

    // The worst risk on each node or edge, for its marker in the diagram.
    const rank = (s: RiskSeverity) => SEVERITIES.indexOf(s)
    const worst = new Map<string, RiskSeverity>()
    for (const r of d.risks ?? []) {
      if (!r.target) continue
      const cur = worst.get(r.target)
      if (!cur || rank(r.severity) > rank(cur)) worst.set(r.target, r.severity)
    }
    const risks = [...(d.risks ?? [])].sort((a, b) => rank(b.severity) - rank(a.severity))
    const targetName = (t: string | undefined) => {
      if (!t) return 'Whole system'
      const [from, to] = t.split('->')
      return to === undefined ? name(t) : `${name(from!)} → ${name(to)}`
    }

    const edgeRow = (x: ArchEdge, glyph: string) => {
      const m = ch.edges.get(edgeKey(x))
      const r = worst.get(edgeKey(x))
      return (
        <Text color={markColor(m)} dimColor={!m && !r} wrap="wrap">
          {`  ${glyph} `}
          {markGlyph(m)}
          {name(x.from)} → {name(x.to)}
          {x.label ? `: ${x.label}` : ''}
          {r && <Text color={RISK_COLOR[r]}> ⚠</Text>}
        </Text>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Button key="prev" label="◀" hotkey="p" plain dimColor={at === 0} onPress={go(at - 1)} />
          <Text weight="semibold">v{d.version}</Text>
          <Text dimColor>
            ({at + 1} of {list.length})
          </Text>
          <Button key="next" label="▶" hotkey="n" plain dimColor={isLatest} onPress={go(at + 1)} />
          {!isLatest && <Button key="latest" label="latest" hotkey="l" plain onPress={go(null)} />}
        </Box>

        <Box flexDirection="column">
          <Text weight="semibold">{d.title}</Text>
          {d.summary && (
            <Text dimColor wrap="wrap">
              {d.summary}
            </Text>
          )}
        </Box>

        {d.why && prev && (
          <Box flexDirection="column">
            <Text color={CHANGED} weight="semibold">
              What changed in v{d.version}
            </Text>
            <Text wrap="wrap">{d.why}</Text>
          </Box>
        )}

        {hasChanges && (
          <Text dimColor>
            <Text color={ADDED}>+ new</Text>
            {'  '}
            <Text color={CHANGED}>~ changed</Text>
            {'  '}
            <Text color={REMOVED}>− removed</Text> since v{prev!.version}
          </Text>
        )}

        <Box flexDirection="column">
          {layers.map((row, i) => {
            const down = d.edges.filter(
              x => depthOf.get(x.from) === i && (depthOf.get(x.to) ?? 0) > i,
            )
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  {row.map(n => {
                    const m = ch.nodes.get(n.id)
                    const isPicked = picked?.id === n.id
                    const digit = d.nodes.indexOf(n) + 1
                    return (
                      <Box
                        borderStyle={isPicked ? 'bold' : m ? 'double' : 'round'}
                        borderColor={isPicked ? 'suggestion' : (markColor(m) ?? STYLE[n.kind].color)}
                        flexDirection="column"
                        paddingX={1}
                      >
                        <Button
                          key={`node:${n.id}`}
                          plain
                          hotkey={digit <= 9 ? String(digit) : undefined}
                          onPress={() => void explain(n)}
                        >
                          <Text weight="semibold" color={markColor(m)}>
                            {markGlyph(m)}
                            {n.label}
                          </Text>
                        </Button>
                        <Text color={STYLE[n.kind].color} dimColor>
                          {STYLE[n.kind].tag}
                          {n.note ? ` · ${n.note}` : ''}
                        </Text>
                        {worst.has(n.id) && (
                          <Text color={RISK_COLOR[worst.get(n.id)!]}>⚠ {worst.get(n.id)} risk</Text>
                        )}
                      </Box>
                    )
                  })}
                </Box>
                {down.map(x => edgeRow(x, '↓'))}
              </Box>
            )
          })}
          {back.map(x => edgeRow(x, '↺'))}
        </Box>

        {picked && (
          <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color="suggestion" weight="semibold">
                {picked.label}
              </Text>
              <Button key="close-explain" label="×" plain dimColor onPress={() => void update($, selected, () => null)} />
            </Box>
            {!shown || shown.status === 'loading' ? (
              <Text dimColor>Thinking…</Text>
            ) : (
              <Text wrap="wrap" color={shown.status === 'error' ? 'error' : undefined}>
                {shown.text}
              </Text>
            )}
          </Box>
        )}

        {(ch.removedNodes.length > 0 || ch.removedEdges.length > 0) && (
          <Box flexDirection="column">
            <Text color={REMOVED} weight="semibold">
              Removed since v{prev!.version}
            </Text>
            {ch.removedNodes.map(n => (
              <Text color={REMOVED} strikethrough>
                − {n.label} ({STYLE[n.kind].tag})
              </Text>
            ))}
            {ch.removedEdges.map(x => (
              <Text color={REMOVED} strikethrough wrap="wrap">
                − {name(x.from)} → {name(x.to)}
                {x.label ? `: ${x.label}` : ''}
              </Text>
            ))}
          </Box>
        )}

        {d.flow && (
          <Box flexDirection="column">
            <Text weight="semibold">How a request flows</Text>
            {d.flow.map((step, i) => (
              <Text wrap="wrap">
                {i + 1}. {step}
              </Text>
            ))}
          </Box>
        )}

        {d.lesson && (
          <Box flexDirection="column" borderStyle="single" borderColor="suggestion" paddingX={1}>
            <Text color="suggestion" weight="semibold">
              Concept: {d.lesson.concept}
            </Text>
            <Text wrap="wrap">{d.lesson.explanation}</Text>
          </Box>
        )}

        {risks.length > 0 && (
          <Box flexDirection="column" borderStyle="single" borderColor={RISK_COLOR[risks[0]!.severity]} paddingX={1}>
            <Text color={RISK_COLOR[risks[0]!.severity]} weight="semibold">
              Security risks (design level)
            </Text>
            {risks.map(r => (
              <Box flexDirection="column">
                <Text color={RISK_COLOR[r.severity]} wrap="wrap">
                  ⚠ {r.severity.toUpperCase()} · {targetName(r.target)}: {r.issue}
                </Text>
                {r.fix && (
                  <Text dimColor wrap="wrap">
                    {'  '}Fix: {r.fix}
                  </Text>
                )}
              </Box>
            ))}
            <Text dimColor wrap="wrap">
              Read off the diagram, not the code. /security-review checks the code itself.
            </Text>
          </Box>
        )}

        <Text dimColor wrap="wrap">
          1-9 or click a part to explain it · p/n step versions · /arch hides · /arch-off turns off here
        </Text>
      </Box>
    )
  })
}

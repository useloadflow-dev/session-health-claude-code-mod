import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { HandoffPhase, Phase, Snapshot, ToastMemory } from '../types'
import { Band } from './band.tsx'
import { fitLine1, line2, type Action, type BandModel } from './layout.ts'
import { DEFAULTS, turnsLeft, verdict, type Thresholds } from './verdict.ts'
import { toastsFor } from './toasts.ts'
import {
  COMPACT_INSTRUCTIONS,
  briefPrompt,
  handoffPath,
  injection,
  shouldLoad,
  storeKey,
  transcriptPrompt,
  type HandoffRecord,
} from './handoff.ts'

type $ = EngineInterface

const snapshot = atom({ plugin: 'session-health', key: 'snapshot' } as const, null as Snapshot | null)
const history = atom({ plugin: 'session-health', key: 'history' } as const, [] as number[])
const compactions = atom({ plugin: 'session-health', key: 'compactions' } as const, 0)
const turns = atom({ plugin: 'session-health', key: 'turns' } as const, 0)
const handoff = atom({ plugin: 'session-health', key: 'handoff' } as const, { phase: 'idle' } as HandoffPhase)
const toasted = atom({ plugin: 'session-health', key: 'toasted' } as const, { level: 'healthy', budget: {} } as ToastMemory)

const setPhase = ($: $, phase: Phase, at?: number) =>
  update($, handoff, (): HandoffPhase => (at === undefined ? { phase } : { phase, at }))

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}

async function autoCompactAt($: $, window: number): Promise<number> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (!b) return window
    const buffer = b.categories.filter(c => c.kind === 'buffer').reduce((n, c) => n + c.tokens, 0)
    return Math.max(1, b.rawMaxTokens - buffer)
  } catch {
    return window
  }
}

async function record($: $, m: Measured) {
  const win = (kind: string) => {
    const r = m.rateLimits.find(x => x.kind === kind)
    if (!r) return undefined
    return r.resetsAt === undefined ? { percent: r.percentUsed } : { percent: r.percentUsed, resetsAt: r.resetsAt }
  }
  const snap: Snapshot = {
    window: m.context.window,
    autoCompactAt: await autoCompactAt($, m.context.window),
  }
  if (m.context.percent !== undefined) snap.percent = m.context.percent
  if (m.context.tokens !== undefined) snap.tokens = m.context.tokens
  const five = win('five_hour')
  const week = win('seven_day')
  if (five) snap.fiveHour = five
  if (week) snap.week = week
  await update($, snapshot, () => snap)
  const n = await $.session.turns()
  await update($, turns, () => n)
}

async function notify($: $, t: Thresholds) {
  const m = await modelOf($, t)
  const prev = await read($, toasted)
  const { messages, memory } = toastsFor(prev, { level: m.level, fiveHour: m.fiveHour, week: m.week })
  await update($, toasted, () => memory)
  for (const msg of messages) $.ui.toast(msg)
}

async function modelOf($: $, t: Thresholds): Promise<BandModel> {
  const snap = await read($, snapshot)
  const hist = await read($, history)
  const comp = await read($, compactions)
  const nTurns = await read($, turns)
  const ho = await read($, handoff)
  const now = await $.clock.now()
  const left = snap ? turnsLeft(hist, snap.autoCompactAt) : undefined
  const v = verdict(
    { percent: snap?.percent, turnsLeft: left, compactions: comp, turns: nTurns, fiveHour: snap?.fiveHour, week: snap?.week },
    t,
  )
  return {
    percent: snap?.percent,
    tokens: snap?.tokens,
    window: snap?.window ?? 0,
    turnsLeft: left,
    compactions: comp,
    fiveHour: snap?.fiveHour,
    week: snap?.week,
    level: v.level,
    budget: v.budget,
    phase: ho.phase,
    phaseAt: ho.at,
    now,
  }
}

export const register: Register = (on, options) => {
  const t: Thresholds = { ...DEFAULTS, ...(options as Partial<Thresholds>) }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'Write a hand-off brief for a fresh session' })
    try {
      await record($, await $.session.usage())
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    const written = await startHandoff($)
    if (written === 'busy') return { text: 'A hand-off is already being written.' }
    return {
      text: written
        ? 'Hand-off written to .claude/handoff.md — run /clear to start fresh.'
        : 'Hand-off not written (see toast).',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    let brief: string | undefined
    try {
      brief = await loadHandoff($)
    } catch (err) {
      $.ui.status(`session-health: hand-off not loaded (${err instanceof Error ? err.message : String(err)})`)
    }
    return brief === undefined ? next(e) : next({ ...e, context: [...(e.context ?? []), injection(brief)] })
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await record($, e)
    const tokens = e.context.tokens
    if (tokens !== undefined) {
      await update($, history, h => (h[h.length - 1] === tokens ? h : [...h, tokens].slice(-8)))
    }
    const ho = await read($, handoff)
    if (ho.phase === 'resumed' && (await $.session.turns()) >= 1) await setPhase($, 'idle')
    await notify($, t)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.trigger !== 'precompute' && !r.skip) {
      await update($, compactions, n => n + 1)
      await update($, history, () => [])
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, compactions, () => 0)
      await update($, history, () => [])
      await update($, toasted, () => ({ level: 'healthy', budget: {} }))
      await update($, handoff, (h): HandoffPhase => (h.phase === 'ready' ? { phase: 'idle' } : h))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const m = await modelOf($, t)
    const cols = e.props.bodyColumns
    return (
      <Band
        el={$.ui.resolve(e)}
        line1={fitLine1(m, cols)}
        line2={line2(m, cols)}
        onAction={(a: Action) => onAction($, a)}
      />
    )
  })
}

async function onAction($: $, a: Action) {
  if (a === 'compact') return compactNow($)
  await startHandoff($)
}

async function compactNow($: $) {
  await setPhase($, 'compacting')
  try {
    const r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
    if (r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
  } catch (err) {
    $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await setPhase($, 'idle')
  }
}

async function startHandoff($: $): Promise<boolean | 'busy'> {
  const current = await read($, handoff)
  if (current.phase === 'writing') {
    $.ui.toast('A hand-off is already being written')
    return 'busy'
  }
  await setPhase($, 'writing')
  try {
    const root = await $.session.root()
    const project = root.split('/').filter(Boolean).pop() ?? root
    const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace('T', ' ')
    const prompt = briefPrompt(project, stamp)

    let r = await $.model.fork({ prompt })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      const messages = await $.session.messages()
      r = await $.model.complete({ model: await $.session.model(), prompt: transcriptPrompt(messages) + prompt })
    }
    if (!r.isAnswered) throw new Error(r.reason)

    const path = handoffPath(root)
    await $.fs.write(path, r.text)
    const rec: HandoffRecord = { path, writtenAt: await $.clock.now(), sessionId: await $.session.id(), consumed: false }
    await $.store.set(storeKey(root), rec)
    await setPhase($, 'ready', rec.writtenAt)
    $.ui.toast('Hand-off ready — run /clear')
    return true
  } catch (err) {
    await setPhase($, 'idle')
    $.ui.toast(`Hand-off failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// The brief to hand the model with this prompt, when a fresh conversation has one waiting.
async function loadHandoff($: $): Promise<string | undefined> {
  const root = await $.session.root()
  const rec = (await $.store.get(storeKey(root))) as HandoffRecord | undefined
  if (!shouldLoad(rec, await $.clock.now(), await $.session.turns())) return undefined
  if (rec!.sessionId === (await $.session.id())) return undefined
  const brief = await $.fs.read(rec!.path)
  await $.store.set(storeKey(root), { ...rec!, consumed: true })
  await setPhase($, 'resumed', rec!.writtenAt)
  return brief
}

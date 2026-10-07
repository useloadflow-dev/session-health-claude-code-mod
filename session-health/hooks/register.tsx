import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { HandoffPhase, Snapshot, ToastMemory } from '../types'
import { Band } from './band.tsx'
import { fitLine1, line2, type Action, type BandModel } from './layout.ts'
import { DEFAULTS, turnsLeft, verdict, type Thresholds } from './verdict.ts'
import { toastsFor } from './toasts.ts'
import { COMPACT_INSTRUCTIONS } from './handoff.ts'

type $ = EngineInterface

const snapshot = atom({ plugin: 'session-health', key: 'snapshot' } as const, null as Snapshot | null)
const history = atom({ plugin: 'session-health', key: 'history' } as const, [] as number[])
const compactions = atom({ plugin: 'session-health', key: 'compactions' } as const, 0)
const turns = atom({ plugin: 'session-health', key: 'turns' } as const, 0)
const handoff = atom({ plugin: 'session-health', key: 'handoff' } as const, { phase: 'idle' } as HandoffPhase)
const toasted = atom({ plugin: 'session-health', key: 'toasted' } as const, { level: 'healthy', budget: {} } as ToastMemory)

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
    try {
      await record($, await $.session.usage())
    } catch {}
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await record($, e)
    const tokens = e.context.tokens
    if (tokens !== undefined) {
      await update($, history, h => (h[h.length - 1] === tokens ? h : [...h, tokens].slice(-8)))
    }
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
  return startHandoff($)
}

async function compactNow($: $) {
  await update($, handoff, () => ({ phase: 'compacting' }))
  try {
    const r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
    if (r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
  } catch (err) {
    $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, handoff, () => ({ phase: 'idle' }))
  }
}

// Task 6 replaces this.
async function startHandoff(_$: $) {}

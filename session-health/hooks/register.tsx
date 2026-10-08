import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { HandoffPhase, Phase, Snapshot, ToastMemory } from '../types'
import { Band } from './band.tsx'
import { fitLine1, line2, type Action, type BandModel } from './layout.ts'
import { DEFAULTS, autoCompactPoint, countsCompaction, turnsLeft, verdict, type Thresholds } from './verdict.ts'
import { toastsFor } from './toasts.ts'
import { BUDGETS_KEY, SYNC_MS, current, isBudgets, newer, sameWindow, type Budgets } from './budgets.ts'
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

const handoffRef = { plugin: 'session-health', key: 'handoff' } as const

const STALE_MS = 5 * 60 * 1000
const READY_TURNS = 3

const setPhase = ($: $, phase: Phase, at?: number) =>
  update($, handoff, (): HandoffPhase => (at === undefined ? { phase } : { phase, at }))

// Settles a running phase without disturbing one another action has moved on to.
const endPhase = ($: $, running: Phase) =>
  update($, handoff, (h): HandoffPhase => (h.phase === running ? { phase: 'idle' } : h))

// The only way into 'writing': one claim wins even when two presses race.
let writing = false
async function claimWriting($: $, now: number): Promise<boolean> {
  if (writing) return false
  writing = true
  const held = await $.state.get(handoffRef)
  const h = held.value
  const busy = h?.phase === 'writing' && now - (h.at ?? 0) < STALE_MS
  if (busy) {
    writing = false
    return false
  }
  const set = await $.state.set(handoffRef, { phase: 'writing', at: now }, { ifVersion: held.version })
  if (!set.isSet) writing = false
  return set.isSet
}

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}

async function autoCompactAt($: $, window: number): Promise<number | undefined> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    return autoCompactPoint(usage.context.breakdown, window)
  } catch {
    return window
  }
}

// Set once a response arrives with no rate limits: off a subscription, so other sessions' budgets are not ours.
let offPlan = false

async function sharedBudgets($: $): Promise<Budgets | undefined> {
  try {
    const v = await $.store.get(BUDGETS_KEY)
    return isBudgets(v) ? v : undefined
  } catch {
    return undefined
  }
}

// `heard`: the figures come from a response that just arrived, so they are the account's latest.
async function record($: $, m: Measured, heard: boolean) {
  const win = (kind: string) => {
    const r = m.rateLimits.find(x => x.kind === kind)
    if (!r) return undefined
    return r.resetsAt === undefined ? { percent: r.percentUsed } : { percent: r.percentUsed, resetsAt: r.resetsAt }
  }
  const now = await $.clock.now()
  const snap: Snapshot = { window: m.context.window }
  const at = await autoCompactAt($, m.context.window)
  if (at !== undefined) snap.autoCompactAt = at
  if (m.context.percent !== undefined) snap.percent = m.context.percent
  if (m.context.tokens !== undefined) snap.tokens = m.context.tokens

  let own: Budgets | undefined
  const five = win('five_hour')
  const week = win('seven_day')
  if (five || week) {
    own = { at: heard ? now : 0 }
    if (five) own.fiveHour = five
    if (week) own.week = week
    offPlan = false
  } else if (heard && m.context.tokens !== undefined) {
    offPlan = true
  }
  const shared = offPlan ? undefined : await sharedBudgets($)
  const shown = newer(own, shared)
  if (shown) {
    const b = current(shown, now)
    if (b.fiveHour) snap.fiveHour = b.fiveHour
    if (b.week) snap.week = b.week
    snap.budgetsAt = b.at
    if (own && heard && shown === own) {
      try {
        await $.store.set(BUDGETS_KEY, own)
      } catch {}
    }
  }
  await update($, snapshot, () => snap)
  const n = await $.session.turns()
  await update($, turns, () => n)
}

// Picks up a reading another session heard more recently, and empties windows that have reset.
async function sync($: $, t: Thresholds) {
  if (offPlan) return
  const now = await $.clock.now()
  const snap = await read($, snapshot)
  const mine: Budgets = { at: snap?.budgetsAt ?? 0 }
  if (snap?.fiveHour) mine.fiveHour = snap.fiveHour
  if (snap?.week) mine.week = snap.week
  const b = current(newer(mine, await sharedBudgets($)) ?? mine, now)
  if (b.at === mine.at && sameWindow(b.fiveHour, mine.fiveHour) && sameWindow(b.week, mine.week)) return
  await update($, snapshot, s => {
    const next: Snapshot = { ...(s ?? { window: 0 }), budgetsAt: b.at }
    delete next.fiveHour
    delete next.week
    if (b.fiveHour) next.fiveHour = b.fiveHour
    if (b.week) next.week = b.week
    return next
  })
  await notify($, t)
}

let ticker: Timer | undefined

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
  const left = snap?.autoCompactAt !== undefined ? turnsLeft(hist, snap.autoCompactAt) : undefined
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
    await $.command.register({ name: 'smart-compact', description: 'Compact, keeping the goal, open tasks, decisions and files in play' })
    // A reload drops whatever compaction or fork was in flight; its phase must not outlive it.
    writing = false
    await update($, handoff, (h): HandoffPhase =>
      h.phase === 'writing' || h.phase === 'compacting' ? { phase: 'idle' } : h,
    )
    try {
      await record($, await $.session.usage(), false)
    } catch {}
    ticker?.cancel()
    ticker = $.clock.every(SYNC_MS, () => {
      void sync($, t).catch(() => {})
    })
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

  on('command.run', { command: 'smart-compact' }, async $ => {
    if ((await read($, handoff)).phase === 'compacting') return { text: 'A compaction is already running.' }
    // Not awaited: /compact is queued behind this command and runs once it returns.
    void compactNow($)
    return { text: 'Compacting with smart instructions…' }
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
    await record($, e, e.rateLimits.length > 0)
    const tokens = e.context.tokens
    if (tokens !== undefined) {
      await update($, history, h => (h[h.length - 1] === tokens ? h : [...h, tokens].slice(-8)))
    }
    const ho = await read($, handoff)
    const nTurns = await $.session.turns()
    if (ho.phase === 'resumed' && nTurns >= 1) await endPhase($, 'resumed')
    if (ho.phase === 'ready' && nTurns >= (ho.turn ?? 0) + READY_TURNS) await endPhase($, 'ready')
    await notify($, t)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (countsCompaction(e, Boolean(r.skip))) {
      await update($, compactions, n => n + 1)
      await update($, history, () => [])
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      // The next conversation's figures arrive with its first measure; until then keep only the budgets.
      await update($, snapshot, s => {
        if (!s) return s
        const kept: Snapshot = { window: s.window }
        if (s.fiveHour) kept.fiveHour = s.fiveHour
        if (s.week) kept.week = s.week
        if (s.budgetsAt !== undefined) kept.budgetsAt = s.budgetsAt
        return kept
      })
      await update($, turns, () => 0)
      await update($, compactions, () => 0)
      await update($, history, () => [])
      await update($, toasted, () => ({ level: 'healthy', budget: {} }))
      await endPhase($, 'ready')
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
    // Run /compact as if typed: it works on every surface (a direct
    // $.session.compact is refused headless), and the engine's own
    // session.compact (trigger 'manual') reaches our hook, so ⟲ counts it.
    await $.command.run({ command: 'compact', args: COMPACT_INSTRUCTIONS })
  } catch (err) {
    $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await endPhase($, 'compacting')
  }
}

async function startHandoff($: $): Promise<boolean | 'busy'> {
  if (!(await claimWriting($, await $.clock.now()))) {
    $.ui.toast('A hand-off is already being written')
    return 'busy'
  }
  try {
    const root = await $.session.root()
    const project = root.split('/').filter(Boolean).pop() ?? root
    const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace('T', ' ')
    const prompt = briefPrompt(project, stamp)

    let r = await $.model.fork({ prompt })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      const messages = await $.session.messages()
      if (messages.length === 0) throw new Error('nothing to hand off yet')
      r = await $.model.complete({ model: await $.session.model(), prompt: transcriptPrompt(messages) + prompt })
    }
    if (!r.isAnswered) throw new Error(r.reason)

    const path = handoffPath(root)
    await $.fs.write(path, r.text)
    const rec: HandoffRecord = { path, writtenAt: await $.clock.now(), sessionId: await $.session.id(), consumed: false }
    await $.store.set(storeKey(root), rec)
    const turn = await $.session.turns()
    await update($, handoff, (): HandoffPhase => ({ phase: 'ready', at: rec.writtenAt, turn }))
    $.ui.toast('Hand-off ready — run /clear')
    return true
  } catch (err) {
    await endPhase($, 'writing')
    $.ui.toast(`Hand-off failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  } finally {
    writing = false
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

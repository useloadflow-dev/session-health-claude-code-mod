import type { Budget, Level, Window } from './verdict.ts'
import { AMBER, CORAL, LIME, bar, barColor, kTokens, relTime } from './meters.ts'

export type Phase = 'idle' | 'compacting' | 'writing' | 'ready' | 'resumed'

export type BandModel = {
  percent?: number
  tokens?: number
  window: number
  turnsLeft?: number
  compactions: number
  fiveHour?: Window
  week?: Window
  level: Level
  budget?: Budget
  phase: Phase
  phaseAt?: number
  now: number
}

export type Segment = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Action = 'compact' | 'fresh'
export type Line2 = { segments: Segment[]; actions: Action[] }

export const LEVEL_ICON: Record<Level, string> = { healthy: '●', heavy: '◐', compact: '◑', fresh: '✦' }
export const LEVEL_COLOR: Record<Level, string> = { healthy: LIME, heavy: AMBER, compact: CORAL, fresh: CORAL }

const GAP = '   '
const MIN_TIER = 5
const MIN_TEXT = 16

export const BUTTON_LABEL: Record<Action, string> = { compact: 'compact', fresh: 'fresh start' }
// One key presses each button once the band has the focus (ctrl+x tab).
export const BUTTON_HOTKEY: Record<Action, string> = { compact: 'c', fresh: 'f' }

// Cells the buttons take on the terminal: `[ label ]` and a gap before each.
export function buttonsWidth(actions: readonly Action[]): number {
  return actions.reduce((n, a) => n + BUTTON_LABEL[a].length + 5, 0)
}

function truncate(segments: Segment[], room: number): Segment[] {
  if (width(segments) <= room) return segments
  const out: Segment[] = []
  let left = Math.max(0, room - 1)
  for (const s of segments) {
    const chars = [...s.text]
    if (chars.length <= left) {
      out.push(s)
      left -= chars.length
      continue
    }
    out.push({ ...s, text: chars.slice(0, left).join('') + '…' })
    break
  }
  return out
}

export function width(segments: readonly Segment[]): number {
  return segments.reduce((n, s) => n + [...s.text].length, 0)
}

type Opts = { tokens: boolean; short: boolean; cells: number }
const TIERS: Opts[] = [
  { tokens: true, short: false, cells: 10 },
  { tokens: false, short: false, cells: 10 },
  { tokens: false, short: true, cells: 10 },
  { tokens: false, short: true, cells: 5 },
  { tokens: false, short: true, cells: 0 },
]

function meter(label: string, percent: number, cells: number): Segment[] {
  const out: Segment[] = [{ text: `${label} `, dim: true }]
  if (cells > 0) {
    const b = bar(percent, cells)
    out.push({ text: b.filled, color: barColor(percent) }, { text: b.empty, dim: true }, { text: ' ' })
  }
  out.push({ text: `${Math.round(percent)}%`, bold: true })
  return out
}

function windowMeter(label: string, w: Window, cells: number, now: number): Segment[] {
  const out = meter(label, w.percent, cells)
  const rel = cells > 0 ? relTime(w.resetsAt, now) : undefined
  if (rel !== undefined) out.push({ text: ` · ${rel}`, dim: true })
  return out
}

export function line1(m: BandModel, tier: number): Segment[] {
  if (tier >= MIN_TIER) return minimal(m)
  const o = TIERS[tier]!
  const out: Segment[] = [{ text: ' ' }]

  const ctxLabel = o.short ? 'ctx' : 'CONTEXT'
  if (m.percent === undefined) {
    out.push({ text: `${ctxLabel} `, dim: true }, { text: '—', dim: true })
  } else {
    out.push(...meter(ctxLabel, m.percent, o.cells))
    if (o.tokens && m.tokens !== undefined) {
      out.push({ text: ` ${kTokens(m.tokens)}/${kTokens(m.window)}`, dim: true })
    }
    if (o.cells > 0) out.push({ text: ` ~${m.turnsLeft ?? '—'} turns`, dim: true })
    if (o.cells > 0 && m.compactions > 0) out.push({ text: ` ⟲${m.compactions}`, dim: true })
  }

  const sep = o.cells > 0 ? GAP : ' · '
  if (m.fiveHour) out.push({ text: sep, dim: true }, ...windowMeter(o.short ? '5h' : 'SESSION', m.fiveHour, o.cells, m.now))
  if (m.week) out.push({ text: sep, dim: true }, ...windowMeter(o.short ? 'wk' : 'WEEK', m.week, o.cells, m.now))
  return out
}

function minimal(m: BandModel): Segment[] {
  const parts = [m.percent, m.fiveHour?.percent, m.week?.percent]
    .filter((p): p is number => p !== undefined)
    .map(p => `${Math.round(p)}%`)
  const head = parts.length > 0 ? parts.join(' · ') : '—'
  return [{ text: ` ${head} ` }, { text: LEVEL_ICON[m.level], color: LEVEL_COLOR[m.level] }]
}

export function fitLine1(m: BandModel, columns: number): Segment[] {
  for (let tier = 0; tier < MIN_TIER; tier++) {
    const segs = line1(m, tier)
    if (width(segs) <= columns) return segs
  }
  return line1(m, MIN_TIER)
}

function ago(m: BandModel): string {
  const minutes = Math.max(0, Math.floor((m.now - (m.phaseAt ?? m.now)) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
}

function verdictText(m: BandModel): string | undefined {
  const turns = m.turnsLeft === undefined ? '' : ` (~${m.turnsLeft} turns left)`
  switch (m.level) {
    case 'heavy':
      return `◐ getting heavy — /compact at a natural break${turns}`
    case 'compact':
      return m.turnsLeft === undefined
        ? '◑ compact now — context is filling up'
        : `◑ compact now — auto-compact in ~${m.turnsLeft} turns`
    case 'fresh':
      return `✦ start fresh — compacted ${m.compactions}× already, quality drops`
    case 'healthy':
      return undefined
  }
}

export function line2(m: BandModel, columns: number): Line2 | undefined {
  const segments: Segment[] = [{ text: ' ' }]
  let actions: Action[] = []

  if (m.phase === 'compacting') {
    segments.push({ text: '⟲ compacting…', color: LIME })
  } else if (m.phase === 'writing') {
    segments.push({ text: '✎ writing hand-off…', color: LIME })
  } else if (m.phase === 'ready') {
    segments.push({ text: '✓ hand-off ready — run /clear', color: LIME, bold: true })
  } else if (m.phase === 'resumed') {
    segments.push({ text: `↪ resumed from hand-off (${ago(m)} ago)`, color: LIME })
  } else {
    const v = verdictText(m)
    if (v !== undefined) segments.push({ text: v, color: LEVEL_COLOR[m.level], bold: m.level !== 'heavy' })
    if (m.level === 'heavy') actions = ['compact']
    if (m.level === 'compact') actions = ['compact', 'fresh']
    if (m.level === 'fresh') actions = ['fresh']
  }

  if (m.budget) {
    const rel = relTime(m.budget.resetsAt, m.now)
    const tail = rel === undefined ? '' : ` — resets in ${rel}`
    if (segments.length > 1) segments.push({ text: ' · ', dim: true })
    segments.push({
      text: `⚠ ${m.budget.kind} budget ${Math.round(m.budget.percent)}%${tail}, pace yourself`,
      color: barColor(m.budget.percent),
    })
  }

  if (segments.length === 1) return undefined
  if (columns < 40 || columns - buttonsWidth(actions) < MIN_TEXT) actions = []
  return { segments: truncate(segments, columns - buttonsWidth(actions)), actions }
}

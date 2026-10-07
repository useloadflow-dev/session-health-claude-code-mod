export type Level = 'healthy' | 'heavy' | 'compact' | 'fresh'

export type Thresholds = {
  heavyPct: number
  compactPct: number
  heavyTurns: number
  compactTurns: number
  freshCompactions: number
  freshTurns: number
  budgetWarnPct: number
}

export const DEFAULTS: Thresholds = {
  heavyPct: 45,
  compactPct: 60,
  heavyTurns: 8,
  compactTurns: 4,
  freshCompactions: 2,
  freshTurns: 150,
  budgetWarnPct: 90,
}

export const LEVEL_RANK: Record<Level, number> = { healthy: 0, heavy: 1, compact: 2, fresh: 3 }

export type Window = { percent: number; resetsAt?: string }
export type Budget = { kind: '5h' | 'wk'; percent: number; resetsAt?: string }

export type VerdictInput = {
  percent?: number
  turnsLeft?: number
  compactions: number
  turns: number
  fiveHour?: Window
  week?: Window
}

export type Verdict = { level: Level; budget?: Budget }

export function turnsLeft(history: readonly number[], autoCompactAt: number): number | undefined {
  if (history.length < 2) return undefined
  const current = history[history.length - 1]!
  if (current >= autoCompactAt) return 0
  const growths: number[] = []
  for (let i = 1; i < history.length; i++) {
    const growth = history[i]! - history[i - 1]!
    if (growth > 0) growths.push(growth)
  }
  const recent = growths.slice(-5)
  if (recent.length === 0) return undefined
  const average = recent.reduce((sum, g) => sum + g, 0) / recent.length
  return Math.floor((autoCompactAt - current) / average)
}

export function verdict(input: VerdictInput, t: Thresholds = DEFAULTS): Verdict {
  const pct = input.percent ?? 0
  const left = input.turnsLeft
  const compactWorthy = pct >= t.compactPct || (left !== undefined && left <= t.compactTurns)
  const heavy = pct >= t.heavyPct || (left !== undefined && left <= t.heavyTurns)
  const worn = input.compactions >= t.freshCompactions || input.turns > t.freshTurns

  const level: Level = compactWorthy ? (worn ? 'fresh' : 'compact') : heavy ? 'heavy' : 'healthy'
  const budget = budgetOf(input, t)
  return budget ? { level, budget } : { level }
}

function budgetOf(input: VerdictInput, t: Thresholds): Budget | undefined {
  const five = input.fiveHour
  const week = input.week
  const fiveHot = five !== undefined && five.percent >= t.budgetWarnPct
  const weekHot = week !== undefined && week.percent >= t.budgetWarnPct
  if (!fiveHot && !weekHot) return undefined
  const w = fiveHot && (!weekHot || five!.percent >= week!.percent) ? five! : week!
  const kind = w === five ? '5h' : 'wk'
  return w.resetsAt === undefined ? { kind, percent: w.percent } : { kind, percent: w.percent, resetsAt: w.resetsAt }
}

// Where auto-compaction will run: the engine's own threshold, or undefined when it is off.
export function autoCompactPoint(
  b: { autoCompactThreshold?: number; isAutoCompactEnabled: boolean } | undefined,
  window: number,
): number | undefined {
  if (!b) return window
  if (b.autoCompactThreshold !== undefined) return b.autoCompactThreshold
  return b.isAutoCompactEnabled ? window : undefined
}

// Only the main conversation's real compactions count toward ⟲.
export function countsCompaction(e: { trigger: string; agentId?: string }, skipped: boolean): boolean {
  return e.agentId === undefined && e.trigger !== 'precompute' && !skipped
}

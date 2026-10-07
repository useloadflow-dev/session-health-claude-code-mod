import type { Level, Window } from './verdict.ts'
import { LEVEL_RANK } from './verdict.ts'

export type ToastMemory = { level: Level; budget: Record<string, number> }

const LEVEL_MESSAGE: Record<Level, string> = {
  healthy: '',
  heavy: '◐ Getting heavy — consider /compact at a natural break',
  compact: '◑ Compact now — context is filling up',
  fresh: '✦ Start fresh — use [fresh start] to write a hand-off',
}

const STEPS = [90, 75] as const

export function toastsFor(
  prev: ToastMemory,
  v: { level: Level; fiveHour?: Window; week?: Window },
): { messages: string[]; memory: ToastMemory } {
  const messages: string[] = []
  if (LEVEL_RANK[v.level] > LEVEL_RANK[prev.level]) messages.push(LEVEL_MESSAGE[v.level])

  const budget = { ...prev.budget }
  const check = (name: string, w: Window | undefined) => {
    if (!w) return
    const key = `${name}|${w.resetsAt ?? ''}`
    const step = STEPS.find(s => w.percent >= s)
    if (step === undefined || (budget[key] ?? 0) >= step) return
    budget[key] = step
    const pct = Math.round(w.percent)
    messages.push(step >= 90 ? `⚠ ${name} budget at ${pct}% — pace yourself` : `${name} budget at ${pct}%`)
  }
  check('5-hour', v.fiveHour)
  check('Weekly', v.week)

  return { messages, memory: { level: v.level, budget } }
}

import type { Window } from '../types'

// The 5-hour and weekly budgets are the account's, not the session's, but each
// session only hears them from its own API responses. Sessions share the newest
// reading through the plugin's store, stamped with when it was heard.
export type Budgets = { at: number; fiveHour?: Window; week?: Window }

export const BUDGETS_KEY = 'budgets'
export const SYNC_MS = 15_000

export function isBudgets(v: unknown): v is Budgets {
  return typeof v === 'object' && v !== null && typeof (v as Budgets).at === 'number'
}

// The reading to show: whichever was heard last.
export function newer(a: Budgets | undefined, b: Budgets | undefined): Budgets | undefined {
  if (!a) return b
  if (!b) return a
  return b.at > a.at ? b : a
}

// A window whose reset has passed is empty until a response says otherwise.
export function lapse(w: Window | undefined, now: number): Window | undefined {
  if (!w || w.resetsAt === undefined) return w
  const at = Date.parse(w.resetsAt)
  return !Number.isNaN(at) && at <= now ? { percent: 0 } : w
}

export function current(b: Budgets, now: number): Budgets {
  const out: Budgets = { at: b.at }
  const five = lapse(b.fiveHour, now)
  const week = lapse(b.week, now)
  if (five) out.fiveHour = five
  if (week) out.week = week
  return out
}

export function sameWindow(a: Window | undefined, b: Window | undefined): boolean {
  return a?.percent === b?.percent && a?.resetsAt === b?.resetsAt
}

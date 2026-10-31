// Compactions per session, kept in $.store so a count outlives the process:
// quitting and `claude --resume`, or /resume back to an older conversation,
// picks the session's count back up instead of starting again at 0.

export const TALLY_KEY = 'compactions'
export const TALLY_MAX = 50

export type Tally = Record<string, { count: number; at: number }>

export function isTally(v: unknown): v is Tally {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every(
    e => typeof e === 'object' && e !== null && typeof e.count === 'number' && typeof e.at === 'number',
  )
}

export function countOf(t: Tally | undefined, sessionId: string): number {
  return t?.[sessionId]?.count ?? 0
}

// Records `count` compactions for `sessionId`; only the TALLY_MAX most recent sessions are kept.
// The caller passes the live count, so a store that fell behind catches up on the next write.
export function put(t: Tally | undefined, sessionId: string, count: number, now: number): Tally {
  const next: Tally = { ...t, [sessionId]: { count, at: now } }
  const ids = Object.keys(next)
  if (ids.length <= TALLY_MAX) return next
  const keep = new Set(ids.sort((a, b) => next[b]!.at - next[a]!.at).slice(0, TALLY_MAX))
  return Object.fromEntries(Object.entries(next).filter(([id]) => keep.has(id)))
}

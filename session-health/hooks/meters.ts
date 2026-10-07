export const LIME = '#aaff00'
export const AMBER = '#ffb000'
export const CORAL = '#ff5f57'

const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

export function barColor(percent: number): string {
  if (percent >= 90) return CORAL
  if (percent >= 70) return AMBER
  return LIME
}

export function bar(percent: number, cells: number): { filled: string; empty: string } {
  const clamped = Math.min(100, Math.max(0, percent))
  const eighths = Math.round((clamped / 100) * cells * 8)
  const full = Math.floor(eighths / 8)
  const rem = eighths % 8
  const filled = '█'.repeat(full) + PARTIALS[rem]
  const empty = '░'.repeat(cells - full - (rem > 0 ? 1 : 0))
  return { filled, empty }
}

export function relTime(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  const minutes = Math.floor((at - now) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

export function kTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

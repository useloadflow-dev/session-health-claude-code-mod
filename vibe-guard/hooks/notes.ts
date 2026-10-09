// Reading and writing the notes vibe-wise keeps in a project's `.vibe-wise/`
// (or legacy `.sensible-vibes/`), the way vibe-wise itself reads them.

export type Mode = 'none' | 'active' | 'paused'
export type Pending = { name: string; stage?: string }
export type Located = { root: string; dir?: string }

const NAMES = ['.vibe-wise', '.sensible-vibes'] as const
const MODE_LINE = /^Learning mode:\s*(\S.*?)\s*$/im
const STAGES = ['reasoning', 'choice confirmation', 'implementation approval'] as const

// vibe-wise's own rule: a non-empty profile is active unless its mode line says paused.
export function parseProfile(text: string): Mode {
  if (!text.trim()) return 'none'
  const m = MODE_LINE.exec(text)
  return m && m[1]!.toLowerCase() === 'paused' ? 'paused' : 'active'
}

// The `## Pending decision` section vibe-wise keeps while a checkpoint waits on the learner.
export function parsePending(progress: string): Pending | undefined {
  const lines = progress.split('\n')
  const at = lines.findIndex(l => /^##\s+Pending decision\s*$/i.test(l.trim()))
  if (at < 0) return undefined
  const body: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,2}\s/.test(line)) break
    const text = line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim()
    if (text) body.push(text)
  }
  const all = body.join('\n').toLowerCase()
  const stage = STAGES.find(s => all.includes(s))
  const named = body.map(l => /^(?:decision|checkpoint|name)\s*:\s*(.+)$/i.exec(l)?.[1]).find(Boolean)
  const name = named ?? body.find(l => !/^stage\s*:/i.test(l)) ?? 'a decision'
  return stage === undefined ? { name } : { name, stage }
}

export function setMode(profile: string, mode: 'active' | 'paused'): string {
  const line = `Learning mode: ${mode}`
  if (MODE_LINE.test(profile)) return profile.replace(MODE_LINE, line)
  const lines = profile.split('\n')
  const title = lines.findIndex(l => l.startsWith('# '))
  lines.splice(title + 1, 0, '', line)
  return lines.join('\n')
}

export function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + '/')
}

export function absolute(path: string, cwd: string): string {
  const joined = path.startsWith('/') ? path : `${cwd}/${path}`
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

// Walks up from `start` to the nearest notes directory, never past a repository boundary.
export async function locate(start: string, exists: (path: string) => Promise<boolean>): Promise<Located> {
  let dir = start
  for (;;) {
    for (const name of NAMES) {
      if (await exists(`${dir}/${name}`)) return { root: dir, dir: `${dir}/${name}` }
    }
    if (await exists(`${dir}/.git`)) return { root: dir }
    const parent = dir.slice(0, dir.lastIndexOf('/')) || '/'
    if (parent === dir) return { root: start }
    dir = parent
  }
}

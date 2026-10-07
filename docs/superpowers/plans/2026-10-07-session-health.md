# session-health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that draws a band above the prompt with context, 5-hour and weekly usage meters, a compact-or-start-fresh verdict, one-click smart compaction, and a hand-off brief that loads itself into the next conversation.

**Architecture:** One hooks-module plugin. All the logic is in pure, `$`-free modules: `verdict.ts`, `meters.ts`, `layout.ts`, `toasts.ts` and `handoff.ts`. Each is unit-tested on its own. `register.tsx` is a thin layer that turns engine events into `$.state` atoms and draws the band from those atoms through `band.tsx`.

**Tech Stack:** TypeScript/TSX hooks module for Claude Code 2.1.292 (function hooks API, `import type … from 'claude-code'`), tested with the `claude-code/testing` kit via `claude plugin test`, checked with `claude plugin validate` and `tsc -p`.

**Spec:** `docs/superpowers/specs/2026-10-07-session-health-design.md`

## Global Constraints

- Mod name: `session-health`. State plugin key: `'session-health'`.
- Location: `<repo>/session-health/` is the mod. `<repo>/.claude-plugin/marketplace.json` lists it with `"source": "./session-health"`.
- Hot reload: symlink `~/.claude/dev-mods/02a9ae84-4fd5-4616-b78f-3b9a46b403d2/session-health` → `<repo>/session-health`. If the engine doesn't follow the link, use `claude --plugin-dir <repo>/session-health` instead.
- Runtime: no DOM, no Node, no `import()`. Plugin files are imported with static `import`, and every file has a `.ts`/`.tsx` suffix.
- Elements come only from `$.ui.resolve(e)`. The band sizes itself to `e.props.bodyColumns`.
- Bar colors: `< 70%` → `#aaff00`; `70–89%` → `#ffb000`; `≥ 90%` → `#ff5f57`.
- Bar glyphs: fill `█` plus partials `▏▎▍▌▋▊▉`; empty track `░`. Full width is 10 cells; tier 3 uses 5.
- Labels: `CONTEXT` / `SESSION` / `WEEK`; short forms `ctx` / `5h` / `wk`.
- Verdict defaults: `heavyPct 45`, `compactPct 60`, `heavyTurns 8`, `compactTurns 4`, `freshCompactions 2`, `freshTurns 150`, `budgetWarnPct 90`.
- Budget toast steps: 75 and 90.
- Hand-off file: `<session root>/.claude/handoff.md`. It loads only if it's under 24h old and unconsumed, and loads once.
- Every hook ends in `next(e)` (except `command.run`, which answers its own command). Failures degrade the display; they never block the prompt.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The first turn of a session or right after `/clear`:** there's no history and `context.tokens` may be absent. The band should show `CONTEXT —` with no turns estimate and must not throw. (Pinned in Task 1 and Task 3 tests.)
2. **API-key users with an empty `rateLimits`:** the SESSION/WEEK meters should disappear and the verdict should never show a budget overlay. (Pinned in Task 1 and Task 3 tests.)
- 3. **Very narrow terminals (≤ 30 columns):** no line may ever be wider than `bodyColumns`, and buttons are dropped below 40. (Pinned in Task 3.)
- 4. **A `resetsAt` already in the past, or missing:** this shows `now` or nothing; never negative or `NaN` values. (Pinned in Task 2.)
- 5. **Pressing `[fresh start]` twice, or `/handoff` while a brief is being written:** the second request is ignored with a toast, not a second fork. (Pinned in Task 6.)

---

## File Structure

```
Claude Code Mods/                       (git repo root)
├── .claude-plugin/marketplace.json     Task 7
├── README.md                           Task 7
└── session-health/
    ├── .claude-plugin/plugin.json      Task 1 (userConfig added in Task 7)
    ├── hooks/
    │   ├── hooks.json                  Task 1
    │   ├── verdict.ts                  Task 1  pure: levels, turns-left, thresholds
    │   ├── meters.ts                   Task 2  pure: bars, colors, time, token text
    │   ├── layout.ts                   Task 3  pure: BandModel → segments per width tier
    │   ├── band.tsx                    Task 4  segments → elements
    │   ├── toasts.ts                   Task 5  pure: which toasts fire on a change
    │   ├── handoff.ts                  Task 6  pure: brief prompt, eligibility, compact instructions
    │   └── register.tsx                Task 4–6  wiring
    ├── types/index.d.ts                Task 4  PluginState contract
    └── tests/
        ├── verdict.test.ts             Task 1
        ├── meters.test.ts              Task 2
        ├── layout.test.ts              Task 3
        ├── band.test.tsx               Task 4
        ├── toasts.test.ts              Task 5
        └── handoff.test.ts             Task 6
```

The test commands below assume `M="$PWD/session-health"`, run from the repo root.

---

### Task 1: Scaffold + verdict engine

**Files:**
- Create: `session-health/.claude-plugin/plugin.json`, `session-health/hooks/hooks.json`, `session-health/hooks/register.tsx` (stub), `session-health/hooks/verdict.ts`
- Test: `session-health/tests/verdict.test.ts`

**Interfaces:**
- Produces:
  - `type Level = 'healthy' | 'heavy' | 'compact' | 'fresh'`
  - `type Thresholds = { heavyPct: number; compactPct: number; heavyTurns: number; compactTurns: number; freshCompactions: number; freshTurns: number; budgetWarnPct: number }`
  - `const DEFAULTS: Thresholds`
  - `type Window = { percent: number; resetsAt?: string }`
  - `type Budget = { kind: '5h' | 'wk'; percent: number; resetsAt?: string }`
  - `type VerdictInput = { percent?: number; turnsLeft?: number; compactions: number; turns: number; fiveHour?: Window; week?: Window }`
  - `type Verdict = { level: Level; budget?: Budget }`
  - `function turnsLeft(history: readonly number[], autoCompactAt: number): number | undefined`
  - `function verdict(input: VerdictInput, t?: Thresholds): Verdict`
  - `const LEVEL_RANK: Record<Level, number>` (healthy 0 … fresh 3)

- [ ] **Step 1: Scaffold the plugin and the symlink**

```bash
mkdir -p session-health/.claude-plugin session-health/hooks session-health/types session-health/tests
cat > session-health/.claude-plugin/plugin.json <<'EOF'
{
  "name": "session-health",
  "version": "0.1.0",
  "description": "Context, 5-hour and weekly usage meters above the prompt, with compact / fresh-start advice and auto-loading hand-offs.",
  "types": "./types/index.d.ts"
}
EOF
cat > session-health/hooks/hooks.json <<'EOF'
{ "modules": ["./register.tsx"] }
EOF
cat > session-health/types/index.d.ts <<'EOF'
declare module 'claude-code' {
  interface PluginState {
    'session-health': {}
  }
}
export {}
EOF
cat > session-health/hooks/register.tsx <<'EOF'
import type { Register } from 'claude-code'

export const register: Register = () => {}
EOF
ln -s "$PWD/session-health" ~/.claude/dev-mods/02a9ae84-4fd5-4616-b78f-3b9a46b403d2/session-health
```

- [ ] **Step 2: Write the failing tests**

`session-health/tests/verdict.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { DEFAULTS, turnsLeft, verdict } from '../hooks/verdict.ts'

const base = { compactions: 0, turns: 10 }

describe('turnsLeft', () => {
  test('undefined with fewer than 2 readings', () => {
    expect(turnsLeft([], 160_000)).toBe(undefined)
    expect(turnsLeft([50_000], 160_000)).toBe(undefined)
  })
  test('undefined when context never grew', () => {
    expect(turnsLeft([60_000, 60_000, 55_000], 160_000)).toBe(undefined)
  })
  test('averages the last 5 positive growths', () => {
    // growths: 10k,10k,10k,10k,10k → (160k-100k)/10k = 6
    expect(turnsLeft([50_000, 60_000, 70_000, 80_000, 90_000, 100_000], 160_000)).toBe(6)
  })
  test('ignores negative growth (a compaction) in the average', () => {
    // growths: +20k, -60k (ignored), +20k → avg 20k; (160k-60k)/20k = 5
    expect(turnsLeft([80_000, 100_000, 40_000, 60_000], 160_000)).toBe(5)
  })
  test('0 when already past the auto-compact point', () => {
    expect(turnsLeft([150_000, 170_000], 160_000)).toBe(0)
  })
})

describe('verdict levels', () => {
  test('healthy below every threshold', () => {
    expect(verdict({ ...base, percent: 30 }).level).toBe('healthy')
  })
  test('healthy when nothing is known (first turn)', () => {
    expect(verdict({ ...base }).level).toBe('healthy')
  })
  test('heavy at 45%', () => expect(verdict({ ...base, percent: 45 }).level).toBe('heavy'))
  test('heavy at <=8 turns left', () =>
    expect(verdict({ ...base, percent: 20, turnsLeft: 8 }).level).toBe('heavy'))
  test('compact at 60%', () => expect(verdict({ ...base, percent: 60 }).level).toBe('compact'))
  test('compact at <=4 turns left', () =>
    expect(verdict({ ...base, percent: 20, turnsLeft: 4 }).level).toBe('compact'))
  test('fresh when compact-worthy and compacted twice', () =>
    expect(verdict({ ...base, percent: 61, compactions: 2 }).level).toBe('fresh'))
  test('fresh when compact-worthy and over 150 turns', () =>
    expect(verdict({ ...base, percent: 61, turns: 151 }).level).toBe('fresh'))
  test('not fresh when compacted twice but light', () =>
    expect(verdict({ ...base, percent: 30, compactions: 2 }).level).toBe('healthy'))
  test('custom thresholds apply', () =>
    expect(verdict({ ...base, percent: 50 }, { ...DEFAULTS, compactPct: 50 }).level).toBe('compact'))
})

describe('budget overlay', () => {
  test('none when rate limits are absent', () =>
    expect(verdict({ ...base, percent: 10 }).budget).toBe(undefined))
  test('none below 90', () =>
    expect(verdict({ ...base, fiveHour: { percent: 89.9 }, week: { percent: 50 } }).budget).toBe(undefined))
  test('names the higher window', () =>
    expect(verdict({ ...base, fiveHour: { percent: 91 }, week: { percent: 95, resetsAt: 'X' } }).budget)
      .toEqual({ kind: 'wk', percent: 95, resetsAt: 'X' }))
  test('ties go to five-hour', () =>
    expect(verdict({ ...base, fiveHour: { percent: 92 }, week: { percent: 92 } }).budget?.kind).toBe('5h'))
  test('overlay is independent of level', () => {
    const v = verdict({ ...base, percent: 10, fiveHour: { percent: 90 } })
    expect(v.level).toBe('healthy')
    expect(v.budget?.kind).toBe('5h')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test "$M"`
Expected: FAIL — module `../hooks/verdict.ts` not found.

- [ ] **Step 4: Implement `verdict.ts`**

```ts
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
  return { level, budget: budgetOf(input, t) }
}

function budgetOf(input: VerdictInput, t: Thresholds): Budget | undefined {
  const five = input.fiveHour
  const week = input.week
  const fiveHot = five !== undefined && five.percent >= t.budgetWarnPct
  const weekHot = week !== undefined && week.percent >= t.budgetWarnPct
  if (!fiveHot && !weekHot) return undefined
  const pick: Budget =
    fiveHot && (!weekHot || five!.percent >= week!.percent)
      ? { kind: '5h', percent: five!.percent, resetsAt: five!.resetsAt }
      : { kind: 'wk', percent: week!.percent, resetsAt: week!.resetsAt }
  if (pick.resetsAt === undefined) delete pick.resetsAt
  return pick
}
```

- [ ] **Step 5: Run the tests to verify they pass, then validate**

Run: `claude plugin test "$M" && claude plugin validate "$M"`
Expected: all verdict tests PASS; validate reports no errors.

- [ ] **Step 6: Commit**

```bash
git add session-health
git commit -m "feat(session-health): scaffold plugin and verdict engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Meters (bars, colors, time, tokens)

**Files:**
- Create: `session-health/hooks/meters.ts`
- Test: `session-health/tests/meters.test.ts`

**Interfaces:**
- Produces:
  - `const LIME = '#aaff00'`, `AMBER = '#ffb000'`, `CORAL = '#ff5f57'`
  - `function barColor(percent: number): string`
  - `function bar(percent: number, cells: number): { filled: string; empty: string }`. `filled.length + empty.length === cells` always.
  - `function relTime(resetsAt: string | undefined, now: number): string | undefined`
  - `function kTokens(n: number): string`

- [ ] **Step 1: Write the failing tests**

`session-health/tests/meters.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { AMBER, CORAL, LIME, bar, barColor, kTokens, relTime } from '../hooks/meters.ts'

describe('barColor', () => {
  test('lime below 70', () => expect(barColor(69.9)).toBe(LIME))
  test('amber from 70', () => expect(barColor(70)).toBe(AMBER))
  test('amber through 89', () => expect(barColor(89.9)).toBe(AMBER))
  test('coral from 90', () => expect(barColor(90)).toBe(CORAL))
})

describe('bar', () => {
  test('empty at 0', () => expect(bar(0, 10)).toEqual({ filled: '', empty: '░'.repeat(10) }))
  test('full at 100', () => expect(bar(100, 10)).toEqual({ filled: '█'.repeat(10), empty: '' }))
  test('clamps above 100 and below 0', () => {
    expect(bar(140, 10).filled).toBe('█'.repeat(10))
    expect(bar(-5, 10).filled).toBe('')
  })
  test('58% of 10 cells is 5 full + ▊', () =>
    expect(bar(58, 10)).toEqual({ filled: '█████▊', empty: '░░░░' }))
  test('always exactly `cells` wide', () => {
    for (let p = 0; p <= 100; p += 0.7) {
      const b = bar(p, 10)
      expect(b.filled.length + b.empty.length).toBe(10)
      const s = bar(p, 5)
      expect(s.filled.length + s.empty.length).toBe(5)
    }
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  test('undefined when absent or unparsable', () => {
    expect(relTime(undefined, now)).toBe(undefined)
    expect(relTime('garbage', now)).toBe(undefined)
  })
  test('now when in the past', () => expect(relTime('2026-10-07T11:00:00Z', now)).toBe('now'))
  test('minutes under an hour', () => expect(relTime('2026-10-07T12:24:00Z', now)).toBe('24m'))
  test('hours+minutes under 48h', () => expect(relTime('2026-10-07T14:14:00Z', now)).toBe('2h14m'))
  test('days from 48h', () => expect(relTime('2026-10-10T13:00:00Z', now)).toBe('3d'))
})

describe('kTokens', () => {
  test('under 1000 raw', () => expect(kTokens(950)).toBe('950'))
  test('thousands', () => expect(kTokens(116_400)).toBe('116k'))
  test('millions', () => expect(kTokens(1_000_000)).toBe('1M'))
  test('fractional millions', () => expect(kTokens(1_500_000)).toBe('1.5M'))
})
```

Note on the 58% case: 58% × 10 cells × 8 = 46.4 eighths, which rounds to 46. That's 5 full cells (40 eighths) plus 6 eighths (`▊`), leaving 4 empty cells. The expected value is `'█████▊'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test "$M"`
Expected: FAIL — `../hooks/meters.ts` not found.

- [ ] **Step 3: Implement `meters.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test "$M"`
Expected: verdict and meters tests PASS.

- [ ] **Step 5: Commit**

```bash
git add session-health
git commit -m "feat(session-health): meter glyphs, colors and time formatting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Layout — the band model and width tiers

**Files:**
- Create: `session-health/hooks/layout.ts`
- Test: `session-health/tests/layout.test.ts`

**Interfaces:**
- Consumes: `Level`, `Budget`, `Window` from `verdict.ts`; `bar`, `barColor`, `relTime`, `kTokens`, `LIME`, `AMBER`, `CORAL` from `meters.ts`.
- Produces:
  - `type Phase = 'idle' | 'compacting' | 'writing' | 'ready' | 'resumed'`
  - `type BandModel = { percent?: number; tokens?: number; window: number; turnsLeft?: number; compactions: number; fiveHour?: Window; week?: Window; level: Level; budget?: Budget; phase: Phase; phaseAt?: number; now: number }`
  - `type Segment = { text: string; color?: string; dim?: boolean; bold?: boolean }`
  - `type Action = 'compact' | 'fresh'`
  - `type Line2 = { segments: Segment[]; actions: Action[] }`
  - `function width(segments: readonly Segment[]): number`
  - `function line1(m: BandModel, tier: number): Segment[]` (tiers 0–5)
  - `function fitLine1(m: BandModel, columns: number): Segment[]`
  - `function line2(m: BandModel, columns: number): Line2 | undefined` (undefined means a 1-line band)
  - `const LEVEL_ICON: Record<Level, string>`, `LEVEL_COLOR: Record<Level, string>`

- [ ] **Step 1: Write the failing tests**

`session-health/tests/layout.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { fitLine1, line1, line2, width, type BandModel } from '../hooks/layout.ts'

const now = Date.parse('2026-10-07T12:00:00Z')
const full: BandModel = {
  percent: 58, tokens: 116_000, window: 200_000, turnsLeft: 14, compactions: 1,
  fiveHour: { percent: 31, resetsAt: '2026-10-07T14:14:00Z' },
  week: { percent: 64, resetsAt: '2026-10-10T13:00:00Z' },
  level: 'healthy', phase: 'idle', now,
}
const text = (s: { text: string }[]) => s.map(x => x.text).join('')

describe('line1 tiers', () => {
  test('tier 0 has everything', () => {
    const t = text(line1(full, 0))
    expect(t).toContain('CONTEXT')
    expect(t).toContain('116k/200k')
    expect(t).toContain('~14 turns')
    expect(t).toContain('⟲1')
    expect(t).toContain('SESSION')
    expect(t).toContain('2h14m')
    expect(t).toContain('WEEK')
    expect(t).toContain('3d')
  })
  test('tier 1 drops token counts', () => expect(text(line1(full, 1))).not.toContain('116k'))
  test('tier 2 uses short labels', () => {
    const t = text(line1(full, 2))
    expect(t).toContain('ctx')
    expect(t).not.toContain('CONTEXT')
  })
  test('tier 4 has no bar glyphs', () => expect(text(line1(full, 4))).not.toMatch(/[█░]/))
  test('tier 5 is minimal', () => expect(text(line1(full, 5))).toBe(' 58% · 31% · 64% ●'))
})

describe('fitLine1 never overflows', () => {
  for (const cols of [200, 120, 100, 80, 60, 40, 30]) {
    test(`fits ${cols} columns or is the minimal tier`, () => {
      const segs = fitLine1(full, cols)
      expect(width(segs) <= cols || text(segs) === text(line1(full, 5))).toBe(true)
    })
  }
  test('picks the widest tier that fits', () =>
    expect(text(fitLine1(full, 200))).toBe(text(line1(full, 0))))
})

describe('missing data', () => {
  test('no rate limits → no SESSION/WEEK', () => {
    const t = text(line1({ ...full, fiveHour: undefined, week: undefined }, 0))
    expect(t).not.toContain('SESSION')
    expect(t).not.toContain('WEEK')
  })
  test('no percent → CONTEXT —', () => {
    const t = text(line1({ ...full, percent: undefined, tokens: undefined, turnsLeft: undefined }, 0))
    expect(t).toContain('CONTEXT —')
  })
  test('no turns estimate → shows —', () =>
    expect(text(line1({ ...full, turnsLeft: undefined }, 0))).toContain('~— turns'))
  test('⟲ hidden at 0 compactions', () =>
    expect(text(line1({ ...full, compactions: 0 }, 0))).not.toContain('⟲'))
})

describe('line2', () => {
  test('absent when healthy, idle, no budget', () => expect(line2(full, 120)).toBe(undefined))
  test('heavy offers compact only', () => {
    const l = line2({ ...full, level: 'heavy', turnsLeft: 6 }, 120)!
    expect(text(l.segments)).toContain('getting heavy')
    expect(l.actions).toEqual(['compact'])
  })
  test('compact offers both', () =>
    expect(line2({ ...full, level: 'compact', turnsLeft: 3 }, 120)!.actions).toEqual(['compact', 'fresh']))
  test('fresh offers fresh only', () => {
    const l = line2({ ...full, level: 'fresh', compactions: 2 }, 120)!
    expect(text(l.segments)).toContain('compacted 2×')
    expect(l.actions).toEqual(['fresh'])
  })
  test('budget overlays a healthy verdict', () => {
    const l = line2({ ...full, budget: { kind: '5h', percent: 92, resetsAt: '2026-10-07T12:24:00Z' } }, 120)!
    expect(text(l.segments)).toContain('⚠ 5h budget 92% — resets in 24m, pace yourself')
  })
  test('writing hides buttons', () =>
    expect(line2({ ...full, level: 'compact', phase: 'writing' }, 120)!.actions).toEqual([]))
  test('resumed shows age', () =>
    expect(text(line2({ ...full, phase: 'resumed', phaseAt: now - 12 * 60_000 }, 120)!.segments))
      .toContain('↪ resumed from hand-off (12m ago)'))
  test('buttons dropped under 40 columns', () =>
    expect(line2({ ...full, level: 'compact' }, 39)!.actions).toEqual([]))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test "$M"`
Expected: FAIL — `../hooks/layout.ts` not found.

- [ ] **Step 3: Implement `layout.ts`**

```ts
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
  const rel = relTime(w.resetsAt, now)
  if (rel !== undefined) out.push({ text: cells > 0 ? ` · ${rel}` : ` ${rel}`, dim: true })
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
    if (m.compactions > 0) out.push({ text: ` ⟲${m.compactions}`, dim: true })
  }

  const sep = o.cells > 0 ? GAP : ' · '
  if (m.fiveHour) out.push({ text: sep }, ...windowMeter(o.short ? '5h' : 'SESSION', m.fiveHour, o.cells, m.now))
  if (m.week) out.push({ text: sep }, ...windowMeter(o.short ? 'wk' : 'WEEK', m.week, o.cells, m.now))
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
  return { segments, actions: columns < 40 ? [] : actions }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test "$M"`
Expected: all layout tests PASS. If `tier 5 is minimal` fails on spacing, check the minimal format against the spec's `58% · 31% · 64% ●` and fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add session-health
git commit -m "feat(session-health): band layout with width tiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: State contract, measuring, and drawing the band

**Files:**
- Modify: `session-health/types/index.d.ts` (whole file)
- Create: `session-health/hooks/band.tsx`
- Modify: `session-health/hooks/register.tsx` (whole file)
- Test: `session-health/tests/band.test.tsx`

**Interfaces:**
- Consumes: everything in Tasks 1–3.
- Produces (in `types/index.d.ts`):
  - `type Snapshot = { percent?: number; tokens?: number; window: number; autoCompactAt: number; fiveHour?: Window; week?: Window }`
  - `type HandoffPhase = { phase: Phase; at?: number }`
  - `PluginState['session-health'] = { snapshot: Snapshot | null; history: number[]; compactions: number; turns: number; handoff: HandoffPhase; toasted: ToastMemory }`
  - `type ToastMemory = { level: Level; budget: Record<string, number> }` (budget key: `kind|resetsAt` → highest step toasted)
- Produces (in `register.tsx`): the atoms `snapshot`, `history`, `compactions`, `turns`, `handoff` and `toasted`, plus `function modelOf(...)`. Later tasks add hooks in the same file.
- Produces (in `band.tsx`): `function Band(props: { el: Elements; line1: Segment[]; line2?: Line2; onAction: (a: Action) => void }): JSX.Element`, where `Elements` is the `$.ui.resolve(e)` return type.

- [ ] **Step 1: Write the state contract**

`session-health/types/index.d.ts`:

```ts
export type Level = 'healthy' | 'heavy' | 'compact' | 'fresh'
export type Phase = 'idle' | 'compacting' | 'writing' | 'ready' | 'resumed'
export type Window = { percent: number; resetsAt?: string }

export type Snapshot = {
  percent?: number
  tokens?: number
  window: number
  autoCompactAt: number
  fiveHour?: Window
  week?: Window
}

export type HandoffPhase = { phase: Phase; at?: number }
export type ToastMemory = { level: Level; budget: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'session-health': {
      snapshot: Snapshot | null
      history: number[]
      compactions: number
      turns: number
      handoff: HandoffPhase
      toasted: ToastMemory
    }
  }
}
```

(`verdict.ts` and `layout.ts` keep their own structurally identical `Level`/`Window`/`Phase` types. They stay `$`-free on purpose, and TypeScript's structural typing makes the two sets interchangeable.)

- [ ] **Step 2: Write the failing band test**

`session-health/tests/band.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 9 } },
}

test('band draws on terminal and desktop with no measurement yet', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-health', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band yields to a survey', async $ => {
  const ui = await $.ui.mount({
    plugin: 'session-health', surface: 'terminal', ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  } as never)
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBe(undefined)
  await ui.unmount()
})
```

Before running, check `RenderPropsOf['AbovePrompt']` in `.claude-plugin/types/claude-code/index.d.ts` (this file appears once the mod has loaded). Make `BAND.props` match it exactly, then remove the `as never` casts. The engine lays this file down, so it is authoritative.

- [ ] **Step 3: Run the test to verify it fails**

Run: `claude plugin test "$M"`
Expected: FAIL — no `Text` matching `/CONTEXT/` (the stub draws nothing).

- [ ] **Step 4: Implement `band.tsx`**

```tsx
import type { EngineInterface } from 'claude-code'
import type { Action, Line2, Segment } from './layout.ts'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const seg = (Text: Elements['Text'], s: Segment, i: number) => (
  <Text key={`s${i}`} color={s.color} dimColor={s.dim} bold={s.bold}>
    {s.text}
  </Text>
)

export function Band(props: {
  el: Elements
  line1: Segment[]
  line2?: Line2
  onAction: (a: Action) => void
}) {
  const { Box, Text, Button } = props.el
  return (
    <Box flexDirection="column">
      <Box>
        <Text wrap="truncate-end">{props.line1.map((s, i) => seg(Text, s, i))}</Text>
      </Box>
      {props.line2 && (
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Text wrap="truncate-end">{props.line2.segments.map((s, i) => seg(Text, s, i))}</Text>
          </Box>
          {props.line2.actions.includes('compact') && (
            <Button key="compact" label="compact" onPress={() => props.onAction('compact')} />
          )}
          {props.line2.actions.includes('fresh') && (
            <Button key="fresh" label="fresh start" variant="primary" onPress={() => props.onAction('fresh')} />
          )}
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 5: Implement `register.tsx` (measure + render)**

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { HandoffPhase, Snapshot, ToastMemory } from '../types'
import { Band } from './band.tsx'
import { fitLine1, line2, type Action, type BandModel } from './layout.ts'
import { DEFAULTS, turnsLeft, verdict, type Thresholds } from './verdict.ts'

type $ = EngineInterface
const P = 'session-health'

export const snapshot = atom({ plugin: P, key: 'snapshot' } as const, null as Snapshot | null)
export const history = atom({ plugin: P, key: 'history' } as const, [] as number[])
export const compactions = atom({ plugin: P, key: 'compactions' } as const, 0)
export const turns = atom({ plugin: P, key: 'turns' } as const, 0)
export const handoff = atom({ plugin: P, key: 'handoff' } as const, { phase: 'idle' } as HandoffPhase)
export const toasted = atom({ plugin: P, key: 'toasted' } as const, { level: 'healthy', budget: {} } as ToastMemory)

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

export async function record($: $, m: Measured) {
  const win = (kind: string) => {
    const r = m.rateLimits.find(x => x.kind === kind)
    return r ? { percent: r.percentUsed, resetsAt: r.resetsAt } : undefined
  }
  const snap: Snapshot = {
    percent: m.context.percent,
    tokens: m.context.tokens,
    window: m.context.window,
    autoCompactAt: await autoCompactAt($, m.context.window),
    fiveHour: win('five_hour'),
    week: win('seven_day'),
  }
  await update($, snapshot, () => snap)
  const n = await $.session.turns()
  await update($, turns, () => n)
}

export async function modelOf($: $, t: Thresholds): Promise<BandModel> {
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
      const u = await $.session.usage()
      await record($, u)
    } catch {}
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await record($, e)
    const tokens = e.context.tokens
    if (tokens !== undefined) {
      await update($, history, h => (h[h.length - 1] === tokens ? h : [...h, tokens].slice(-8)))
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

// Task 5 and Task 6 replace this.
async function onAction(_$: $, _a: Action) {}
```

Notes for the implementer:
- `session.measure` also fires when a rate-limit window moves, without a new turn. The "differs from the last entry" check keeps those events from adding duplicate readings to the history.
- `$.session.usage()` returns `{ context, rateLimits, ... }`, the same shape as `Measured`.

- [ ] **Step 6: Type-check, validate, test**

Run: `tsc -p "$M" && claude plugin validate "$M" && claude plugin test "$M"`
Expected: no type errors, validate lists hooks `session.start`, `session.measure`, `ui.render`, and all tests PASS.

- [ ] **Step 7: Manual check**

End the turn so the mod hot-reloads. The band should appear above the prompt showing `CONTEXT … SESSION … WEEK …`. Send one prompt and confirm the context % changes. Resize the terminal narrower and confirm it steps down through the tiers without wrapping.

- [ ] **Step 8: Commit**

```bash
git add session-health
git commit -m "feat(session-health): measure session and draw band above prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Toasts, compaction count, smart compact

**Files:**
- Create: `session-health/hooks/toasts.ts`
- Modify: `session-health/hooks/handoff.ts` (create here with just `COMPACT_INSTRUCTIONS`; Task 6 extends it)
- Modify: `session-health/hooks/register.tsx`
- Test: `session-health/tests/toasts.test.ts`

**Interfaces:**
- Consumes: `Level`, `LEVEL_RANK`, `Verdict` from `verdict.ts`; `ToastMemory` from `types`.
- Produces:
  - `function toastsFor(prev: ToastMemory, v: { level: Level; fiveHour?: Window; week?: Window }): { messages: string[]; memory: ToastMemory }`
  - `const COMPACT_INSTRUCTIONS: string` (in `handoff.ts`)

- [ ] **Step 1: Write the failing tests**

`session-health/tests/toasts.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { toastsFor } from '../hooks/toasts.ts'

const fresh = { level: 'healthy' as const, budget: {} }

describe('level toasts', () => {
  test('escalation toasts once', () => {
    const a = toastsFor(fresh, { level: 'compact' })
    expect(a.messages).toEqual(['◑ Compact now — context is filling up'])
    const b = toastsFor(a.memory, { level: 'compact' })
    expect(b.messages).toEqual([])
  })
  test('de-escalation is silent and resets', () => {
    const a = toastsFor({ level: 'compact', budget: {} }, { level: 'healthy' })
    expect(a.messages).toEqual([])
    expect(toastsFor(a.memory, { level: 'heavy' }).messages.length).toBe(1)
  })
  test('healthy never toasts', () => expect(toastsFor(fresh, { level: 'healthy' }).messages).toEqual([]))
})

describe('budget toasts', () => {
  const w = (percent: number) => ({ percent, resetsAt: 'R1' })
  test('75 then 90, each once', () => {
    const a = toastsFor(fresh, { level: 'healthy', fiveHour: w(76) })
    expect(a.messages).toEqual(['5-hour budget at 76%'])
    const b = toastsFor(a.memory, { level: 'healthy', fiveHour: w(80) })
    expect(b.messages).toEqual([])
    const c = toastsFor(b.memory, { level: 'healthy', fiveHour: w(91) })
    expect(c.messages).toEqual(['⚠ 5-hour budget at 91% — pace yourself'])
  })
  test('a new reset window toasts again', () => {
    const a = toastsFor(fresh, { level: 'healthy', week: w(76) })
    const b = toastsFor(a.memory, { level: 'healthy', week: { percent: 77, resetsAt: 'R2' } })
    expect(b.messages).toEqual(['Weekly budget at 77%'])
  })
  test('jumping straight past 90 toasts only the 90 message', () =>
    expect(toastsFor(fresh, { level: 'healthy', week: w(95) }).messages)
      .toEqual(['⚠ Weekly budget at 95% — pace yourself']))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test "$M"`
Expected: FAIL — `../hooks/toasts.ts` not found.

- [ ] **Step 3: Implement `toasts.ts`**

```ts
import type { Level, Window } from './verdict.ts'
import { LEVEL_RANK } from './verdict.ts'

export type ToastMemory = { level: Level; budget: Record<string, number> }

const LEVEL_MESSAGE: Record<Level, string> = {
  healthy: '',
  heavy: '◐ Getting heavy — consider /compact at a natural break',
  compact: '◑ Compact now — context is filling up',
  fresh: '✦ Start fresh — use [fresh start] to write a hand-off',
}

const STEPS = [75, 90] as const

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
    const step = [...STEPS].reverse().find(s => w.percent >= s)
    if (step === undefined || (budget[key] ?? 0) >= step) return
    budget[key] = step
    const pct = Math.round(w.percent)
    messages.push(step >= 90 ? `⚠ ${name} budget at ${pct}% — pace yourself` : `${name} budget at ${pct}%`)
  }
  check('5-hour', v.fiveHour)
  check('Weekly', v.week)

  return { messages, memory: { level: v.level, budget } }
}
```

Note: the memory's `level` always becomes the current level. That's how a de-escalation resets the tracker.

- [ ] **Step 4: Create `handoff.ts` with the compact instructions**

```ts
export const COMPACT_INSTRUCTIONS =
  'Preserve: the current goal and acceptance criteria; open tasks and their status; key decisions and the reasons for them; ' +
  'files created or modified and their purpose; unresolved errors or blockers; exact names of functions, commands and paths in play. ' +
  'Drop: exploratory dead ends, verbose tool output, superseded plans.'
```

- [ ] **Step 5: Wire toasts, compaction counting, `/clear` reset and the compact button into `register.tsx`**

Add these imports:

```tsx
import { toastsFor } from './toasts.ts'
import { COMPACT_INSTRUCTIONS } from './handoff.ts'
```

Add `notify` as a module-level function:

```tsx
async function notify($: $, t: Thresholds) {
  const m = await modelOf($, t)
  const prev = await read($, toasted)
  const { messages, memory } = toastsFor(prev, { level: m.level, fiveHour: m.fiveHour, week: m.week })
  await update($, toasted, () => memory)
  for (const msg of messages) $.ui.toast(msg)
}
```

In `session.measure`, call `await notify($, t)` after the history update, just before `return next(e)`.

Add these hooks inside `register`:

```tsx
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.trigger !== 'precompute' && !('skip' in r && r.skip)) {
      await update($, compactions, n => n + 1)
      await update($, history, () => [])
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, compactions, () => 0)
      await update($, history, () => [])
      await update($, toasted, () => ({ level: 'healthy', budget: {} }))
    }
    return next(e)
  })
```

Replace the `onAction` stub:

```tsx
async function onAction($: $, a: Action) {
  if (a === 'compact') return compactNow($)
  return startHandoff($) // Task 6
}

async function compactNow($: $) {
  await update($, handoff, () => ({ phase: 'compacting' }))
  try {
    const r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
    if ('skip' in r && r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
  } catch (err) {
    $.ui.toast(`Compact failed: ${String(err)}`)
  } finally {
    await update($, handoff, () => ({ phase: 'idle' }))
  }
}

async function startHandoff(_$: $) {} // Task 6 replaces this
```

`$.session.compact` raises `session.compact` with `trigger: 'plugin'`. That runs through our own hook, so the ⟲ count goes up exactly once.

- [ ] **Step 6: Test, type-check, validate**

Run: `claude plugin test "$M" && tsc -p "$M" && claude plugin validate "$M"`
Expected: all PASS; validate additionally lists `session.compact` and `session.end`.

- [ ] **Step 7: Manual check**

Set `compactPct` to 1 via `/config` (or temporarily in the code). Confirm the band goes to 2 lines with `[compact] [fresh start]` and that exactly one toast appears. Press `[compact]` and confirm `⟲ compacting…`, then `⟲1`, then the band returning to healthy. Revert the threshold.

- [ ] **Step 8: Commit**

```bash
git add session-health
git commit -m "feat(session-health): escalation toasts, compaction count, smart compact button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hand-off — write, command, auto-load

**Files:**
- Modify: `session-health/hooks/handoff.ts`
- Modify: `session-health/hooks/register.tsx`
- Test: `session-health/tests/handoff.test.ts`

**Interfaces:**
- Produces in `handoff.ts`:
  - `type HandoffRecord = { path: string; writtenAt: number; sessionId: string; consumed: boolean }`
  - `const MAX_AGE_MS = 24 * 60 * 60 * 1000`
  - `function briefPrompt(project: string, stamp: string): string`
  - `function handoffPath(root: string): string` → `${root}/.claude/handoff.md`
  - `function storeKey(root: string): string` → `handoff:${root}`
  - `function shouldLoad(rec: HandoffRecord | undefined, now: number, turnsSoFar: number): boolean`
  - `function injection(brief: string): string`
  - `function transcriptPrompt(messages: readonly { role: string; text: string }[]): string` (the fallback when there's nothing to fork)

- [ ] **Step 1: Write the failing tests**

`session-health/tests/handoff.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { MAX_AGE_MS, briefPrompt, handoffPath, injection, shouldLoad, transcriptPrompt } from '../hooks/handoff.ts'

const now = 1_800_000_000_000
const rec = { path: '/p/.claude/handoff.md', writtenAt: now - 60_000, sessionId: 's1', consumed: false }

describe('shouldLoad', () => {
  test('loads a fresh unconsumed brief on the first prompt', () => expect(shouldLoad(rec, now, 0)).toBe(true))
  test('not after the first turn', () => expect(shouldLoad(rec, now, 1)).toBe(false))
  test('not when consumed', () => expect(shouldLoad({ ...rec, consumed: true }, now, 0)).toBe(false))
  test('not when older than 24h', () =>
    expect(shouldLoad({ ...rec, writtenAt: now - MAX_AGE_MS - 1 }, now, 0)).toBe(false))
  test('not when there is none', () => expect(shouldLoad(undefined, now, 0)).toBe(false))
})

describe('text', () => {
  test('path is under .claude', () => expect(handoffPath('/a/b')).toBe('/a/b/.claude/handoff.md'))
  test('prompt names every section', () => {
    const p = briefPrompt('proj', '2026-10-07 14:32')
    for (const h of ['# Hand-off — proj — 2026-10-07 14:32', '## Goal', '## Current state', '## Decisions (and why)',
      '## Files touched', '## Next steps', '## Gotchas']) expect(p).toContain(h)
    expect(p).toContain('600 words')
  })
  test('injection frames the brief', () =>
    expect(injection('BODY')).toBe('Hand-off from the previous session:\n\nBODY'))
  test('transcript fallback keeps the newest messages within budget', () => {
    const msgs = Array.from({ length: 500 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i} ` + 'x'.repeat(500) }))
    const p = transcriptPrompt(msgs)
    expect(p).toContain('m499')
    expect(p.length).toBeLessThan(130_000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test "$M"`
Expected: FAIL — `briefPrompt` (and the others) are not exported.

- [ ] **Step 3: Extend `handoff.ts`**

Append below `COMPACT_INSTRUCTIONS`:

```ts
export type HandoffRecord = { path: string; writtenAt: number; sessionId: string; consumed: boolean }

export const MAX_AGE_MS = 24 * 60 * 60 * 1000
const TRANSCRIPT_BUDGET = 120_000

export const handoffPath = (root: string) => `${root}/.claude/handoff.md`
export const storeKey = (root: string) => `handoff:${root}`

export function briefPrompt(project: string, stamp: string): string {
  return [
    'Write a hand-off brief so a brand-new Claude Code session can continue this work without re-reading the codebase.',
    'Use only what this conversation established. Be concrete: exact file paths, function names, commands, error messages.',
    'Output Markdown only, under 600 words, with exactly these headings in this order:',
    '',
    `# Hand-off — ${project} — ${stamp}`,
    '## Goal',
    '## Current state',
    '## Decisions (and why)',
    '## Files touched',
    '## Next steps',
    '## Gotchas',
  ].join('\n')
}

export function transcriptPrompt(messages: readonly { role: string; text: string }[]): string {
  const lines: string[] = []
  let size = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `${messages[i]!.role.toUpperCase()}: ${messages[i]!.text}`
    if (size + line.length > TRANSCRIPT_BUDGET) break
    lines.unshift(line)
    size += line.length
  }
  return `<transcript>\n${lines.join('\n\n')}\n</transcript>\n\n`
}

export function shouldLoad(rec: HandoffRecord | undefined, now: number, turnsSoFar: number): boolean {
  return rec !== undefined && !rec.consumed && turnsSoFar === 0 && now - rec.writtenAt <= MAX_AGE_MS
}

export const injection = (brief: string) => `Hand-off from the previous session:\n\n${brief}`
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test "$M"`
Expected: handoff tests PASS.

- [ ] **Step 5: Wire the hand-off into `register.tsx`**

Extend the `handoff.ts` import:

```tsx
import {
  COMPACT_INSTRUCTIONS, briefPrompt, handoffPath, injection, shouldLoad, storeKey, transcriptPrompt,
  type HandoffRecord,
} from './handoff.ts'
```

Replace the `startHandoff` stub:

```tsx
async function startHandoff($: $) {
  const current = await read($, handoff)
  if (current.phase === 'writing') {
    $.ui.toast('A hand-off is already being written')
    return
  }
  await update($, handoff, () => ({ phase: 'writing' }))
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
    await update($, handoff, () => ({ phase: 'ready', at: rec.writtenAt }))
    $.ui.toast('Hand-off ready — run /clear')
  } catch (err) {
    await update($, handoff, () => ({ phase: 'idle' }))
    $.ui.toast(`Hand-off failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

Add the command and the load-once hook inside `register`. Merge the command registration into the existing `session.start` hook, before `return next(e)`:

```tsx
    await $.command.register({ name: 'handoff', description: 'Write a hand-off brief for a fresh session' })
```

```tsx
  on('command.run', { command: 'handoff' }, async $ => {
    await startHandoff($)
    const ho = await read($, handoff)
    return { text: ho.phase === 'ready' ? 'Hand-off written to .claude/handoff.md — run /clear to start fresh.' : 'Hand-off not written (see toast).' }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const root = await $.session.root()
      const rec = (await $.store.get(storeKey(root))) as HandoffRecord | undefined
      const now = await $.clock.now()
      if (shouldLoad(rec, now, await $.session.turns()) && rec!.sessionId !== (await $.session.id())) {
        const brief = await $.fs.read(rec!.path)
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: injection(brief) }] } })
        await $.store.set(storeKey(root), { ...rec!, consumed: true })
        await update($, handoff, () => ({ phase: 'resumed', at: rec!.writtenAt }))
      }
    } catch {
      $.ui.status('session-health: hand-off not loaded')
    }
    return next(e)
  })
```

Clear `resumed` after the first turn of the new conversation. In `session.measure`, before `notify`:

```tsx
    const ho = await read($, handoff)
    if (ho.phase === 'resumed' && (await $.session.turns()) >= 1) await update($, handoff, () => ({ phase: 'idle' }))
```

Keep `ready` showing until `/clear`. In the `session.end` hook's `clear` branch (Task 5), add:

```tsx
      await update($, handoff, h => (h.phase === 'ready' ? { phase: 'idle' } : h))
```

The next prompt's load hook then moves the phase to `resumed`.

Notes for the implementer:
- `$.session.id()` changes after `/clear`. The `sessionId !==` guard stops a brief from loading back into the same conversation that wrote it. If `/clear` turns out to keep the same id in this build (check by logging both ids with `$.ui.log`), drop the guard and rely on `turns === 0` alone.
- `$.model.complete` takes `{ model, prompt }`; confirm the field names against `ModelCompleteRequest` in the laid types. `$.session.messages()` returns `{ role, text, toolUses }[]`.
- `$.session.append`'s `content` block shape is `{ type: 'text', text }`; confirm it against `SessionAppendArgs`.

- [ ] **Step 6: Test, type-check, validate**

Run: `claude plugin test "$M" && tsc -p "$M" && claude plugin validate "$M"`
Expected: all PASS. Validate lists `command.run` as "answers its own command: handoff" and `prompt.submit` as a gating hook. That's expected: the hook never refuses and always calls `next`.

- [ ] **Step 7: Manual end-to-end check**

1. Have a short conversation, then run `/handoff`. You should see `✎ writing hand-off…`, then `✓ hand-off ready — run /clear` and a toast. Check that `.claude/handoff.md` exists with all seven headings.
2. Press `[fresh start]` twice quickly. Expected: the second press shows the toast "A hand-off is already being written".
3. Run `/clear` and type `what were we doing?`. The band should show `↪ resumed from hand-off (Nm ago)` and Claude's answer should reflect the brief.
4. Run `/clear` again and ask the same question. Expected: no hand-off, because each brief loads once.

- [ ] **Step 8: Commit**

```bash
git add session-health
git commit -m "feat(session-health): hand-off brief via fork, /handoff command, load-once injection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings, README, marketplace

**Files:**
- Modify: `session-health/.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`, `README.md`

- [ ] **Step 1: Add `userConfig` to `plugin.json`**

```json
{
  "name": "session-health",
  "version": "0.1.0",
  "description": "Context, 5-hour and weekly usage meters above the prompt, with compact / fresh-start advice and auto-loading hand-offs.",
  "types": "./types/index.d.ts",
  "userConfig": {
    "heavyPct":         { "type": "number", "title": "Getting-heavy at context %",        "default": 45 },
    "compactPct":       { "type": "number", "title": "Compact-now at context %",          "default": 60 },
    "heavyTurns":       { "type": "number", "title": "Getting-heavy at turns left",       "default": 8 },
    "compactTurns":     { "type": "number", "title": "Compact-now at turns left",         "default": 4 },
    "freshCompactions": { "type": "number", "title": "Start-fresh after N compactions",   "default": 2 },
    "freshTurns":       { "type": "number", "title": "Start-fresh after N turns",         "default": 150 },
    "budgetWarnPct":    { "type": "number", "title": "Budget warning at %",               "default": 90 }
  }
}
```

Run: `claude plugin validate "$M"`. If it rejects a field key (for example, if it wants `description` rather than `title`), fix the keys to match what validate asks for.

- [ ] **Step 2: Add a test that options reach the verdict**

Append to `session-health/tests/band.test.tsx`:

```tsx
test('userConfig thresholds load with defaults', { options: { compactPct: 50 } }, async $ => {
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
  await ui.unmount()
})
```

Run: `claude plugin test "$M"`
Expected: PASS (the module loads with a custom option).

- [ ] **Step 3: Marketplace file and README**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "session-health",
  "owner": { "name": "Jack Halperin" },
  "plugins": [{ "name": "session-health", "source": "./session-health" }]
}
```

`README.md`:

````markdown
# session-health

A Claude Code mod that keeps an eye on your session from a band above the prompt:

```
 CONTEXT ███████▌░░ 75% 150k/200k ~3 turns ⟲2    SESSION ███▎░░░░░░ 31% · 2h14m   WEEK ██████▍░░░ 64% · 3d
 ◑ compact now — auto-compact in ~3 turns                                         [compact] [fresh start]
```

- **Meters** for the context window, the 5-hour session budget and the weekly budget. They're lime (`#aaff00`), turn amber at 70% and coral at 90%.
- **A verdict** for each situation: healthy → getting heavy → compact now → start fresh. It's based on context %, turns until auto-compact and how many times you've compacted.
- **`[compact]`** runs a smart compact that keeps your goal, tasks, decisions and files.
- **`[fresh start]` / `/handoff`** writes `.claude/handoff.md` in the background. Run `/clear` and the next conversation starts already briefed.

## Install

```
/plugin install session-health --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Change these in `/config`: `heavyPct` (45), `compactPct` (60), `heavyTurns` (8), `compactTurns` (4), `freshCompactions` (2), `freshTurns` (150), `budgetWarnPct` (90).

The SESSION/WEEK meters appear only on a Claude subscription; API-key sessions show the context meter alone.
````

- [ ] **Step 4: Full verification**

Run: `claude plugin validate "$PWD" && claude plugin validate "$M" && tsc -p "$M" && claude plugin test "$M"`
Expected: the marketplace and the plugin both validate, there are no type errors, and all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin README.md session-health
git commit -m "feat(session-health): user settings, README, marketplace manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 layout → Task 3 + 4. §2.2 meters → Task 2. §2.3 tiers → Task 3. §3 data → Task 4. §4 verdict and config → Task 1 + 7. §5 toasts → Task 5. §6.1 compact → Task 5. §6.2 and §6.3 hand-off → Task 6. §7 layout → File Structure. §8 errors → try/catch in Tasks 4–6. §9 tests → each task. §10 sharing → Task 7.
- **Deviations from the spec (both deliberate):** (1) The mod lives in the repo and is symlinked into dev-mods, rather than being copied out later. (2) The compaction count resets on `session.end` with `reason: 'clear'`, because the reference confirms `/clear` raises `session.end` and not `session.start`.
- **Points to confirm against the laid types during execution:** these are flagged inline where they occur: the `AbovePrompt` mount props, the `ModelCompleteRequest` fields, the `SessionAppendArgs` block shape, and the `userConfig` field keys.

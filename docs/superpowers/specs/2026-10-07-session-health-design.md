# session-health — Design Spec

**Date:** 2026-10-07
**Status:** Awaiting review
**Kind:** Claude Code mod (hooks-module plugin), shared on GitHub as a marketplace repo

## 1. Purpose

A band above the prompt that shows, at a glance, how loaded the current Claude Code session is: context window, 5-hour session budget and weekly budget. It also says in plain words when to keep going, compact, or start a fresh session, so Claude stays sharp. When a fresh start is the right call, it writes a hand-off brief that the next session loads automatically. That way the new session doesn't have to re-read the codebase.

### Success criteria

- The band is always visible above the prompt and never forces horizontal scrolling at any terminal width.
- The verdict matches the threshold table in §4 for any given set of measurements.
- One click compacts (smart) or produces a hand-off brief. After `/clear`, the brief reaches the new conversation without the user doing anything.
- Toasts fire once per escalation and never repeat.

### Out of scope (YAGNI)

History charts, a side pane, cost display, multiple hand-off history files.

## 2. The band

Rendered by a `ui.render` hook on `{ component: 'AbovePrompt' }`.

### 2.1 Layout (adaptive height)

**1 line — healthy, nothing to act on:**

```
 CONTEXT ██████▌░░░ 58% 116k/200k ~14 turns ⟲1   SESSION ███▎░░░░░░ 31% · 2h14m   WEEK ██████▍░░░ 64% · 3d
```

**2 lines — whenever the verdict is not `healthy`, a budget warning is active, a hand-off is being written, or a hand-off was just resumed:**

```
 CONTEXT ███████▌░░ 75% 150k/200k ~3 turns ⟲2    SESSION ███▎░░░░░░ 31% · 2h14m   WEEK ██████▍░░░ 64% · 3d
 ◑ compact now — auto-compact in ~3 turns                                         [compact] [fresh start]
```

Line-2 states (left side):

| State | Text |
|---|---|
| getting heavy | `◐ getting heavy — /compact at a natural break (~N turns left)` |
| compact now | `◑ compact now — auto-compact in ~N turns` |
| start fresh | `✦ start fresh — compacted N× already, quality drops` |
| budget overlay | `⚠ 5h budget 92% — resets in 24m, pace yourself` (appended after the verdict with ` · `, or alone if healthy) |
| writing | `✎ writing hand-off…` (buttons hidden while running) |
| ready | `✓ hand-off ready — run /clear` |
| resumed | `↪ resumed from hand-off (12m ago)` (shown until the first turn of the new conversation completes) |

Buttons appear only when relevant. `[compact]` shows for *getting heavy* and *compact now*. `[fresh start]` shows for *compact now* and *start fresh*.

### 2.2 Meters

- **Labels:** `CONTEXT`, `SESSION` (five_hour window), `WEEK` (seven_day window). Labels are dim; values are bright.
- **Bars:** 10 cells wide at full width. Sub-character precision uses the eighth-blocks `▏▎▍▌▋▊▉█`, and the empty track is `░` in a dim neutral.
- **Bar color by fill:**
  - `< 70%` → **`#aaff00`** (lime)
  - `70–89%` → amber `#ffb000`
  - `≥ 90%` → coral `#ff5f57`
- **Context extras:** token counts `116k/200k` (from `context.tokens` / `context.window`), the turns-left estimate `~N turns` (`—` until estimable), and the compaction count `⟲N` (hidden when 0).
- **Reset times:** `· 2h14m` / `· 3d` are relative times from `resetsAt`. Under 1h shows `24m`; under 48h shows `XhYm`; otherwise `Nd`.
- **Missing data:** if `rateLimits` is empty (not on a subscription), the SESSION/WEEK meters are omitted entirely. If `context.percent` is absent, show `CONTEXT —`.

### 2.3 Narrow terminals (collapse gracefully)

The band is built at the widest tier that fits `columns`, trying in order:

1. Full (labels, bars, values, token counts, turns, ⟲, reset times)
2. Drop token counts
3. Short labels: `ctx` / `5h` / `wk`
4. Bars shrink to 5 cells
5. Drop bars: `ctx 58% · 5h 31% · wk 64%`
6. Minimal: `58% · 31% · 64% ●` (the verdict icon only, colored)

Line 2 truncates its text with `…` before it drops buttons. Below about 40 columns the buttons are dropped, and `/handoff` remains available as a command.

## 3. Data sources

| Need | Source |
|---|---|
| Context %, tokens, window | `session.measure` event (pushed after every main-thread turn); `$.session.usage()` on load |
| 5h / weekly % and reset | `rateLimits[]` entries with `kind` `five_hour` / `seven_day` |
| Turn count | `$.session.turns()` |
| Compaction count | Counted in a `session.compact` hook (after `next(e)` resolves and the compaction stands); reset on `/clear` |
| Terminal width | the render input's columns |

State lives in `$.state` atoms (declared in `types/index.d.ts`): `usage`, `history` (last 8 context-token readings per turn), `compactions`, `verdict`, `lastToasted`, `handoff` (`idle | writing | ready | resumed`, plus timestamp).

## 4. Verdict engine

A pure function, `verdict(input) → { level, budget?, turnsLeft? }`, with no `$` dependency so it can be unit-tested.

**Turns-left estimate:** the average per-turn growth in context tokens over the last up-to-5 turns where growth was positive. `turnsLeft = (autoCompactWindowTokens − tokens) / avgGrowth`, rounded down. It is undefined if there are fewer than 2 readings or avgGrowth ≤ 0. The auto-compact threshold comes from the context usage's auto-compact window, falling back to `window`.

**Levels (first match from the top wins):**

| Level | Condition |
|---|---|
| `fresh` | (ctx ≥ 60% **or** turnsLeft ≤ 4) **and** (compactions ≥ 2 **or** turns > 150) |
| `compact` | ctx ≥ 60% **or** turnsLeft ≤ 4 |
| `heavy` | ctx ≥ 45% **or** turnsLeft ≤ 8 |
| `healthy` | otherwise |

**Budget overlay:** independent of the level. It is set when the five_hour or seven_day window is ≥ 90%, naming whichever is higher (ties go to five_hour).

**Configurable:** all numbers above are exposed as `userConfig` options with these defaults: `heavyPct 45`, `compactPct 60`, `heavyTurns 8`, `compactTurns 4`, `freshCompactions 2`, `freshTurns 150`, `budgetWarnPct 90`.

## 5. Toasts

Toasts fire **once per state change**:

- When the verdict **escalates** (healthy → heavy → compact → fresh). A drop back down (e.g. after compacting) resets the tracker, so a later re-escalation toasts again.
- When either budget window first crosses **75%** and then **90%** within one reset period (tracked per `resetsAt`).
- Hand-off lifecycle: `Hand-off ready — run /clear`, or `Hand-off failed: <reason>`.

The last-toasted level is stored in `$.state` so hot reloads don't re-toast.

## 6. Actions

### 6.1 `[compact]` — smart compact

Calls `$.session.compact({ instructions })` with:

> Preserve: the current goal and acceptance criteria; open tasks and their status; key decisions and the reasons for them; files created or modified and their purpose; unresolved errors or blockers; exact names of functions, commands and paths in play. Drop: exploratory dead ends, verbose tool output, superseded plans.

The band shows `⟲ compacting…` while the call runs. If compaction is skipped or refused, the reason is shown in a toast.

### 6.2 `[fresh start]` and `/handoff` — write the brief

1. Set handoff state to `writing`.
2. Produce the brief with a **background model call** that does not add to the main conversation. The preferred method is `$.model.fork({ prompt })`, which branches the current conversation so the brief writer has Claude's full working knowledge. If the fork reports `nothing-to-fork`, fall back to `$.model.complete` over `$.session.messages()`.
3. Brief prompt — produce Markdown with exactly these sections, kept under about 600 words:
   `# Hand-off — <project> — <timestamp>` / `## Goal` / `## Current state` / `## Decisions (and why)` / `## Files touched` / `## Next steps` / `## Gotchas`
4. Write to `<project root>/.claude/handoff.md` (overwrite) with `$.fs.write`. Store `{ path, writtenAt, sessionId, consumed: false }` in `$.store` keyed by project root.
5. Set the state to `ready` and show the toast `Hand-off ready — run /clear`.

`/handoff` is registered with `$.command.register` in `session.start` and runs the same flow.

### 6.3 Auto-load into the next conversation

`session.start` does not fire on `/clear`, so loading is keyed to the **first prompt of a fresh conversation**:

- `on('prompt.submit')`: if `$.session.turns() === 0` and the store has an unconsumed brief for this project root written less than 24h ago, read `.claude/handoff.md` and add it to the conversation with `$.session.append` as a user-role context row: `"Hand-off from the previous session:\n\n<brief>"`. Then mark it `consumed: true` and set the state to `resumed` with `writtenAt`. Pass the prompt through unchanged.
- The same check also covers a brand-new process (`claude` started fresh in the same project).
- A brief is used at most once. A later `/clear` does not load it again.
- If the file is missing or unreadable, the brief is skipped quietly with a dim status note.

## 7. File layout

```
session-health/
├── .claude-plugin/
│   ├── plugin.json            # name, version, description, types, userConfig
│   └── marketplace.json       # makes the repo installable
├── hooks/
│   ├── hooks.json             # { "modules": ["./register.tsx"] }
│   ├── register.tsx           # wiring: events → state, render, commands
│   ├── band.tsx               # pure render: (state, columns) → tree, width tiers
│   ├── verdict.ts             # pure verdict + turns-left logic
│   ├── meters.ts              # bar glyphs, colors, relative-time formatting
│   └── handoff.ts             # brief prompt, write, load-once logic
├── types/index.d.ts           # PluginState contract
├── tests/
│   ├── verdict.test.ts
│   ├── meters.test.ts
│   └── band.test.ts           # width tiers never exceed columns
└── README.md                  # screenshot, install line, config table
```

Developed at `~/.claude/dev-mods/<session>/session-health/` for hot reload, then copied into this project folder as the shareable repo.

## 8. Error handling

- Every hook passes through `next(e)` on its own failure. The band never blocks the prompt.
- Missing measurements degrade the display (`—`) rather than throwing.
- A failure in the model call or the file write sets handoff back to `idle` and shows a toast with the reason.
- A compaction that is refused or skipped shows a toast with the reason and does not count toward ⟲.

## 9. Testing

- **Unit:** `verdict.ts` table-driven tests cover every row of §4 plus the overlay and the turns-left edge cases (no history, negative growth). `meters.ts` tests check the eighth-block rounding, the color bands at 69/70/89/90, and relative-time formatting.
- **Render:** `band.tsx` at widths 200, 120, 80, 60, 40 and 30, checking that each line is ≤ columns and the right tier is chosen.
- **Plugin:** `claude plugin validate` and `claude plugin test` both pass, and `tsc -p` is clean.
- **Manual:** watch the band through a real session: a compact click, `/handoff`, `/clear`, and the brief arriving.

## 10. Sharing

The repo has a `marketplace.json` and a README with this install line:

```
/plugin install session-health --marketplace <owner>/<repo>
```

# session-health

A Claude Code mod that keeps an eye on your session from a band above the prompt:

```
 CONTEXT ███████▌░░ 75% 150k/200k ~3 turns ⟲2   SESSION ███▎░░░░░░ 31% · 2h14m   WEEK ██████▍░░░ 64% · 3d
 ◑ compact now — auto-compact in ~3 turns                                        [ compact ] [ fresh start ]
```

- **Meters** for the context window, the 5-hour session budget and the weekly budget: lime (`#aaff00`), amber from 70%, coral from 90%.
- **A verdict** — healthy → getting heavy → compact now → start fresh — from context %, turns left until auto-compact, and how often you've compacted. A ⚠ budget warning shows when either budget passes 90%.
- **`[compact]` / `/smart-compact`** runs a smart compact that keeps your goal, open tasks, decisions and files in play. The command works any time, even when the button isn't showing. In a terminal, click the button (fullscreen layout) or press ctrl+x tab to focus the band, then `c`.
- **`[fresh start]` / `/handoff`** writes `.claude/handoff.md` in the background. Run `/clear` and your next prompt arrives with the brief attached, so the new conversation starts already briefed. Each brief loads once, within 24 hours. With the band focused (ctrl+x tab), `f` presses `[fresh start]`.
- **Toasts** fire once when the verdict escalates or a budget crosses 75% / 90%.

The band shrinks gracefully on narrow terminals, down to `58% · 31% · 64% ●`.

## Install

```
/plugin install session-health --marketplace useloadflow-dev/session-health-claude-code-mod
```

Answer `y` to add the marketplace, then pick a scope.

Hand-off briefs are written to `.claude/handoff.md` in each project. You'll probably want that file out of git:

```
echo .claude/handoff.md >> .gitignore
```

## Settings

Change these in `/config`:

| Setting | Default | Meaning |
|---|---|---|
| `heavyPct` | 45 | Context % that counts as "getting heavy" |
| `compactPct` | 60 | Context % that says "compact now" |
| `heavyTurns` | 8 | Turns left before auto-compact that count as "getting heavy" |
| `compactTurns` | 4 | Turns left before auto-compact that say "compact now" |
| `freshCompactions` | 2 | Compactions after which a heavy session should start fresh |
| `freshTurns` | 150 | Turns after which a heavy session should start fresh |
| `budgetWarnPct` | 90 | 5-hour / weekly % that shows the budget warning |

The SESSION and WEEK meters appear only on a Claude subscription. API-key sessions show the context meter alone.

The SESSION and WEEK meters sync across your open sessions every 15s, so an idle session shows the latest reading any session has seen.

## Development

```
claude plugin validate session-health
claude plugin test session-health
```

## License

MIT

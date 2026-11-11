# session-health

A Claude Code mod that keeps an eye on your session from a band above the prompt:

```
 CONTEXT ███████▌░░ 75% 150k/200k ⟲2   SESSION ███▎░░░░░░ 31% · 2h14m   WEEK ██████▍░░░ 64% · 3d
 ◑ compact now — auto-compact in ~3 turns                                        [ compact ] [ fresh start ]
```

- **Meters** for the context window, the 5-hour session budget and the weekly budget: lime (`#aaff00`), amber from 70%, coral from 90%.
- **A verdict** — healthy → getting heavy → compact now → start fresh — from context %, turns left until auto-compact, and how often you've compacted. A ⚠ budget warning shows when either budget passes 90%.
- **`[compact]` / `/smart-compact`** runs a smart compact that keeps your goal, open tasks, decisions and files in play. The command works any time, even when the button isn't showing. In a terminal, click the button (fullscreen layout) or press ctrl+x tab to focus the band, then `c`.
- **`[fresh start]`** saves the project's hand-off through the [project-pickup](project-pickup/README.md) mod (`/pickup-save`). Run `/clear` and the new conversation starts already briefed. Without project-pickup installed, the button tells you how to add it. With the band focused (ctrl+x tab), `f` presses `[fresh start]`.
- **Compaction count** (`⟲N`) is kept per session in the mod's store, so quitting and `claude --resume`, or `/resume` back to an older conversation, keeps its count. `/clear` starts the new conversation at 0. Once a session has compacted `freshCompactions` times, the band shows a gentle `✦ compacted N× — consider a fresh start` hint even while context is light. Anthropic's docs give no recommended number of compactions; the default of 2 is this mod's own choice, based on each summary losing detail from the one before.
- **Toasts** fire once when the verdict escalates or a budget crosses 75% / 90%.

The band shrinks gracefully on narrow terminals, down to `58% · 31% · 64% ●`.

## Install

```
/plugin install session-health --marketplace useloadflow-dev/session-health-claude-code-mod
```

Answer `y` to add the marketplace, then pick a scope.

For `[fresh start]`, install project-pickup too:

```
/plugin install project-pickup --marketplace useloadflow-dev/session-health-claude-code-mod
```

## Settings

Change these in `/config`:

| Setting | Default | Meaning |
|---|---|---|
| `heavyPct` | 45 | Context % that counts as "getting heavy" |
| `compactPct` | 60 | Context % that says "compact now" |
| `heavyTurns` | 8 | Turns left before auto-compact that count as "getting heavy" |
| `compactTurns` | 4 | Turns left before auto-compact that say "compact now" |
| `freshCompactions` | 2 | Compactions after which the band suggests a fresh start: a dim hint while context is light, "start fresh" once it fills up |
| `freshTurns` | 150 | Turns after which a heavy session should start fresh |
| `budgetWarnPct` | 90 | 5-hour / weekly % that shows the budget warning |

The SESSION and WEEK meters appear only on a Claude subscription. API-key sessions show the context meter alone.

The SESSION and WEEK meters sync across your open sessions every 15s, so an idle session shows the latest reading any session has seen.

## More mods in this marketplace

- **[project-pickup](project-pickup/README.md)**: pick projects back up where you left off. Every new conversation starts briefed from the project's hand-off, a status line shows the step you're on, `/projects` lists where each project stands, and `/task-bucket` shows this project's steps in groups. `/plugin install project-pickup --marketplace useloadflow-dev/session-health-claude-code-mod`
- **[vibe-guard](vibe-guard/README.md)**: a companion to the vibe-wise learning plugin.

## Elsewhere

- **[arch-map](https://github.com/useloadflow-dev/arch-map-claude-code-mod)** now lives in its own repo: `/plugin install arch-map --marketplace useloadflow-dev/arch-map-claude-code-mod`

## Development

```
claude plugin validate session-health
claude plugin test session-health
```

## License

MIT

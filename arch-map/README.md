# arch-map

A Claude Code mod for learning system design while you build. A pane beside the conversation shows a diagram of whatever Claude is building with you, kept up to date as the design changes.

```
◀ v2 (2 of 2) ▶
Todo app
What changed in v2
Added Redis because the list page hit Postgres on every load.
+ new  ~ changed  − removed since v1

╭──────────╮
│ Web app  │
╰──────────╯
  ↓ Web app → API (stateless): POST /todos
╔═════════════════════╗
║ ~ API (stateless)   ║
╚═════════════════════╝
  ↓ + API (stateless) → Redis: GET list
╔═══════════╗ ╭──────────╮
║ + Redis   ║ │ Postgres │
╚═══════════╝ ╰──────────╯
```

- **A live diagram.** Claude calls the mod's `update_architecture` tool when you build or change something with moving parts. The diagram shows the components (client, server, database, cache, queue, worker, external service), the connections between them with what travels along each, one request traced through the system, and one design concept the latest change illustrates.
- **Version history with changes highlighted.** Every update is a new version. New parts are green with a `+`, changed parts are yellow with a `~`, and removed ones are listed in red, struck through. A *What changed* line gives the reason for each change. With the pane focused, `p` and `n` step through versions and `l` jumps to the latest.
- **Security risks in the design.** When the design itself shows a risk, such as an unauthenticated public endpoint, secrets in the client, user input reaching SQL, or a database reachable from outside, Claude flags it. Each risk is tied to a part or connection and comes with a one-line fix. Flagged parts show `⚠ high risk`, flagged connections end in `⚠`, and a *Security risks* box lists them, worst first. Risks are saved with each version, so stepping back shows when one appeared and which change fixed it. They're read off the diagram, not the code; `/security-review` checks the code itself.
- **Click a part to explain it.** Click a part, or press its number (1–9), to get why it's in this system, what you could use instead, and what breaks first under load. Each explanation is one Sonnet call per part per version, then cached for the session.
- **Saved per project.** History (the latest 25 versions) is kept per project folder, so a diagram picks up where you left off in the next session.

## Commands

| Command | What it does |
|---|---|
| `/arch` | Show or hide the pane |
| `/arch-off` | Turn the mod off for this project: no diagram updates, and the pane closes. History is kept. |
| `/arch-on` | Turn it back on for this project |

To start, ask Claude: *"draw the architecture of this project"*.

The pane opens on its own in terminals 144 columns or wider. `/arch` opens it at any width: beside the conversation from 110 columns, above the prompt below that.

## Install

```
/plugin install arch-map --marketplace useloadflow-dev/session-health-claude-code-mod
```

Answer `y` to add the marketplace, then pick a scope.

## Development

```
claude plugin validate arch-map
claude plugin test arch-map
```

## License

MIT

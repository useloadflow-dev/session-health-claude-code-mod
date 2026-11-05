# project-pickup

A Claude Code mod for working on many projects at once. It gets you back into a project without retyping "read the handoff file to get up to speed".

```
◆ VanSync · 5/7 · next: TestFlight build · saved 2d ago · unsaved progress — /pickup save
```

- **Briefed automatically.** The first prompt of every new conversation (a new session, or after `/clear`) carries the project's hand-off. It finds `.claude/handoff.md`, `HANDOFF.md`, `handoff.md` or `docs/handoff.md`, in any letter case, so your existing files work as they are. There's no 24-hour limit: a hand-off from last week loads too.
- **Status line** with the project, its progress, the next action and how long ago the hand-off was saved. Once Claude changes files after the last save, it adds `unsaved progress — /pickup save`. When Claude edits the hand-off itself, that counts as a save.
- **`/pickup save`** writes the hand-off from the conversation. It merges into the existing file where that file already is, and keeps one layout for every project: Goal, a Steps checklist (`[x]` done, `[~]` in progress, `[ ]` to do), Next action, Decisions, Open questions, Files and commands, Gotchas. Run it in a fresh conversation to convert an older hand-off to this layout.
- **`/pickup`** shows where this project stands.
- **`/projects`** opens a pane listing every project you've opened with a hand-off, most recent first: progress, next action and when it was last saved.
- **`/task-bucket`** opens a pane with this project's Steps checklist in groups, so you can see how a feature is going at a glance. A `### Name` subheading under `## Steps` starts a group, and steps above the first one sit in a group of their own. Each group's header shows its finished steps (`Backend 2/5`), with a tick once it's done (`✓ Backend 5/5`). `/pickup save` adds groups when the plan has distinct parts, and the pane updates when Claude edits the hand-off. The app decides where the pane sits; if it can't draw one, the command prints the list instead.

Older hand-offs that track progress in prose ("Step 5 CONFIRMED + IMPLEMENTED") show as `step 5 done` until the next save converts them to a checklist.

Pairs with [session-health](../README.md): its `[fresh start]` button runs `/pickup save`.

## Install

```
/plugin install project-pickup --marketplace useloadflow-dev/session-health-claude-code-mod
```

Whether to commit the hand-off is your call. Committed, it travels with the repo. Otherwise:

```
echo .claude/handoff.md >> .gitignore
```

## Development

```
claude plugin validate project-pickup
claude plugin test project-pickup
```

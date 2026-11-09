# vibe-guard

A companion mod for the [vibe-wise](https://github.com/nykooi1/vibe-wise) learning plugin. vibe-wise teaches; you start it yourself with `/vibe-wise:learn`, and vibe-guard makes sure autonomous runs don't skip past your checkpoints. It reads vibe-wise's notes in `.vibe-wise/` and never changes vibe-wise itself.

- **Holds edits at checkpoints.** While learning is active and `progress.md` has a `## Pending decision`, Claude's `Edit`, `Write` and `NotebookEdit` calls are refused with a reminder to ask you first. Writes to `.vibe-wise/` still go through, so vibe-wise can record your answer and clear the hold. Writes Claude makes through Bash are not caught.
- **Shows where you are** on the status line: learning on, paused, or which checkpoint is waiting on you.
- **`/learning`** shows the same status; `/learning pause` and `/learning resume` flip the profile's `Learning mode:` line.

Needs vibe-wise installed; without it vibe-guard does nothing.

## Install

```
/plugin install vibe-guard@session-health
```

## Development

```
claude plugin validate vibe-guard
claude plugin test vibe-guard
```

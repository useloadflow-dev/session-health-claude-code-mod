// Progress read from a hand-off; `total` is undefined when its steps have no checklist.
export type Summary = { done: number; total?: number; current?: string; next?: string }

// One checklist line of the hand-off's Steps.
export type Step = { text: string; state: 'done' | 'doing' | 'todo' }

// Steps under one `### name` subheading; `name` is undefined for steps above the first.
export type Group = { name?: string; steps: Step[] }

// The project this session is in: its hand-off, when it has one, relative to root.
export type Here = { root: string; rel?: string; summary?: Summary; groups?: Group[]; savedAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'project-pickup': {
      here: Shaped<Here | null>
      // Files Claude changed since the hand-off was last saved.
      dirty: boolean
      // The conversation already handed the brief, so it is handed once.
      briefed: string
    }
  }
}

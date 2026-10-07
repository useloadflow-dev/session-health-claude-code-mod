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

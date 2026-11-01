export type NodeKind =
  | 'user'
  | 'client'
  | 'server'
  | 'service'
  | 'worker'
  | 'database'
  | 'cache'
  | 'queue'
  | 'storage'
  | 'external'

export type ArchNode = { id: string; label: string; kind: NodeKind; note?: string }
export type ArchEdge = { from: string; to: string; label?: string }

export type Diagram = {
  title: string
  summary?: string
  /** What changed since the version before, and why. */
  why?: string
  nodes: ArchNode[]
  edges: ArchEdge[]
  flow?: string[]
  lesson?: { concept: string; explanation: string }
  version: number
}

/** A part's explanation, asked of the model when the person clicks it. */
export type Explanation = { status: 'loading' | 'done' | 'error'; text: string }

/** What $.store keeps per project root. */
export type ProjectRecord = { enabled: boolean; history: Diagram[] }

declare module 'claude-code' {
  interface PluginState {
    'arch-map': {
      /** v0.1 kept one diagram; read once to seed history. */
      diagram: Shaped<Diagram | null>
      history: Shaped<Diagram[]>
      /** Index into history being viewed; null follows the latest. */
      viewing: Shaped<number | null>
      enabled: Shaped<boolean>
      dismissed: Shaped<boolean>
      /** The node id the person clicked, explained under the diagram. */
      selected: Shaped<string | null>
      /** Explanations by `<version>:<node id>`. */
      explanations: Shaped<Record<string, Explanation>>
    }
  }
}

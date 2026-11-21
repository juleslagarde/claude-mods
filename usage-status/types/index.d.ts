/** One rate-limit window as last reported. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * One reading of a window: when (ms since epoch), its percent used and, as
 * `x`, the session's cumulative ms spent waiting on tool calls at that moment.
 */
export type Sample = { t: number; pct: number; x?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': {
      limits: Limit[]
      history: Record<string, Sample[]>
      /** Cumulative ms the main loop spent with a tool call running. */
      toolMs: number
    }
  }
}

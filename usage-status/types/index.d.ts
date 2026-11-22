/** One rate-limit window as last reported. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of a window: when (ms since epoch) and its percent used. */
export type Sample = { t: number; pct: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': {
      limits: Limit[]
      history: Record<string, Sample[]>
      /** Cumulative ms the main loop spent with a tool call running. */
      toolMs: number
      /** Cumulative ms between the main loop's turns (waiting on the person). */
      idleMs: number
    }
  }
}

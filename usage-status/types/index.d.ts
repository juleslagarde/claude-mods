/** One rate-limit window as last reported. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of a window: when (ms since epoch) and its percent used. */
export type Sample = { t: number; pct: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': {
      limits: Limit[]
      history: Record<string, Sample[]>
    }
  }
}

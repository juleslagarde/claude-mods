/** One rate-limit window as last reported. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** This session's share of one window: points accrued in earlier windows, plus last minus base. */
export type WindowShare = { base: number; accrued: number; last: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': {
      limits: Limit[]
      shares: Record<string, WindowShare>
    }
  }
}

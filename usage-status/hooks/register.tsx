import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Sample } from '../types'

const limitsAtom = atom({ plugin: 'usage-status', key: 'limits' } as const, [])
const historyAtom = atom({ plugin: 'usage-status', key: 'history' } as const, {})

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const ACCENTS: Record<string, string> = { five_hour: 'claude', seven_day: 'permission' }
const BAR_CELLS = 10
const HOUR_MS = 60 * 60 * 1000
// Below this much history the rate would be noise, so it is not shown yet.
const MIN_SPAN_MS = 15 * 60 * 1000
const MAX_SAMPLES = 5000

const pad = (n: number) => String(n).padStart(2, '0')

function formatReset(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (!withDay) return ` ⟳ ${time}`
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]
  return ` ⟳ ${day} ${time}`
}

// Keeps every reading of the session, the oldest dropped past MAX_SAMPLES.
function nextHistory(
  history: Record<string, Sample[]>,
  limits: SessionRateLimit[],
  now: number,
): Record<string, Sample[]> {
  const out = { ...history }
  for (const l of limits) {
    out[l.kind] = [...(out[l.kind] ?? []), { t: now, pct: l.percentUsed }].slice(-MAX_SAMPLES)
  }
  return out
}

// Mean points per hour since the session's first reading. A drop between two
// readings is a window reset, counted as climbing from 0 to the new value.
function sessionRate(samples: Sample[] | undefined): number | null {
  const first = samples?.[0]
  const last = samples?.[samples.length - 1]
  if (!samples || !first || !last) return null
  const span = last.t - first.t
  if (span < MIN_SPAN_MS) return null
  let points = 0
  samples.reduce((prev, cur) => {
    points += cur.pct >= prev.pct ? cur.pct - prev.pct : cur.pct
    return cur
  })
  return (points * HOUR_MS) / span
}

const levelColor = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'success')

// The steady rate that would use exactly what is left by the reset; going
// faster runs out early: orange above it, red 20% above it.
function rateColor(rate: number, l: SessionRateLimit, now: number): string {
  if (!l.resetsAt) return 'suggestion'
  const hoursLeft = (Date.parse(l.resetsAt) - now) / HOUR_MS
  if (hoursLeft <= 0) return 'suggestion'
  const optimal = Math.max(0, 100 - l.percentUsed) / hoursLeft
  return rate > optimal * 1.2 ? 'error' : rate > optimal ? 'warning' : 'suggestion'
}

async function record($: EngineInterface, limits: SessionRateLimit[]) {
  if (!limits.length) return
  const now = await $.clock.now()
  await update($, limitsAtom, () => limits)
  await update($, historyAtom, history => nextHistory(history, limits, now))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    $.ui.status(undefined)
    await record($, (await $.session.usage()).rateLimits)
    return ran
  })

  on('session.measure', async ($, e, next) => {
    await record($, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const limits = (await read($, limitsAtom)).filter(l => l.kind in LABELS)
    const history = await read($, historyAtom)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    if (!limits.length) {
      return (
        <Box justifyContent="flex-end">
          <Text dimColor>usage: waiting for first response</Text>
        </Box>
      )
    }

    return (
      <Box justifyContent="flex-end">
        {limits.map((l, i) => {
          const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(l.percentUsed / (100 / BAR_CELLS))))
          const color = levelColor(l.percentUsed)
          const rate = sessionRate(history[l.kind])
          return (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor>  │  </Text> : ''}
              <Text color={ACCENTS[l.kind]} bold>{LABELS[l.kind]} </Text>
              <Text dimColor>▕</Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text color={color} bold>{Math.round(l.percentUsed)}%</Text>
              <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}▏</Text>
              {rate === null ? '' : <Text color={rateColor(rate, l, now)}> ◆ +{rate.toFixed(1)}/h</Text>}
              <Text dimColor>{formatReset(l.resetsAt, l.kind === 'seven_day')}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}

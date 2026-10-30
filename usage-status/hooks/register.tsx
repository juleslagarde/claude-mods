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

const pad = (n: number) => String(n).padStart(2, '0')

function formatReset(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (!withDay) return ` ⟳ ${time}`
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]
  return ` ⟳ ${day} ${time}`
}

// Keeps the readings of the last hour, plus the one just before it so the
// rate can span the full hour.
function nextHistory(
  history: Record<string, Sample[]>,
  limits: SessionRateLimit[],
  now: number,
): Record<string, Sample[]> {
  const out = { ...history }
  for (const l of limits) {
    const samples = [...(out[l.kind] ?? []), { t: now, pct: l.percentUsed }]
    const firstRecent = samples.findIndex(s => s.t >= now - HOUR_MS)
    out[l.kind] = samples.slice(Math.max(0, firstRecent - 1))
  }
  return out
}

// Points per hour over the last hour. A drop between two readings is a window
// reset, counted as climbing from 0 to the new value.
function hourlyRate(samples: Sample[] | undefined, now: number): number | null {
  const first = samples?.[0]
  const last = samples?.[samples.length - 1]
  if (!samples || !first || !last || samples.length < 2) return null
  const from = Math.max(first.t, now - HOUR_MS)
  const span = last.t - from
  if (span < MIN_SPAN_MS) return null
  let points = 0
  samples.reduce((prev, cur) => {
    const delta = cur.pct >= prev.pct ? cur.pct - prev.pct : cur.pct
    // The reading straddling the hour's start counts pro rata.
    const share = prev.t < from ? (cur.t - from) / (cur.t - prev.t) : 1
    points += delta * Math.max(0, share)
    return cur
  })
  return (points * HOUR_MS) / span
}

const levelColor = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'success')

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
          const rate = hourlyRate(history[l.kind], now)
          return (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor>  │  </Text> : ''}
              <Text color={ACCENTS[l.kind]} bold>{LABELS[l.kind]} </Text>
              <Text dimColor>▕</Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text color={color} bold>{Math.round(l.percentUsed)}%</Text>
              <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}▏</Text>
              {rate === null ? '' : <Text color="suggestion"> ◆ +{rate.toFixed(1)}/h</Text>}
              <Text dimColor>{formatReset(l.resetsAt, l.kind === 'seven_day')}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}

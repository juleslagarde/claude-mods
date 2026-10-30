import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionRateLimit } from 'claude-code'

import type { Sample } from '../types'

const limitsAtom = atom({ plugin: 'usage-status', key: 'limits' } as const, [])
const historyAtom = atom({ plugin: 'usage-status', key: 'history' } as const, {})

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const ACCENTS: Record<string, string> = { five_hour: 'claude', seven_day: 'permission' }
const HOUR_MS = 60 * 60 * 1000
const MAX_SAMPLES = 5000

const DEFAULT_BAR_COLORS = '0:success, 75:warning, 90:error'
const DEFAULT_RATE_COLORS = '0:green, 100:orange, 200:red, 300:violet'

// Names resolved to hex so every terminal draws them alike and they can blend.
const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', gray: '#8a8a8a', grey: '#8a8a8a',
  red: '#ff3b30', orange: '#ff8c00', yellow: '#ffd60a', gold: '#ffd700',
  green: '#34c759', lime: '#a3e635', teal: '#14b8a6', cyan: '#22d3ee',
  blue: '#3b82f6', indigo: '#6366f1', violet: '#a855f7', purple: '#9333ea',
  magenta: '#e040fb', pink: '#ff6fb5', brown: '#a0522d',
}

type Stop = { at: number; color: string }

type Config = {
  barStops: Stop[]
  rateStops: Stop[]
  blend: boolean
  cells: number
  used: string
  left: string
  minSpanMs: number
}

const resolveColor = (c: string) => NAMED[c.toLowerCase()] ?? c

// "0:green, 100:orange" → sorted stops; anything unreadable falls back.
function parseStops(text: string, fallback: string): Stop[] {
  const stops: Stop[] = []
  for (const part of text.split(',')) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*:\s*(\S+)\s*$/.exec(part)
    if (!m || !m[1] || !m[2]) return text === fallback ? [] : parseStops(fallback, fallback)
    stops.push({ at: Number(m[1]), color: resolveColor(m[2]) })
  }
  return stops.sort((a, b) => a.at - b.at)
}

function readConfig(options: PluginOptions): Config {
  const str = (k: string, d: string) => {
    const v = options[k]
    return typeof v === 'string' ? v : d
  }
  const num = (k: string, d: number) => {
    const v = options[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : d
  }
  const chars = [...str('barChars', '█░')]
  return {
    barStops: parseStops(str('barColors', DEFAULT_BAR_COLORS), DEFAULT_BAR_COLORS),
    rateStops: parseStops(str('rateColors', DEFAULT_RATE_COLORS), DEFAULT_RATE_COLORS),
    blend: options.blend === true,
    cells: Math.min(40, Math.max(4, Math.round(num('barCells', 10)))),
    used: chars[0] ?? '█',
    left: chars[1] ?? '░',
    minSpanMs: Math.max(0, num('rateMinMinutes', 15)) * 60 * 1000,
  }
}

const HEX = /^#([0-9a-f]{6})$/i

function mix(a: string, b: string, f: number): string {
  const ca = HEX.exec(a)?.[1]
  const cb = HEX.exec(b)?.[1]
  if (!ca || !cb) return a
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const out = [0, 2, 4].map(i => Math.round(ch(ca, i) + (ch(cb, i) - ch(ca, i)) * f))
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
}

// The colour of the highest stop at or below value; with blending, mixed
// toward the next stop when both are hex.
function colorAt(stops: Stop[], value: number, blend: boolean): string | undefined {
  let i = -1
  stops.forEach((s, k) => {
    if (s.at <= value) i = k
  })
  const cur = stops[Math.max(0, i)]
  const nxt = stops[i + 1]
  if (!cur) return undefined
  if (!blend || i < 0 || !nxt || nxt.at === cur.at) return cur.color
  return mix(cur.color, nxt.color, (value - cur.at) / (nxt.at - cur.at))
}

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
function sessionRate(samples: Sample[] | undefined, minSpanMs: number): number | null {
  const first = samples?.[0]
  const last = samples?.[samples.length - 1]
  if (!samples || !first || !last) return null
  const span = last.t - first.t
  if (span <= 0 || span < minSpanMs) return null
  let points = 0
  samples.reduce((prev, cur) => {
    points += cur.pct >= prev.pct ? cur.pct - prev.pct : cur.pct
    return cur
  })
  return (points * HOUR_MS) / span
}

// The rate as a percent of the steady rate that would use exactly what is
// left by the reset; null where no reset time is known.
function paceRatio(rate: number, l: SessionRateLimit, now: number): number | null {
  if (!l.resetsAt) return null
  const hoursLeft = (Date.parse(l.resetsAt) - now) / HOUR_MS
  if (hoursLeft <= 0) return null
  const optimal = Math.max(0, 100 - l.percentUsed) / hoursLeft
  return optimal > 0 ? (rate / optimal) * 100 : Number.POSITIVE_INFINITY
}

async function record($: EngineInterface, limits: SessionRateLimit[]) {
  if (!limits.length) return
  const now = await $.clock.now()
  await update($, limitsAtom, () => limits)
  await update($, historyAtom, history => nextHistory(history, limits, now))
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

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
          const filled = Math.min(cfg.cells, Math.max(0, Math.round((l.percentUsed / 100) * cfg.cells)))
          const color = colorAt(cfg.barStops, l.percentUsed, cfg.blend)
          const rate = sessionRate(history[l.kind], cfg.minSpanMs)
          const ratio = rate === null ? null : paceRatio(rate, l, now)
          const rateColor = colorAt(cfg.rateStops, ratio ?? 0, cfg.blend)
          return (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor>  │  </Text> : ''}
              <Text color={ACCENTS[l.kind]} bold>{LABELS[l.kind]} </Text>
              <Text dimColor>▕</Text>
              <Text color={color}>{cfg.used.repeat(filled)}</Text>
              <Text color={color} bold>{Math.round(l.percentUsed)}%</Text>
              <Text dimColor>{cfg.left.repeat(cfg.cells - filled)}▏</Text>
              {rate === null ? '' : <Text color={rateColor}> ◆ +{rate.toFixed(1)}/h</Text>}
              <Text dimColor>{formatReset(l.resetsAt, l.kind === 'seven_day')}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}

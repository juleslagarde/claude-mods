import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { WindowShare } from '../types'

const limitsAtom = atom({ plugin: 'usage-status', key: 'limits' } as const, [])
const sharesAtom = atom({ plugin: 'usage-status', key: 'shares' } as const, {})

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const ACCENTS: Record<string, string> = { five_hour: 'claude', seven_day: 'permission' }
const BAR_CELLS = 10

const pad = (n: number) => String(n).padStart(2, '0')

function formatReset(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (!withDay) return ` ⟳ ${time}`
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]
  return ` ⟳ ${day} ${time}`
}

// The first reading is the session's baseline; when a window resets, what the
// session used in the old window is kept and the new one counts from 0.
function nextShares(
  shares: Record<string, WindowShare>,
  limits: SessionRateLimit[],
): Record<string, WindowShare> {
  const out = { ...shares }
  for (const l of limits) {
    const prev = out[l.kind]
    if (!prev) {
      out[l.kind] = { base: l.percentUsed, accrued: 0, last: l.percentUsed, resetsAt: l.resetsAt }
    } else if (prev.resetsAt !== l.resetsAt && l.percentUsed < prev.last) {
      out[l.kind] = { base: 0, accrued: prev.accrued + prev.last - prev.base, last: l.percentUsed, resetsAt: l.resetsAt }
    } else {
      out[l.kind] = { ...prev, last: l.percentUsed, resetsAt: l.resetsAt }
    }
  }
  return out
}

const sessionPoints = (s: WindowShare) => Math.max(0, s.accrued + s.last - s.base)

const levelColor = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'success')

async function record($: EngineInterface, limits: SessionRateLimit[]) {
  if (!limits.length) return
  await update($, limitsAtom, () => limits)
  await update($, sharesAtom, shares => nextShares(shares, limits))
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
    const shares = await read($, sharesAtom)
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
          const share = shares[l.kind]
          const mine = share ? sessionPoints(share) : 0
          const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(l.percentUsed / (100 / BAR_CELLS))))
          const color = levelColor(l.percentUsed)
          return (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor>  │  </Text> : ''}
              <Text color={ACCENTS[l.kind]} bold>{LABELS[l.kind]} </Text>
              <Text dimColor>▕</Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text color={color} bold>{Math.round(l.percentUsed)}%</Text>
              <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}▏</Text>
              <Text color="suggestion"> ◆ +{mine.toFixed(1)}</Text>
              <Text dimColor>{formatReset(l.resetsAt, l.kind === 'seven_day')}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}

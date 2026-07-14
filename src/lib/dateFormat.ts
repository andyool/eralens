import type { HistEvent } from './types'
import { PRESENT_YEAR } from './timeMapping'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Format a deep-time / BCE / CE year on its own. */
export function formatYear(year: number): string {
  const bp = PRESENT_YEAR - year
  if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(1)} billion years ago`
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(bp >= 1e7 ? 0 : 1)} million years ago`
  if (bp >= 12_000) {
    const kya = bp / 1000
    return `${kya.toFixed(kya >= 100 ? 0 : 1)},000 years ago`.replace('.0,', ',')
  }
  if (year < 0) return `${Math.abs(year).toLocaleString()} BCE`
  if (year === 0) return '1 BCE'
  return `${year} CE`
}

/**
 * Render an event's date honouring its precision — a full date for day-precise
 * modern events, "circa", "billion years ago", etc. for the rest.
 */
export function formatEventDate(ev: HistEvent): string {
  switch (ev.precision) {
    case 'geological':
      return formatYear(ev.year)
    case 'era':
    case 'circa':
      return `c. ${formatYear(ev.year)}`
    case 'century': {
      if (ev.year < 0) return `${ordinalCentury(Math.ceil(-ev.year / 100))} century BCE`
      return `${ordinalCentury(Math.ceil(ev.year / 100))} century`
    }
    case 'decade':
      return `${Math.floor(ev.year / 10) * 10}s`
    case 'year':
      return formatYear(ev.year)
    case 'month':
      if (ev.month) return `${MONTHS[ev.month - 1]} ${absYearLabel(ev.year)}`
      return formatYear(ev.year)
    case 'day':
      if (ev.month && ev.day) return `${MONTHS[ev.month - 1]} ${ev.day}, ${absYearLabel(ev.year)}`
      if (ev.month) return `${MONTHS[ev.month - 1]} ${absYearLabel(ev.year)}`
      return formatYear(ev.year)
    default:
      return formatYear(ev.year)
  }
}

function absYearLabel(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`
  return `${year}`
}

function ordinalCentury(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** A compact date good for hover chips: "1969", "44 BCE", "13.8 Gya". */
export function compactDate(ev: HistEvent): string {
  const bp = PRESENT_YEAR - ev.year
  if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(1)} Gya`
  if (bp >= 1_000_000) return `${Math.round(bp / 1_000_000)} Mya`
  if (bp >= 12_000) return `${Math.round(bp / 1000)} kya`
  if (ev.year < 0) return `${Math.abs(ev.year)} BCE`
  return `${ev.year}`
}

import type { HistEvent } from './types'

function weightedRandom(events: HistEvent[], weight: (e: HistEvent) => number): HistEvent | null {
  const total = events.reduce((s, e) => s + Math.max(0, weight(e)), 0)
  if (total <= 0) return events[Math.floor(Math.random() * events.length)] ?? null
  let r = Math.random() * total
  for (const e of events) {
    r -= Math.max(0, weight(e))
    if (r <= 0) return e
  }
  return events[events.length - 1] ?? null
}

export type LuckyMode = 'surprise' | 'turning-point' | 'on-this-day' | 'obscure'

export const LUCKY_MODES: { id: LuckyMode; label: string; icon: string }[] = [
  { id: 'surprise', label: 'Surprise me', icon: '🎲' },
  { id: 'turning-point', label: 'A major turning point', icon: '⭐' },
  { id: 'on-this-day', label: 'On this day', icon: '📅' },
  { id: 'obscure', label: 'Something obscure', icon: '🔭' },
]

/** Pick an event for a given discovery mode. Falls back gracefully. */
export function discover(events: HistEvent[], mode: LuckyMode, today: Date): HistEvent | null {
  if (events.length === 0) return null
  switch (mode) {
    case 'turning-point': {
      const pool = events.filter((e) => e.significance >= 85)
      return weightedRandom(pool.length ? pool : events, (e) => e.significance)
    }
    case 'on-this-day': {
      const m = today.getMonth() + 1
      const d = today.getDate()
      const exact = events.filter((e) => e.month === m && e.day === d)
      if (exact.length) return weightedRandom(exact, (e) => e.significance)
      const sameMonth = events.filter((e) => e.month === m)
      if (sameMonth.length) return weightedRandom(sameMonth, (e) => e.significance)
      return weightedRandom(events, (e) => e.significance)
    }
    case 'obscure': {
      // Favour the less prominent, but not the geological deep-time markers.
      const pool = events.filter((e) => e.significance < 78 && e.year > -100000)
      return weightedRandom(pool.length ? pool : events, (e) => 100 - e.significance)
    }
    case 'surprise':
    default:
      // Significance-weighted but with a floor so anything can appear.
      return weightedRandom(events, (e) => e.significance * 0.6 + 20)
  }
}

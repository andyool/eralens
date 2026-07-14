import type { HistEvent } from '../lib/types'
import { SEED_EVENTS } from './events.seed'

/** Seed dataset, sorted oldest → newest. */
export const EVENTS: HistEvent[] = [...SEED_EVENTS].sort((a, b) => a.year - b.year)

export const EVENT_BY_ID: Map<string, HistEvent> = new Map(EVENTS.map((e) => [e.id, e]))

export function getEvent(id: string): HistEvent | undefined {
  return EVENT_BY_ID.get(id)
}

function isValidEvent(x: unknown): x is HistEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.year === 'number' &&
    Array.isArray(e.categories)
  )
}

/**
 * Load the event dataset. Prefers a generated `events.json` (produced by
 * `npm run fetch:wikidata`, served from the app root) so the same UI can scale
 * to thousands of records; otherwise falls back to the in-repo seed so the app
 * always works offline.
 */
export async function loadEvents(): Promise<HistEvent[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}events.json`, { cache: 'no-cache' })
    if (res.ok) {
      const data = (await res.json()) as unknown
      if (Array.isArray(data) && data.length > 0 && data.every(isValidEvent)) {
        return (data as HistEvent[]).slice().sort((a, b) => a.year - b.year)
      }
    }
  } catch {
    // Offline or no generated dataset — fall back to the seed.
  }
  return EVENTS
}

import type { HistEvent } from './types'
import { CATEGORY_MAP } from '../data/categories'

export interface SearchHit {
  event: HistEvent
  score: number
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // strip accents
    .trim()
}

/** Cheap bounded Levenshtein for single-word fuzzy / spelling tolerance. */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > max) return max + 1
  let prev = new Array(bl + 1)
  let curr = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > max) return max + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[bl]
}

interface IndexedEvent {
  event: HistEvent
  title: string
  haystack: string
  tokens: string[]
}

/** A tiny in-memory search index over titles, people, places and categories. */
export class SearchIndex {
  private items: IndexedEvent[]

  constructor(events: HistEvent[]) {
    this.items = events.map((event) => {
      const parts = [
        event.title,
        event.description,
        event.location ?? '',
        ...(event.people ?? []),
        ...event.categories.map((c) => CATEGORY_MAP[c]?.label ?? c),
      ]
      const haystack = norm(parts.join(' '))
      return {
        event,
        title: norm(event.title),
        haystack,
        tokens: Array.from(new Set(haystack.split(/[^a-z0-9]+/).filter((t) => t.length > 1))),
      }
    })
  }

  search(query: string, limit = 8): SearchHit[] {
    const q = norm(query)
    if (!q) return []
    const qTokens = q.split(/[^a-z0-9]+/).filter(Boolean)
    const hits: SearchHit[] = []

    for (const item of this.items) {
      let score = 0
      if (item.title === q) score += 100
      if (item.title.startsWith(q)) score += 40
      if (item.title.includes(q)) score += 25
      else if (item.haystack.includes(q)) score += 10

      for (const qt of qTokens) {
        if (qt.length < 2) continue
        let best = 0
        for (const tok of item.tokens) {
          if (tok === qt) {
            best = Math.max(best, 12)
          } else if (tok.startsWith(qt)) {
            best = Math.max(best, 8)
          } else if (qt.length >= 4 && Math.abs(tok.length - qt.length) <= 2) {
            const d = editDistance(qt, tok, 1)
            if (d <= 1) best = Math.max(best, 6) // spelling tolerance
          }
        }
        score += best
      }

      if (score > 0) {
        // Nudge by significance so ties resolve toward notable events.
        score += item.event.significance / 100
        hits.push({ event: item.event, score })
      }
    }

    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }
}

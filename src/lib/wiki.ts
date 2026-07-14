import type { HistEvent } from './types'

export interface WikiSummary {
  extract?: string
  thumbnail?: string
  pageUrl?: string
}

const cache = new Map<string, WikiSummary | null>()
const inflight = new Map<string, Promise<WikiSummary | null>>()

/** Canonical English-Wikipedia article URL for an event, if it has a title. */
export function wikipediaUrl(ev: HistEvent): string | null {
  if (!ev.wikiTitle) return null
  return `https://en.wikipedia.org/wiki/${ev.wikiTitle}`
}

/** Wikidata entity URL, when a Q-id is known. */
export function wikidataUrl(ev: HistEvent): string | null {
  if (!ev.wikidataId) return null
  return `https://www.wikidata.org/wiki/${ev.wikidataId}`
}

/**
 * Fetch a Wikipedia summary (lead image + extract) for an event, client-side.
 * Cached, de-duplicated, and safe to call when offline — it simply resolves to
 * null and the UI falls back to the seeded description and a placeholder.
 */
export async function fetchWikiSummary(ev: HistEvent): Promise<WikiSummary | null> {
  const title = ev.wikiTitle
  if (!title) return null
  if (cache.has(title)) return cache.get(title) ?? null
  const existing = inflight.get(title)
  if (existing) return existing

  const promise = (async () => {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as {
        extract?: string
        thumbnail?: { source?: string }
        originalimage?: { source?: string }
        content_urls?: { desktop?: { page?: string } }
      }
      const summary: WikiSummary = {
        extract: data.extract,
        thumbnail: data.thumbnail?.source ?? data.originalimage?.source,
        pageUrl: data.content_urls?.desktop?.page,
      }
      cache.set(title, summary)
      return summary
    } catch {
      cache.set(title, null)
      return null
    } finally {
      inflight.delete(title)
    }
  })()

  inflight.set(title, promise)
  return promise
}

import type { HistEvent } from './types'

/**
 * Drill-down "moments" synthesized from the sections of an event's Wikipedia
 * article — the most granular pages become the most granular dots. When you
 * dive into a leaf event, its article's top-level sections (Background, the
 * unfolding phases, Aftermath, …) spread across the event's span as moment
 * children.
 */

const SKIP_SECTIONS =
  /^(references|external links|see also|notes?|bibliography|sources|further reading|citations|footnotes|gallery|works cited|explanatory notes|primary sources|secondary sources)$/i

interface ParseSection {
  toclevel?: number
  line?: string
  anchor?: string
  index?: string
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

const attempted = new Set<string>()
const inflight = new Map<string, Promise<HistEvent[]>>()

/** True once we've tried (successfully or not) to expand this event. */
export function momentsAttempted(ev: HistEvent): boolean {
  return attempted.has(ev.id)
}

export function canFetchMoments(ev: HistEvent): boolean {
  return !!ev.wikiTitle && ev.tier !== 'moment' && !attempted.has(ev.id)
}

/**
 * Fetch the article's section headings and turn them into moment events.
 * Resolves to [] when offline, the article has no usable sections, or the
 * event has already been expanded. Safe to call repeatedly.
 */
export async function fetchSectionMoments(ev: HistEvent): Promise<HistEvent[]> {
  if (!canFetchMoments(ev)) return []
  const existing = inflight.get(ev.id)
  if (existing) return existing

  const promise = (async () => {
    const title = ev.wikiTitle!.split('#')[0]
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
          title,
        )}&prop=sections&format=json&formatversion=2&origin=*&redirects=1`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { parse?: { sections?: ParseSection[] } }
      const sections = (data.parse?.sections ?? [])
        .filter((s) => s.toclevel === 1)
        .map((s) => ({ ...s, clean: stripHtml(s.line ?? '') }))
        .filter((s) => s.clean.length > 0 && !SKIP_SECTIONS.test(s.clean))
      attempted.add(ev.id)
      if (sections.length < 2) return []

      const spanYears = Math.max(0, (ev.endYear ?? ev.year) - ev.year)
      const n = sections.length
      return sections.map((s, i) => {
        const t = (i + 0.5) / n
        const moment: HistEvent = {
          id: `${ev.id}_s${s.index ?? i}`,
          title: s.clean,
          // Sections narrate the event in order — spread them across its span
          // (or across its single day via dayFraction) so they fan out on zoom.
          year: spanYears > 0 ? ev.year + t * spanYears : ev.year,
          month: spanYears > 0 ? undefined : ev.month,
          day: spanYears > 0 ? undefined : ev.day,
          dayFraction: spanYears > 0 ? undefined : t,
          sequence: i,
          precision: ev.precision,
          type: 'moment',
          tier: 'moment',
          parentId: ev.id,
          categories: ev.categories,
          significance: Math.max(12, ev.significance - 30),
          description: `“${s.clean}” — from the Wikipedia article on ${ev.title}.`,
          wikiTitle: s.anchor ? `${title}#${s.anchor}` : title,
        }
        return moment
      })
    } catch {
      // Offline or the article couldn't be parsed — don't mark attempted, so a
      // later try can succeed once the network is back.
      return []
    } finally {
      inflight.delete(ev.id)
    }
  })()

  inflight.set(ev.id, promise)
  return promise
}

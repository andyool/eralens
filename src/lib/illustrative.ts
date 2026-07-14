import type { HistEvent } from './types'

/**
 * Generate clearly-labelled *illustrative* sub-moments beneath real events, so
 * the field shows the dense "thousands of dots" cloud and the war → battle →
 * moment drill-down works offline with zero setup.
 *
 * These are placeholders: they never assert a specific historical fact, they are
 * flagged `illustrative: true` (the UI badges them and dims them), and they are
 * only added when the user turns on "illustrative detail". Real scale comes from
 * `npm run fetch:wikidata`.
 */

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0xffffffff
}

const PLACEHOLDER_DESC =
  'An illustrative placeholder sub-moment, added to demonstrate zooming into finer detail. It is not a sourced historical record — real sub-events come from the data pipeline.'

export function generateIllustrative(base: HistEvent[]): HistEvent[] {
  const parentIds = new Set<string>()
  for (const e of base) if (e.parentId) parentIds.add(e.parentId)

  // Eligible parents: real, recorded-history leaves (don't subdivide deep time,
  // events that already have curated children, or curated moments themselves —
  // real moments must stay as the deepest level, not get buried under filler).
  const eligible = base.filter(
    (e) =>
      !e.illustrative &&
      !parentIds.has(e.id) &&
      e.type !== 'moment' &&
      e.tier !== 'moment' &&
      e.year > -4000,
  )

  const out: HistEvent[] = []
  for (const parent of eligible) {
    const count = Math.round(6 + (parent.significance / 100) * 34) // 6 … 40
    const isPoint = parent.precision === 'day' || parent.precision === 'month' || !parent.endYear
    const start = parent.year
    const end = parent.endYear ?? parent.year

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const jitter = (hash(`${parent.id}:${i}`) - 0.5) * (0.6 / count)
      const frac = Math.min(0.999, Math.max(0.001, t + jitter))
      const child: HistEvent = {
        id: `${parent.id}__m${i}`,
        title: `${parent.title}: detail ${i + 1}`,
        year: isPoint ? parent.year : Math.round(start + (end - start) * frac),
        month: isPoint ? parent.month : undefined,
        day: isPoint ? parent.day : undefined,
        precision: isPoint ? 'day' : 'year',
        type: 'moment',
        tier: 'moment',
        categories: parent.categories,
        significance: 14 + Math.round(hash(`${parent.id}:s:${i}`) * 22),
        description: PLACEHOLDER_DESC,
        parentId: parent.id,
        sequence: i,
        // Spread point-event moments across the middle of the day.
        dayFraction: isPoint ? 0.2 + frac * 0.6 : undefined,
        illustrative: true,
      }
      out.push(child)
    }
  }

  return out
}

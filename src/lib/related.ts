import type { HistEvent, EventRelation } from './types'
import { warp } from './timeMapping'

export type RelationKind =
  | 'led_to'
  | 'caused_by'
  | 'same_movement'
  | 'same_person'
  | 'same_place'
  | 'contemporary'
  | 'same_field'

export interface RelatedGroup {
  kind: RelationKind
  label: string
  events: HistEvent[]
}

const LABELS: Record<RelationKind, string> = {
  led_to: 'Led to',
  caused_by: 'Caused by',
  same_movement: 'Part of the same movement',
  same_person: 'Same people',
  same_place: 'Same place',
  contemporary: 'Around the same time',
  same_field: 'Same field',
}

const GROUP_ORDER: RelationKind[] = [
  'led_to',
  'caused_by',
  'same_movement',
  'same_person',
  'same_place',
  'contemporary',
  'same_field',
]

function invert(kind: EventRelation['kind']): RelationKind {
  if (kind === 'led_to') return 'caused_by'
  if (kind === 'caused_by') return 'led_to'
  return 'same_movement'
}

/**
 * Turn a single event into a set of *labelled* onward paths, so connections are
 * educationally meaningful rather than a generic "you might also like" list.
 */
export function relatedEvents(
  ev: HistEvent,
  all: HistEvent[],
  byId: Map<string, HistEvent>,
  maxPerGroup = 4,
): RelatedGroup[] {
  const buckets = new Map<RelationKind, HistEvent[]>()
  const used = new Set<string>([ev.id])
  const add = (kind: RelationKind, target?: HistEvent) => {
    if (!target || used.has(target.id)) return
    used.add(target.id)
    const list = buckets.get(kind) ?? []
    list.push(target)
    buckets.set(kind, list)
  }

  // 1. Explicit curated relations (forward).
  for (const rel of ev.relations ?? []) add(rel.kind, byId.get(rel.id))

  // 2. Explicit relations pointing at this event (inverted).
  for (const other of all) {
    for (const rel of other.relations ?? []) {
      if (rel.id === ev.id) add(invert(rel.kind), other)
    }
  }

  // 3. Shared people.
  if (ev.people?.length) {
    const people = new Set(ev.people)
    const shared = all
      .filter((o) => !used.has(o.id) && o.people?.some((p) => people.has(p)))
      .sort((a, b) => b.significance - a.significance)
    for (const o of shared.slice(0, maxPerGroup)) add('same_person', o)
  }

  // 4. Same place.
  if (ev.location) {
    const shared = all
      .filter((o) => !used.has(o.id) && o.location === ev.location)
      .sort((a, b) => b.significance - a.significance)
    for (const o of shared.slice(0, maxPerGroup)) add('same_place', o)
  }

  // 5. Contemporaries — near in *perceived* (warped) time, so the window scales
  //    from years in the modern era to millennia in deep time.
  const w0 = warp(ev.year)
  const contemporaries = all
    .filter((o) => !used.has(o.id) && Math.abs(warp(o.year) - w0) < 70)
    .map((o) => ({ o, d: Math.abs(warp(o.year) - w0) }))
    .sort((a, b) => a.d - b.d || b.o.significance - a.o.significance)
  for (const { o } of contemporaries.slice(0, maxPerGroup)) add('contemporary', o)

  // 6. Same field (shared category), ranked by significance × recency-of-topic.
  const cats = new Set(ev.categories)
  const sameField = all
    .filter((o) => !used.has(o.id) && o.categories.some((c) => cats.has(c)))
    .sort((a, b) => b.significance - a.significance)
  for (const o of sameField.slice(0, maxPerGroup)) add('same_field', o)

  return GROUP_ORDER.map((kind) => ({
    kind,
    label: LABELS[kind],
    events: (buckets.get(kind) ?? []).slice(0, maxPerGroup),
  })).filter((g) => g.events.length > 0)
}

/** A flat, de-duplicated "feeling lucky"-style pick of the most related events. */
export function topRelated(
  ev: HistEvent,
  all: HistEvent[],
  byId: Map<string, HistEvent>,
  n = 6,
): HistEvent[] {
  const groups = relatedEvents(ev, all, byId, n)
  const out: HistEvent[] = []
  const seen = new Set<string>()
  // Interleave groups so the list is varied.
  let i = 0
  let added = true
  while (out.length < n && added) {
    added = false
    for (const g of groups) {
      const e = g.events[i]
      if (e && !seen.has(e.id)) {
        seen.add(e.id)
        out.push(e)
        added = true
        if (out.length >= n) break
      }
    }
    i++
  }
  return out
}

export function relationLabel(kind: RelationKind): string {
  return LABELS[kind]
}

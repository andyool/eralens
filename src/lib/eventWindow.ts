import type { HistEvent, TimeView } from './types'

/**
 * Windowing helpers over a year-sorted event array. The master dataset is
 * sorted oldest → newest once at load time, so everything derived from "the
 * events inside the current view" (list view, sidebar counts, the navigator
 * histogram, keyboard navigation) can be a binary-search slice instead of an
 * O(n) filter-and-sort over the full 100k+ events on every pan/zoom tick.
 */

export function isSortedByYear(events: HistEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (events[i].year < events[i - 1].year) return false
  }
  return true
}

/** A year-sorted copy — or the input itself when it is already sorted. */
export function sortByYear(events: HistEvent[]): HistEvent[] {
  if (isSortedByYear(events)) return events
  return [...events].sort((a, b) => a.year - b.year)
}

/** First index whose year is >= `year` (lower bound). */
export function lowerBound(events: HistEvent[], year: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[mid].year < year) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index whose year is > `year` (upper bound). */
export function upperBound(events: HistEvent[], year: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[mid].year <= year) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The contiguous slice of a year-sorted array whose years fall inside the
 * view (inclusive on both edges).
 */
export function sliceInView(events: HistEvent[], view: TimeView): HistEvent[] {
  const lo = lowerBound(events, view.startYear)
  const hi = upperBound(events, view.endYear)
  return lo >= hi ? [] : events.slice(lo, hi)
}

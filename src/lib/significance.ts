import type { HistEvent } from './types'

/** Normalised 0..1 importance. */
export function significance01(ev: HistEvent): number {
  return Math.max(0, Math.min(1, ev.significance / 100))
}

/**
 * A rough 0..1 "how much media backs this" signal. Stage 2 will replace this
 * with real image/video availability; for now it is inferred from having a
 * source article and a healthy significance.
 */
export function mediaQuality(ev: HistEvent): number {
  let q = 0
  if (ev.wikiTitle) q += 0.6
  if (ev.coordinates) q += 0.1
  q += significance01(ev) * 0.3
  return Math.min(1, q)
}

/** Popularity proxy (0..1). Distinct field in Stage 2; significance for now. */
export function popularity(ev: HistEvent): number {
  return significance01(ev)
}

/**
 * Cursor-selection score, per the brief:
 *   0.50·significance + 0.30·proximity + 0.10·mediaQuality + 0.10·popularity
 * `proximity` is 0..1 (1 = right under the cursor).
 */
export function selectionScore(ev: HistEvent, proximity: number): number {
  return (
    significance01(ev) * 0.5 +
    proximity * 0.3 +
    mediaQuality(ev) * 0.1 +
    popularity(ev) * 0.1
  )
}

/** Base dot radius in CSS px, scaled gently by significance. */
export function baseRadius(ev: HistEvent): number {
  return 1.7 + significance01(ev) * 2.1
}

import type { TimeView } from './types'

/**
 * Adaptive time mapping — the heart of the "one control from a year to the Big
 * Bang" idea.
 *
 * A linear timeline is useless here: recorded human history is a rounding error
 * next to 13.8 billion years. We warp time with a transform that is *linear for
 * recent millennia* and *logarithmic for deep time*, joined smoothly (C1
 * continuous) so there is no visible kink at the seam.
 *
 * Everything else — the main view, the navigator, tick marks, hit-testing —
 * is expressed as linear interpolation in this warped space, which is what makes
 * the navigator's sensitivity change automatically with the era on screen.
 */

/** Reference "now". Events top out here; BP (before present) is measured from it. */
export const PRESENT_YEAR = 2026
/** The Big Bang, in astronomical years (~13.8 billion years ago). */
export const MIN_YEAR = -13_800_000_000
export const MAX_YEAR = PRESENT_YEAR

/**
 * Width of the near-linear recent zone, in years before present. Inside this
 * span the mapping is exactly linear, so zooming into (say) 1900–2026 behaves
 * like an ordinary timeline with no distortion. Beyond it, the mapping goes
 * logarithmic to swallow the eons.
 */
const LINEAR_SPAN = 3000

/** Years before present for an astronomical year. Clamped to the domain. */
export function beforePresent(year: number): number {
  const bp = PRESENT_YEAR - year
  return bp < 0 ? 0 : bp
}

/**
 * The warp. Maps years-before-present → a monotonic "warped" coordinate that
 * grows linearly then logarithmically. Larger = further in the past.
 */
export function warp(year: number): number {
  const bp = beforePresent(year)
  if (bp <= LINEAR_SPAN) return bp
  return LINEAR_SPAN * (1 + Math.log(bp / LINEAR_SPAN))
}

/** Inverse of {@link warp}: warped coordinate → astronomical year. */
export function unwarp(w: number): number {
  let bp: number
  if (w <= LINEAR_SPAN) bp = w
  else bp = LINEAR_SPAN * Math.exp(w / LINEAR_SPAN - 1)
  return PRESENT_YEAR - bp
}

const WARP_MIN = warp(MAX_YEAR) // 0, the present (right edge)
const WARP_MAX = warp(MIN_YEAR) // the Big Bang (left edge)

/** Position of a year within a view, as a 0..1 fraction (0 = left/older edge). */
export function fractionInView(year: number, view: TimeView): number {
  const tStart = warp(view.startYear) // older → larger
  const tEnd = warp(view.endYear) // newer → smaller
  const span = tStart - tEnd
  if (span <= 0) return 0
  return (tStart - warp(year)) / span
}

/** Pixel x of a year within a view of the given pixel width. */
export function yearToX(year: number, view: TimeView, width: number): number {
  return fractionInView(year, view) * width
}

/** Inverse of {@link yearToX}: which year sits at pixel x in this view. */
export function xToYear(x: number, view: TimeView, width: number): number {
  const tStart = warp(view.startYear)
  const tEnd = warp(view.endYear)
  const frac = width <= 0 ? 0 : x / width
  const w = tStart - frac * (tStart - tEnd)
  return unwarp(w)
}

/** Map a year onto the full Big-Bang→now navigator track, as a 0..1 fraction. */
export function fractionOnFullAxis(year: number): number {
  const span = WARP_MAX - WARP_MIN
  return (WARP_MAX - warp(year)) / span
}

/** Inverse of {@link fractionOnFullAxis}. */
export function yearAtFullAxisFraction(frac: number): number {
  const w = WARP_MAX - frac * (WARP_MAX - WARP_MIN)
  return unwarp(w)
}

/** The perceptual (warp-space) midpoint year of a view. */
export function viewMidYear(view: TimeView): number {
  return unwarp((warp(view.startYear) + warp(view.endYear)) / 2)
}

/** Clamp a view to the valid domain and keep start strictly older than end. */
export function clampView(view: TimeView): TimeView {
  let startYear = Math.max(MIN_YEAR, Math.min(view.startYear, MAX_YEAR))
  let endYear = Math.max(MIN_YEAR, Math.min(view.endYear, MAX_YEAR))
  if (startYear >= endYear) {
    // Keep a tiny minimum span so the view never collapses, but allow sub-year
    // zoom so the moments inside a single day (e.g. a battle) can spread out.
    const mid = (startYear + endYear) / 2
    const minHalfSpan = 0.0004
    startYear = Math.max(MIN_YEAR, mid - minHalfSpan)
    endYear = Math.min(MAX_YEAR, mid + minHalfSpan)
  }
  return { startYear, endYear }
}

/**
 * Zoom a view around a focal year (0..1 across the view) by a factor in warped
 * space. factor < 1 zooms in, > 1 zooms out. Used for wheel + pinch zoom.
 */
export function zoomView(view: TimeView, focalFraction: number, factor: number): TimeView {
  const tStart = warp(view.startYear)
  const tEnd = warp(view.endYear)
  const tFocal = tStart - focalFraction * (tStart - tEnd)
  const newStart = tFocal + (tStart - tFocal) * factor
  const newEnd = tFocal + (tEnd - tFocal) * factor
  return clampView({ startYear: unwarp(newStart), endYear: unwarp(newEnd) })
}

/** Pan a view by a fraction of its (warped) width. Positive = toward the past. */
export function panView(view: TimeView, fraction: number): TimeView {
  const tStart = warp(view.startYear)
  const tEnd = warp(view.endYear)
  const delta = (tStart - tEnd) * fraction
  return clampView({ startYear: unwarp(tStart + delta), endYear: unwarp(tEnd + delta) })
}

/**
 * A view centred on a year with symmetric padding in *warped* space, so the
 * window is a few decades wide for modern events and millennia wide for ancient
 * ones — used when jumping to a search result, related event or random pick.
 */
export function viewAround(year: number, padWarp = 70): TimeView {
  const w = warp(year)
  return clampView({ startYear: unwarp(w + padWarp), endYear: unwarp(Math.max(WARP_MIN, w - padWarp)) })
}

/**
 * A view that frames a node's [spanStart, spanEnd] with a little breathing room,
 * used when you drill into a container. Works in warped space so a one-day
 * battle and a thousand-year empire both zoom to a sensible window.
 */
export function viewFromSpan(spanStart: number, spanEnd: number, padFactor = 0.3): TimeView {
  // Pad in year-space with a small floor: proportional room for wide spans,
  // and a fraction-of-a-day floor so an instant zooms tight enough to open up.
  const span = Math.max(0, spanEnd - spanStart)
  const pad = Math.max(span * padFactor, 0.0004)
  return clampView({ startYear: spanStart - pad, endYear: spanEnd + pad })
}

export interface AxisTick {
  year: number
  fraction: number
  label: string
  major: boolean
}

// Candidate tick steps (in years) from fine to geological.
const TICK_STEPS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000,
  500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000, 500_000_000, 1_000_000_000,
  5_000_000_000,
]

function shortYearLabel(year: number): string {
  const bp = PRESENT_YEAR - year
  if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(bp >= 1e10 ? 0 : 1)} Gya`
  if (bp >= 1_000_000) return `${Math.round(bp / 1_000_000)} Mya`
  if (bp >= 100_000) return `${Math.round(bp / 1000)} kya`
  if (year < 0) return `${Math.abs(Math.round(year)).toLocaleString()} BCE`
  if (year === 0) return '1 BCE'
  return `${Math.round(year)}`
}

/**
 * Generate readable, non-overlapping tick marks for a view. Because of the warp
 * they cluster where time is compressed — exactly the behaviour we want.
 */
export function axisTicks(view: TimeView, width: number, minGapPx = 64): AxisTick[] {
  const span = Math.abs(view.endYear - view.startYear)
  // Aim for ~ width / (minGap*1.4) ticks; pick the smallest step that fits.
  const targetCount = Math.max(2, Math.floor(width / (minGapPx * 1.4)))
  let step = TICK_STEPS[TICK_STEPS.length - 1]
  for (const candidate of TICK_STEPS) {
    if (span / candidate <= targetCount) {
      step = candidate
      break
    }
  }
  const first = Math.ceil(view.startYear / step) * step
  const ticks: AxisTick[] = []
  let lastX = -Infinity
  for (let y = first; y <= view.endYear; y += step) {
    const fraction = fractionInView(y, view)
    const x = fraction * width
    if (x - lastX < minGapPx) continue
    lastX = x
    ticks.push({ year: y, fraction, label: shortYearLabel(y), major: y === 0 || y % (step * 5) === 0 })
  }
  return ticks
}

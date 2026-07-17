import { describe, expect, it } from 'vitest'
import {
  MIN_YEAR,
  MAX_YEAR,
  PRESENT_YEAR,
  warp,
  unwarp,
  clampView,
  zoomView,
  panView,
  viewAround,
  viewFromSpan,
  viewMidYear,
  fractionInView,
  fractionOnFullAxis,
  yearAtFullAxisFraction,
  axisTicks,
} from './timeMapping'

const SAMPLE_YEARS = [2020, 1969, 1000, 0, -974, -5000, -100_000, -1_000_000, -1_000_000_000, MIN_YEAR]

describe('warp / unwarp', () => {
  it('round-trips years across every magnitude', () => {
    for (const y of SAMPLE_YEARS) {
      const back = unwarp(warp(y))
      const tolerance = Math.max(1e-6 * Math.abs(y), 1e-6)
      expect(Math.abs(back - y)).toBeLessThanOrEqual(tolerance)
    }
  })

  it('is strictly monotonic: older years warp larger', () => {
    for (let i = 1; i < SAMPLE_YEARS.length; i++) {
      expect(warp(SAMPLE_YEARS[i])).toBeGreaterThan(warp(SAMPLE_YEARS[i - 1]))
    }
  })

  it('is continuous at the linear/log seam', () => {
    const seamYear = PRESENT_YEAR - 3000
    const eps = 0.001
    const below = warp(seamYear + eps)
    const above = warp(seamYear - eps)
    expect(Math.abs(above - below)).toBeLessThan(0.01)
  })

  it('anchors the present at zero', () => {
    expect(warp(PRESENT_YEAR)).toBe(0)
    expect(warp(PRESENT_YEAR + 50)).toBe(0) // future clamps to now
  })
})

describe('clampView', () => {
  it('clamps to the valid domain', () => {
    const v = clampView({ startYear: MIN_YEAR * 2, endYear: MAX_YEAR + 1e9 })
    expect(v.startYear).toBe(MIN_YEAR)
    expect(v.endYear).toBe(MAX_YEAR)
  })

  it('never collapses to a zero span', () => {
    const v = clampView({ startYear: 1000, endYear: 1000 })
    expect(v.endYear).toBeGreaterThan(v.startYear)
    expect(v.startYear).toBeLessThanOrEqual(1000)
    expect(v.endYear).toBeGreaterThanOrEqual(1000)
  })

  it('repairs an inverted view', () => {
    const v = clampView({ startYear: 1500, endYear: 1400 })
    expect(v.endYear).toBeGreaterThan(v.startYear)
  })
})

describe('zoomView', () => {
  it('scales the warped span by the factor', () => {
    const view = { startYear: 1000, endYear: 2000 }
    const before = warp(view.startYear) - warp(view.endYear)
    const zoomed = zoomView(view, 0.5, 0.5)
    const after = warp(zoomed.startYear) - warp(zoomed.endYear)
    expect(after / before).toBeCloseTo(0.5, 5)
  })

  it('keeps the focal year at the same on-screen fraction', () => {
    const view = { startYear: 1000, endYear: 2000 }
    const focalFraction = 0.25
    const zoomed = zoomView(view, focalFraction, 0.5)
    // The year that sat at 25% across before must still sit at 25% after.
    const tStart = warp(view.startYear)
    const tEnd = warp(view.endYear)
    const focalYear = unwarp(tStart - focalFraction * (tStart - tEnd))
    expect(fractionInView(focalYear, zoomed)).toBeCloseTo(focalFraction, 5)
  })
})

describe('panView', () => {
  it('preserves the warped width', () => {
    const view = { startYear: -5000, endYear: 2000 }
    const before = warp(view.startYear) - warp(view.endYear)
    const panned = panView(view, 0.3)
    const after = warp(panned.startYear) - warp(panned.endYear)
    expect(after).toBeCloseTo(before, 4)
  })

  it('moves toward the past for positive fractions', () => {
    const view = { startYear: 1900, endYear: 2000 }
    const panned = panView(view, 0.5)
    expect(panned.startYear).toBeLessThan(view.startYear)
    expect(panned.endYear).toBeLessThan(view.endYear)
  })
})

describe('view helpers', () => {
  it('viewAround contains the year', () => {
    for (const y of [1969, -3000, -1_000_000]) {
      const v = viewAround(y)
      expect(v.startYear).toBeLessThanOrEqual(y)
      expect(v.endYear).toBeGreaterThanOrEqual(y)
    }
  })

  it('viewFromSpan frames the span with padding', () => {
    const v = viewFromSpan(1939, 1945)
    expect(v.startYear).toBeLessThan(1939)
    expect(v.endYear).toBeGreaterThan(1945)
  })

  it('viewMidYear is the arithmetic middle inside the linear zone', () => {
    expect(viewMidYear({ startYear: 2000, endYear: 2020 })).toBeCloseTo(2010, 6)
  })
})

describe('full-axis mapping', () => {
  it('spans 0..1 from the Big Bang to now', () => {
    expect(fractionOnFullAxis(MIN_YEAR)).toBeCloseTo(0, 9)
    expect(fractionOnFullAxis(MAX_YEAR)).toBeCloseTo(1, 9)
  })

  it('yearAtFullAxisFraction inverts fractionOnFullAxis', () => {
    for (const f of [0.1, 0.5, 0.9, 0.99]) {
      expect(fractionOnFullAxis(yearAtFullAxisFraction(f))).toBeCloseTo(f, 6)
    }
  })
})

describe('axisTicks', () => {
  it('produces in-range, spaced, labelled ticks for a modern window', () => {
    const view = { startYear: 1900, endYear: 2000 }
    const ticks = axisTicks(view, 800)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    let lastX = -Infinity
    for (const t of ticks) {
      expect(t.fraction).toBeGreaterThanOrEqual(0)
      expect(t.fraction).toBeLessThanOrEqual(1)
      expect(t.label.length).toBeGreaterThan(0)
      const x = t.fraction * 800
      expect(x - lastX).toBeGreaterThanOrEqual(63.9)
      lastX = x
    }
  })

  it('handles the full deep-time domain without blowing up', () => {
    const ticks = axisTicks({ startYear: MIN_YEAR, endYear: MAX_YEAR }, 1200)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    for (const t of ticks) {
      expect(t.fraction).toBeGreaterThanOrEqual(0)
      expect(t.fraction).toBeLessThanOrEqual(1)
    }
  })
})

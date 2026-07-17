import { describe, expect, it } from 'vitest'
import type { HistEvent } from './types'
import { isSortedByYear, lowerBound, sliceInView, sortByYear, upperBound } from './eventWindow'

function mk(id: string, year: number): HistEvent {
  return {
    id,
    title: id,
    year,
    precision: 'year',
    type: 'event',
    categories: ['politics'],
    significance: 50,
    description: '',
  }
}

const SORTED = [mk('a', 1), mk('b', 2), mk('c', 2), mk('d', 2), mk('e', 3), mk('f', 10)]

describe('lowerBound / upperBound', () => {
  it('finds the first index at or above a year', () => {
    expect(lowerBound(SORTED, 2)).toBe(1)
    expect(lowerBound(SORTED, 0)).toBe(0)
    expect(lowerBound(SORTED, 11)).toBe(SORTED.length)
    expect(lowerBound(SORTED, 4)).toBe(5)
  })

  it('finds the first index strictly above a year', () => {
    expect(upperBound(SORTED, 2)).toBe(4)
    expect(upperBound(SORTED, 10)).toBe(SORTED.length)
    expect(upperBound(SORTED, 0)).toBe(0)
  })
})

describe('sliceInView', () => {
  it('is inclusive on both edges', () => {
    const slice = sliceInView(SORTED, { startYear: 2, endYear: 3 })
    expect(slice.map((e) => e.id)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('returns empty for a window with no events', () => {
    expect(sliceInView(SORTED, { startYear: 4, endYear: 9 })).toEqual([])
  })

  it('returns everything for a covering window', () => {
    expect(sliceInView(SORTED, { startYear: -100, endYear: 100 })).toHaveLength(SORTED.length)
  })
})

describe('sortByYear', () => {
  it('returns the same reference when already sorted', () => {
    expect(isSortedByYear(SORTED)).toBe(true)
    expect(sortByYear(SORTED)).toBe(SORTED)
  })

  it('returns a sorted copy otherwise, leaving the input untouched', () => {
    const shuffled = [mk('x', 5), mk('y', 1), mk('z', 3)]
    const sorted = sortByYear(shuffled)
    expect(sorted.map((e) => e.year)).toEqual([1, 3, 5])
    expect(shuffled.map((e) => e.year)).toEqual([5, 1, 3])
  })
})

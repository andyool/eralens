import { describe, expect, it } from 'vitest'
import type { HistEvent } from './types'
import { SearchIndex } from './search'

function mk(id: string, title: string, extra: Partial<HistEvent> = {}): HistEvent {
  return {
    id,
    title,
    year: 1900,
    precision: 'year',
    type: 'event',
    categories: ['politics'],
    significance: 50,
    description: '',
    ...extra,
  }
}

const EVENTS = [
  mk('hastings', 'The Battle of Hastings', { people: ['William the Conqueror'] }),
  mk('ww2', 'World War II', { significance: 99 }),
  mk('ww1', 'World War I', { significance: 95 }),
  mk('cafe', 'The Café Terrace at Night', { categories: ['art'] }),
  mk('moon', 'Apollo 11 Moon landing', { location: 'Sea of Tranquility' }),
]

const index = new SearchIndex(EVENTS)

describe('SearchIndex', () => {
  it('ranks an exact title match first', () => {
    const hits = index.search('world war ii')
    expect(hits[0].event.id).toBe('ww2')
  })

  it('matches on token prefixes', () => {
    const hits = index.search('hast')
    expect(hits.map((h) => h.event.id)).toContain('hastings')
  })

  it('tolerates a single-letter typo', () => {
    const hits = index.search('hastngs')
    expect(hits.map((h) => h.event.id)).toContain('hastings')
  })

  it('ignores accents', () => {
    const hits = index.search('cafe')
    expect(hits.map((h) => h.event.id)).toContain('cafe')
  })

  it('searches people and places too', () => {
    expect(index.search('conqueror').map((h) => h.event.id)).toContain('hastings')
    expect(index.search('tranquility').map((h) => h.event.id)).toContain('moon')
  })

  it('returns nothing for queries under two characters', () => {
    expect(index.search('w')).toEqual([])
    expect(index.search('')).toEqual([])
  })

  it('uses significance to break near-ties', () => {
    const hits = index.search('world war')
    const ids = hits.map((h) => h.event.id)
    expect(ids.indexOf('ww2')).toBeLessThan(ids.indexOf('ww1'))
  })

  it('respects the result limit', () => {
    const many = new SearchIndex(
      Array.from({ length: 30 }, (_, i) => mk(`e${i}`, `Treaty number ${i}`)),
    )
    expect(many.search('treaty', 8)).toHaveLength(8)
  })
})

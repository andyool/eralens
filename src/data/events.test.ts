import { describe, expect, it } from 'vitest'
import type { HistEvent } from '../lib/types'
import { EVENTS, expandCompact, mergeWithSeed, type CompactPayload, type CompactRow } from './events'

function row(overrides: Partial<Record<number, unknown>> = {}): CompactRow {
  const base: CompactRow = ['Q1', 'Test Battle', 1066, 10, 14, 0, 80, 0b1, 1, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const [k, v] of Object.entries(overrides)) {
    ;(base as unknown[])[Number(k)] = v
  }
  return base
}

function payload(events: CompactRow[]): CompactPayload {
  return { format: 'eralens-compact-1', categories: ['wars', 'politics'], events }
}

describe('expandCompact', () => {
  it('expands a compact row into a full event', () => {
    const [ev] = expandCompact(payload([row()]))
    expect(ev.id).toBe('wd_Q1')
    expect(ev.title).toBe('Test Battle')
    expect(ev.year).toBe(1066)
    expect(ev.month).toBe(10)
    expect(ev.day).toBe(14)
    expect(ev.precision).toBe('day')
    expect(ev.categories).toEqual(['wars'])
    expect(ev.wikiTitle).toBe('Test_Battle')
  })

  it('decodes category bitmasks against the shipped category list', () => {
    const [ev] = expandCompact(payload([row({ 7: 0b11 })]))
    expect(ev.categories).toEqual(['wars', 'politics'])
  })

  it('treats zeros as absent fields', () => {
    const [ev] = expandCompact(payload([row({ 3: 0, 4: 0, 8: 0 })]))
    expect(ev.month).toBeUndefined()
    expect(ev.day).toBeUndefined()
    expect(ev.precision).toBe('year')
    expect(ev.wikiTitle).toBeUndefined()
  })

  it('wires parents and relations with the wd_ prefix', () => {
    const [ev] = expandCompact(payload([row({ 11: 'Q9', 12: ['Q5'], 13: ['Q6'] })]))
    expect(ev.parentId).toBe('wd_Q9')
    expect(ev.relations).toEqual([
      { id: 'wd_Q5', kind: 'caused_by' },
      { id: 'wd_Q6', kind: 'led_to' },
    ])
  })

  it('skips malformed rows', () => {
    const bad = [42, 'x', 'not-a-year'] as unknown as CompactRow
    expect(expandCompact(payload([bad]))).toEqual([])
  })
})

describe('mergeWithSeed', () => {
  const mk = (id: string, title: string, year: number, extra: Partial<HistEvent> = {}): HistEvent => ({
    id,
    title,
    year,
    precision: 'year',
    type: 'event',
    categories: ['wars'],
    significance: 50,
    description: '',
    ...extra,
  })

  it('drops generated duplicates of seed events (title + close year)', () => {
    const dup = mk('wd_QDUP', 'The Battle of Hastings', 1066)
    const merged = mergeWithSeed([dup])
    expect(merged.some((e) => e.id === 'wd_QDUP')).toBe(false)
    expect(merged.some((e) => e.id === 'hastings')).toBe(true)
    expect(merged).toHaveLength(EVENTS.length)
  })

  it('re-parents children of a dropped duplicate onto the seed event', () => {
    const dup = mk('wd_QDUP', 'The Battle of Hastings', 1066)
    const child = mk('wd_QCHILD', 'Some skirmish', 1066, { parentId: 'wd_QDUP' })
    const merged = mergeWithSeed([dup, child])
    const kept = merged.find((e) => e.id === 'wd_QCHILD')
    expect(kept).toBeDefined()
    expect(kept!.parentId).toBe('hastings')
  })

  it('keeps non-duplicates and returns a year-sorted list', () => {
    const fresh = mk('wd_QNEW', 'A completely new event', 1234)
    const merged = mergeWithSeed([fresh])
    expect(merged.some((e) => e.id === 'wd_QNEW')).toBe(true)
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].year).toBeGreaterThanOrEqual(merged[i - 1].year)
    }
  })
})

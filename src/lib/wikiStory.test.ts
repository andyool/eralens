import { describe, expect, it } from 'vitest'
import { extractDate } from './wikiStory'

describe('extractDate', () => {
  it('parses "14 October 1066"', () => {
    const d = extractDate('The battle was fought on 14 October 1066 near Hastings.', 1066)
    expect(d).not.toBeNull()
    expect(d!.label).toBe('14 October 1066')
    expect(d!.date).toBeCloseTo(1066 + 286 / 365.25, 4)
  })

  it('parses "October 14, 1066"', () => {
    const d = extractDate('On October 14, 1066 the armies met.', 1066)
    expect(d).not.toBeNull()
    expect(d!.date).toBeCloseTo(1066 + 286 / 365.25, 4)
  })

  it('parses a month-year mention', () => {
    const d = extractDate('By October 1066 the invasion fleet was ready.', 1066)
    expect(d).not.toBeNull()
    expect(Math.floor(d!.date)).toBe(1066)
  })

  it('parses BC years as negative', () => {
    const d = extractDate('Caesar was assassinated in 44 BC in Rome.', -44)
    expect(d).not.toBeNull()
    expect(d!.date).toBeLessThan(0)
    expect(Math.round(d!.date)).toBe(-44)
  })

  it('parses "AD 79"', () => {
    const d = extractDate('Vesuvius erupted in AD 79, burying Pompeii.', 79)
    expect(d).not.toBeNull()
    expect(Math.round(d!.date)).toBe(79)
  })

  it('accepts a bare year only after a dating preposition', () => {
    const d = extractDate('The cathedral was completed in 1077 after a decade of work.', 1066)
    expect(d).not.toBeNull()
    expect(Math.round(d!.date)).toBe(1077)
  })

  it('does not read troop counts as years', () => {
    expect(extractDate('He commanded 7000 soldiers and 776 ships that day.', 1066)).toBeNull()
  })

  it('does not read numbers followed by decimals or commas as years', () => {
    expect(extractDate('The army marched in 1066,000 columns.', 1066)).toBeNull()
  })

  it('rejects years far outside the event window', () => {
    expect(extractDate('A plaque added in 1966 commemorates the site.', 1066)).toBeNull()
  })

  it('returns null when there is no date at all', () => {
    expect(extractDate('The terrain favoured the defenders.', 1066)).toBeNull()
  })
})

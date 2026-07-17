import { describe, expect, it } from 'vitest'
import type { HistEvent } from './types'
import { buildForest, decimalYear, isTimeBucket, selectVisibleNodes } from './hierarchy'

function mk(id: string, year: number, extra: Partial<HistEvent> = {}): HistEvent {
  return {
    id,
    title: id,
    year,
    precision: 'year',
    type: 'event',
    categories: ['politics'],
    significance: 50,
    description: '',
    ...extra,
  }
}

describe('decimalYear', () => {
  it('folds month and day into a fraction', () => {
    // 14 October: day-of-year 286 (273 cumulative through September + 13).
    const y = decimalYear(mk('hastings', 1066, { month: 10, day: 14, precision: 'day' }))
    expect(y).toBeCloseTo(1066 + 286 / 365.25, 6)
  })

  it('adds sub-day fractions for battle moments', () => {
    const morning = decimalYear(mk('m1', 1066, { month: 10, day: 14, dayFraction: 0.25 }))
    const evening = decimalYear(mk('m2', 1066, { month: 10, day: 14, dayFraction: 0.9 }))
    expect(evening).toBeGreaterThan(morning)
  })

  it('is the plain year when no month is known', () => {
    expect(decimalYear(mk('x', -3000))).toBe(-3000)
  })
})

describe('buildForest (no clustering)', () => {
  const war = mk('war', 1939, { endYear: 1945, categories: ['wars'] })
  const battle1 = mk('b1', 1940, { parentId: 'war', categories: ['wars'] })
  const battle2 = mk('b2', 1944, { parentId: 'war', categories: ['politics'] })
  const lone = mk('lone', 1900, { categories: ['science'] })

  const forest = buildForest([war, battle1, battle2, lone])

  it('links children to parents via parentId', () => {
    const warNode = forest.map.get('war')!
    expect(warNode.children.map((c) => c.ev.id)).toEqual(['b1', 'b2'])
    expect(forest.map.get('b1')!.parent).toBe(warNode)
    expect(forest.roots.map((r) => r.ev.id).sort()).toEqual(['lone', 'war'])
  })

  it('computes descendant counts and subtree spans', () => {
    const warNode = forest.map.get('war')!
    expect(warNode.descendantCount).toBe(2)
    expect(warNode.spanStart).toBe(1939)
    expect(warNode.spanEnd).toBe(1944)
  })

  it('unions categories across the subtree so filters see through containers', () => {
    const warNode = forest.map.get('war')!
    expect(warNode.subtreeCats.has('wars')).toBe(true)
    expect(warNode.subtreeCats.has('politics')).toBe(true)
    expect(warNode.subtreeCats.has('science')).toBe(false)
  })

  it('orders children chronologically', () => {
    const late = mk('late', 1941, { parentId: 'w2' })
    const early = mk('early', 1940, { parentId: 'w2' })
    const f = buildForest([mk('w2', 1939), late, early])
    expect(f.map.get('w2')!.children.map((c) => c.ev.id)).toEqual(['early', 'late'])
  })
})

describe('buildForest (auto-clustering)', () => {
  it('keeps deep-time events at the top level', () => {
    const f = buildForest([mk('bang', -13_800_000_000), mk('dino', -66_000_000)], { cluster: true })
    expect(f.roots.map((r) => r.ev.id).sort()).toEqual(['bang', 'dino'])
  })

  it('groups same-decade events under one pruned bucket', () => {
    const f = buildForest([mk('apollo', 1969), mk('gagarin', 1961)], { cluster: true })
    // Millennium and century buckets hold a single child each and collapse;
    // the decade bucket holding both events survives as the root.
    expect(f.roots).toHaveLength(1)
    const root = f.roots[0]
    expect(isTimeBucket(root)).toBe(true)
    expect(root.ev.id).toBe('t:dec:1960')
    expect(root.children.map((c) => c.ev.id).sort()).toEqual(['apollo', 'gagarin'])
  })

  it('collapses every singleton bucket around a lone event', () => {
    const f = buildForest([mk('moon', 1969), mk('viking', 969)], { cluster: true })
    // Different millennia — each event's whole bucket chain is singleton and
    // collapses down to the bare event at the root.
    expect(f.roots.map((r) => r.ev.id).sort()).toEqual(['moon', 'viking'])
  })

  it('separates centuries within a shared millennium', () => {
    const f = buildForest([mk('crusade', 1096), mk('magna', 1215), mk('hastings', 1066)], {
      cluster: true,
    })
    expect(f.roots).toHaveLength(1)
    const mill = f.roots[0]
    expect(mill.ev.id).toBe('t:mill:1000')
    // 11th century holds two events; the 13th-century chain collapsed to its event.
    const ids = mill.children.map((c) => c.ev.id).sort()
    expect(ids).toEqual(['magna', 't:cent:1000'])
  })
})

describe('selectVisibleNodes', () => {
  const war = mk('war', 1939)
  const b1 = mk('b1', 1940, { parentId: 'war' })
  const b2 = mk('b2', 1944, { parentId: 'war' })
  const forest = buildForest([war, b1, b2])

  it('collapses containers that are not expandable', () => {
    const nodes = selectVisibleNodes(forest.roots, {
      intersects: () => true,
      expandable: () => false,
    })
    expect(nodes.map((n) => n.ev.id)).toEqual(['war'])
  })

  it('opens expandable containers into their children', () => {
    const nodes = selectVisibleNodes(forest.roots, {
      intersects: () => true,
      expandable: () => true,
    })
    expect(nodes.map((n) => n.ev.id).sort()).toEqual(['b1', 'b2'])
  })

  it('drops subtrees outside the view', () => {
    const nodes = selectVisibleNodes(forest.roots, {
      intersects: (n) => n.spanEnd >= 2000,
      expandable: () => true,
    })
    expect(nodes).toHaveLength(0)
  })
})

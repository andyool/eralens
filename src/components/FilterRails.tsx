import type { CivDef, RegionDef } from '../data/events'
import type { CategoryId } from '../lib/types'
import { CATEGORIES } from '../data/categories'

interface Props {
  civs: CivDef[]
  regions: RegionDef[]
  activeCivMask: number
  activeRegionMask: number
  activeCats: Set<CategoryId>
  onToggleCiv: (bit: number, def: CivDef) => void
  onToggleRegion: (bit: number) => void
  onToggleCat: (id: CategoryId) => void
  onClearAll: () => void
}

/**
 * The filter rows above the canvas. Unlike the era rail (which only jumps the
 * view), these genuinely filter: a chip stays lit and the field shows only
 * matching events — a Roman Empire chip means Roman events, not merely
 * "everything dated 27 BCE – 476 CE".
 */
export default function FilterRails({
  civs,
  regions,
  activeCivMask,
  activeRegionMask,
  activeCats,
  onToggleCiv,
  onToggleRegion,
  onToggleCat,
  onClearAll,
}: Props) {
  if (civs.length === 0) return null
  const anyActive = activeCivMask !== 0 || activeRegionMask !== 0 || activeCats.size > 0

  return (
    <>
      <nav className="filter-rail civ-rail" aria-label="Filter by civilization or empire">
        {anyActive && (
          <button className="era-chip clear-chip" onClick={onClearAll}>
            ✕ Clear filters
          </button>
        )}
        <span className="era-group-label">Civilisations</span>
        {civs.map((civ, i) => {
          const active = (activeCivMask & (1 << i)) !== 0
          return (
            <button
              key={civ.id}
              className={`era-chip ${active ? 'active' : ''}`}
              onClick={() => onToggleCiv(i, civ)}
              aria-pressed={active}
              title={`Only events of ${civ.label} — and zoom to its era`}
            >
              {civ.label}
            </button>
          )
        })}
      </nav>

      <nav className="filter-rail more-rail" aria-label="Filter by region and topic">
        <span className="era-group-label">Regions</span>
        {regions.map((region, i) => {
          const active = (activeRegionMask & (1 << i)) !== 0
          return (
            <button
              key={region.id}
              className={`era-chip ${active ? 'active' : ''}`}
              onClick={() => onToggleRegion(i)}
              aria-pressed={active}
            >
              {region.label}
            </button>
          )
        })}
        <span className="era-group-label">Topics</span>
        {CATEGORIES.map((cat) => {
          const active = activeCats.has(cat.id)
          return (
            <button
              key={cat.id}
              className={`era-chip ${active ? 'active' : ''}`}
              style={{ ['--era-color' as string]: cat.color }}
              onClick={() => onToggleCat(cat.id)}
              aria-pressed={active}
              title={cat.blurb}
            >
              <span className="e-swatch" aria-hidden />
              {cat.label}
            </button>
          )
        })}
      </nav>
    </>
  )
}

import type { CategoryId } from '../lib/types'
import { CATEGORIES } from '../data/categories'

interface Props {
  counts: Map<CategoryId, number>
  active: Set<CategoryId>
  onToggle: (id: CategoryId) => void
  onOnly: (id: CategoryId) => void
  onClear: () => void
  open: boolean
  onClose: () => void
}

export default function Sidebar({ counts, active, onToggle, onOnly, onClear, open, onClose }: Props) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Category filters">
      <div className="sidebar-head">
        <h2>Filter by subject</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="sidebar-clear" onClick={onClear} disabled={active.size === 0}>
            Clear all
          </button>
          <button
            className="icon-btn only-sm"
            aria-label="Close filters"
            onClick={onClose}
            style={{ height: 28, minWidth: 28, padding: 0 }}
          >
            ×
          </button>
        </div>
      </div>

      <div className="filter-list" role="group" aria-label="Subjects">
        {CATEGORIES.map((cat) => {
          const isActive = active.has(cat.id)
          const count = counts.get(cat.id) ?? 0
          return (
            <div
              className="filter-row"
              key={cat.id}
              style={{ position: 'relative' }}
            >
              <button
                className={`filter ${isActive ? 'active' : ''}`}
                style={{ ['--chip-color' as string]: cat.color, opacity: count === 0 && !isActive ? 0.5 : 1 }}
                aria-pressed={isActive}
                onClick={() => onToggle(cat.id)}
                title={cat.blurb}
              >
                <span className="f-swatch" aria-hidden />
                <span className="f-icon" aria-hidden>
                  {cat.icon}
                </span>
                <span className="f-label">{cat.label}</span>
                <span className="f-count" aria-label={`${count} events in range`}>
                  {count}
                </span>
              </button>
              <button
                className="f-only"
                onClick={() => onOnly(cat.id)}
                aria-label={`Show only ${cat.label}`}
              >
                Only
              </button>
            </div>
          )
        })}
      </div>

      <div className="sidebar-foot">
        Counts reflect the visible time range. Select several subjects to compare — for example{' '}
        <em>Wars</em> and <em>Technology</em>.
      </div>
    </aside>
  )
}

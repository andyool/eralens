import type { HistEvent } from '../lib/types'
import { CATEGORY_MAP, categoryColor } from '../data/categories'
import { formatEventDate } from '../lib/dateFormat'

interface Props {
  events: HistEvent[]
  onSelect: (id: string) => void
}

export default function ListView({ events, onSelect }: Props) {
  return (
    <div className="list-view">
      <div className="lv-inner">
        <p className="lv-count">
          {events.length.toLocaleString()} event{events.length === 1 ? '' : 's'} in this period,
          oldest first.
        </p>
        {events.map((ev) => (
          <button key={ev.id} className="lv-item" onClick={() => onSelect(ev.id)}>
            <span className="lv-date">{formatEventDate(ev)}</span>
            <span>
              <span className="lv-title">{ev.title}</span>
              <span className="lv-desc">{ev.description}</span>
              <span className="lv-tags">
                {ev.categories.map((c) => (
                  <span
                    key={c}
                    className="tag"
                    style={{ ['--tag-color' as string]: categoryColor(c) }}
                  >
                    <span className="t-dot" aria-hidden />
                    {CATEGORY_MAP[c]?.label ?? c}
                  </span>
                ))}
              </span>
            </span>
          </button>
        ))}
        {events.length === 0 && (
          <p className="lv-count">No events match the current filters in this period.</p>
        )}
      </div>
    </div>
  )
}

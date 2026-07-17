import { useEffect, useRef, useState } from 'react'
import type { HistEvent } from '../lib/types'
import { useSavedIds, removeSaved, clearSaved } from '../lib/bookmarks'
import { compactDate } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'

interface Props {
  byId: Map<string, HistEvent>
  onPick: (id: string) => void
}

/** Header dropdown listing the saved events; click one to jump back to it. */
export default function SavedPanel({ byId, onPick }: Props) {
  const savedIds = useSavedIds()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Ids saved under a dataset that isn't loaded right now (e.g. the Wikidata
  // set while offline) stay in storage but aren't listed.
  const saved = savedIds.map((id) => byId.get(id)).filter((e): e is HistEvent => !!e)

  return (
    <div className="saved" ref={ref} style={{ position: 'relative' }}>
      <button
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Saved events"
      >
        <span className="glyph" aria-hidden>
          ★
        </span>
        <span className="hide-sm">Saved{saved.length > 0 ? ` (${saved.length})` : ''}</span>
      </button>
      {open && (
        <div className="saved-menu" role="menu" aria-label="Saved events">
          {saved.length === 0 ? (
            <div className="saved-empty">
              Nothing saved yet — open an event and press <strong>☆ Save</strong>.
            </div>
          ) : (
            <>
              {saved.map((ev) => (
                <div key={ev.id} className="saved-row">
                  <button
                    role="menuitem"
                    className="saved-item"
                    onClick={() => {
                      onPick(ev.id)
                      setOpen(false)
                    }}
                  >
                    <span className="r-dot" style={{ background: categoryColor(ev.categories[0]) }} />
                    <span className="r-title">{ev.title}</span>
                    <span className="r-date">{compactDate(ev)}</span>
                  </button>
                  <button
                    className="saved-remove"
                    aria-label={`Remove ${ev.title} from saved events`}
                    onClick={() => removeSaved(ev.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="saved-clear" onClick={() => clearSaved()}>
                Clear all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

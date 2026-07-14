import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent } from '../lib/types'
import { SearchIndex } from '../lib/search'
import { compactDate } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'

interface Props {
  events: HistEvent[]
  onPick: (event: HistEvent) => void
}

export default function SearchBox({ events, onPick }: Props) {
  const index = useMemo(() => new SearchIndex(events), [events])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const results = useMemo(() => (query.trim() ? index.search(query, 8) : []), [index, query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const choose = (ev: HistEvent) => {
    onPick(ev)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) choose(hit.event)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="search" ref={rootRef}>
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        value={query}
        placeholder="Search events, people, places…"
        aria-label="Search the timeline"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query && (
        <button className="clear" aria-label="Clear search" onClick={() => setQuery('')}>
          ×
        </button>
      )}
      {open && query.trim() && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 ? (
            <div className="search-empty">No matches for “{query.trim()}”.</div>
          ) : (
            results.map((hit, i) => (
              <button
                key={hit.event.id}
                className={`search-result ${i === active ? 'active' : ''}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit.event)}
              >
                <span
                  className="r-dot"
                  style={{ background: categoryColor(hit.event.categories[0]) }}
                />
                <span className="r-title">{hit.event.title}</span>
                <span className="r-date">{compactDate(hit.event)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

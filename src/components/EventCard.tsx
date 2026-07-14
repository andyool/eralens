import { useEffect, useMemo, useState } from 'react'
import type { HistEvent } from '../lib/types'
import type { Forest } from '../lib/hierarchy'
import { CATEGORY_MAP, categoryColor } from '../data/categories'
import { formatEventDate, compactDate } from '../lib/dateFormat'
import { relatedEvents } from '../lib/related'
import { fetchWikiSummary, wikipediaUrl, wikidataUrl, type WikiSummary } from '../lib/wiki'

interface Props {
  event: HistEvent
  events: HistEvent[]
  forest: Forest
  onSelectEvent: (id: string) => void
  onDrill: (id: string) => void
  onClose: () => void
}

export default function EventCard({ event, events, forest, onSelectEvent, onDrill, onClose }: Props) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null)
  const [imgOk, setImgOk] = useState(true)
  const [copied, setCopied] = useState(false)

  const accent = categoryColor(event.categories[0])
  const realById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const groups = useMemo(
    () => relatedEvents(event, events, realById, 4),
    [event, events, realById],
  )

  const node = forest.map.get(event.id)
  const parent = node?.parent ?? null
  const children = node?.children ?? []

  useEffect(() => {
    setWiki(null)
    setImgOk(true)
    setCopied(false)
    let cancelled = false
    fetchWikiSummary(event).then((s) => {
      if (!cancelled) setWiki(s)
    })
    return () => {
      cancelled = true
    }
  }, [event])

  const wpUrl = wikipediaUrl(event)
  const wdUrl = wikidataUrl(event)
  const summary = wiki?.extract || event.description

  const share = async () => {
    const url = `${location.origin}${location.pathname}?event=${encodeURIComponent(event.id)}`
    try {
      if (navigator.share) await navigator.share({ title: event.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }
    } catch {
      /* dismissed */
    }
  }

  return (
    <div
      className="event-card"
      style={{ ['--card-accent' as string]: accent }}
      role="dialog"
      aria-label={event.title}
      aria-modal="false"
    >
      <div className="card-media">
        {wiki?.thumbnail && imgOk ? (
          <img src={wiki.thumbnail} alt={event.title} onError={() => setImgOk(false)} loading="lazy" />
        ) : (
          <div className="media-fallback" aria-hidden>
            {CATEGORY_MAP[event.categories[0]]?.icon ?? '✦'}
          </div>
        )}
        <div className="media-grad" />
        <button className="card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <span className="card-datebadge">{formatEventDate(event)}</span>
      </div>

      <div className="card-body">
        {parent && (
          <button
            className="card-parent"
            onClick={() => {
              onDrill(parent.ev.id)
              onClose()
            }}
          >
            ↑ Part of <strong>{parent.ev.title}</strong>
          </button>
        )}

        <h2>{event.title}</h2>
        <div className="card-sub">
          {event.location && <span>📍 {event.location}</span>}
          {event.people && event.people.length > 0 && <span>· {event.people.join(', ')}</span>}
        </div>

        <div className="card-tags">
          {event.categories.map((c) => (
            <span key={c} className="tag" style={{ ['--tag-color' as string]: categoryColor(c) }}>
              <span className="t-dot" aria-hidden />
              {CATEGORY_MAP[c]?.label ?? c}
            </span>
          ))}
        </div>

        <p className="card-summary">
          {summary} {wiki?.extract && <span className="src">— via Wikipedia</span>}
        </p>

        {children.length === 0 && event.wikiTitle && event.tier !== 'moment' && (
          <div className="card-section">
            <h3>The story</h3>
            <button
              className="zoom-in-btn"
              onClick={() => {
                onDrill(event.id)
                onClose()
              }}
            >
              ⤵ Open the story timeline — the blow-by-blow from Wikipedia
            </button>
          </div>
        )}

        {children.length > 0 && (
          <div className="card-section">
            <h3>Contains {node!.descendantCount} events</h3>
            <button className="zoom-in-btn" onClick={() => { onDrill(event.id); onClose() }}>
              ⤵ Open its timeline — only these {node!.descendantCount} events on the map
            </button>
            {children.slice(0, 8).map((c) => (
              <button key={c.ev.id} className="rel-item" onClick={() => onSelectEvent(c.ev.id)}>
                <span className="ri-dot" style={{ background: categoryColor(c.ev.categories[0]) }} />
                <span className="ri-title">
                  {c.ev.title}
                  {c.children.length > 0 && (
                    <span style={{ color: 'var(--text-faint)' }}> · {c.descendantCount}</span>
                  )}
                </span>
                <span className="ri-date">{compactDate(c.ev)}</span>
              </button>
            ))}
            {children.length > 8 && (
              <div className="rel-more">+{children.length - 8} more — zoom in to see them all</div>
            )}
          </div>
        )}

        {groups.length > 0 && (
          <div className="card-section">
            <h3>Connections</h3>
            {groups.map((g) => (
              <div className="rel-group" key={g.kind}>
                <div className="rel-kind">{g.label}</div>
                {g.events.map((re) => (
                  <button key={re.id} className="rel-item" onClick={() => onSelectEvent(re.id)}>
                    <span className="ri-dot" style={{ background: categoryColor(re.categories[0]) }} />
                    <span className="ri-title">{re.title}</span>
                    <span className="ri-date">{compactDate(re)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="card-actions">
          {wpUrl && (
            <a className="primary" href={wpUrl} target="_blank" rel="noopener noreferrer">
              Read on Wikipedia ↗
            </a>
          )}
          {wdUrl && (
            <a href={wdUrl} target="_blank" rel="noopener noreferrer">
              Wikidata ↗
            </a>
          )}
          <button onClick={share}>{copied ? 'Link copied ✓' : 'Share'}</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { HistEvent } from '../lib/types'
import { formatEventDate } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'
import { fetchWikiSummary, wikipediaUrl, type WikiSummary } from '../lib/wiki'
import { fetchStory, type StoryPart } from '../lib/wikiStory'
import { useResizeObserver } from '../hooks'

interface Props {
  event: HistEvent
  onClose: () => void
}

const CARD_W = 330
const PAD = 40

/**
 * The deepest layer: one event told as its own story, from the complete text
 * of its Wikipedia article. Every date mentioned in the article opens a new
 * part; each part's dot sits at that date's true spot on the axis, with a
 * connector out to a card holding the part's full, un-truncated prose (long
 * parts scroll inside their card rather than cutting off).
 */
export default function StoryView({ event, onClose }: Props) {
  const [summary, setSummary] = useState<WikiSummary | null>(null)
  const [parts, setParts] = useState<StoryPart[] | null>(null)
  const [stripRef, stripSize] = useResizeObserver<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setParts(null)
    fetchWikiSummary(event).then((s) => {
      if (!cancelled) setSummary(s)
    })
    fetchStory(event).then((s) => {
      if (!cancelled) setParts(s)
    })
    return () => {
      cancelled = true
    }
  }, [event])

  const accent = categoryColor(event.categories[0])
  const wpUrl = wikipediaUrl(event)
  const dateLabel = event.endYear
    ? `${formatEventDate(event)} — ${event.endYear}`
    : formatEventDate(event)

  // Layout: dots at true date positions; cards nudged apart along their side
  // (above/below alternating) so they never collide, tied to their dot by a
  // slanted connector.
  const layout = useMemo(() => {
    if (!parts || parts.length === 0) return null
    const n = parts.length
    const viewW = Math.max(stripSize.width || 900, 320)
    const stripW = Math.max(viewW - 4, Math.ceil(n / 2) * (CARD_W + 18) + PAD * 2)
    const min = parts[0].date
    const max = parts[n - 1].date
    const span = Math.max(1e-6, max - min)
    const dotX = parts.map((p) => PAD + ((p.date - min) / span) * (stripW - PAD * 2))
    // Parts anchored on the same date would stack their dots — fan them out.
    for (let i = 1; i < n; i++) dotX[i] = Math.max(dotX[i], dotX[i - 1] + 9)

    // Date labels alternate sides with the cards; drop any that would
    // collide with the previous label on its side.
    const showLabel = new Array<boolean>(n).fill(false)
    const lastLabelX = [-Infinity, -Infinity]
    for (let i = 0; i < n; i++) {
      const side = i % 2
      if (dotX[i] - lastLabelX[side] >= 84) {
        showLabel[i] = true
        lastLabelX[side] = dotX[i]
      }
    }

    // Nudge same-side neighbours apart, then pull back inside the strip.
    const cardX = [...dotX]
    const gap = CARD_W + 16
    for (const side of [0, 1]) {
      const idx = []
      for (let i = side; i < n; i += 2) idx.push(i)
      for (let k = 1; k < idx.length; k++) {
        cardX[idx[k]] = Math.max(cardX[idx[k]], cardX[idx[k - 1]] + gap)
      }
      for (let k = idx.length - 1; k >= 0; k--) {
        const limit = stripW - PAD - CARD_W / 2 - (idx.length - 1 - k) * gap
        cardX[idx[k]] = Math.min(cardX[idx[k]], limit)
        if (k > 0) cardX[idx[k - 1]] = Math.min(cardX[idx[k - 1]], cardX[idx[k]] - gap)
      }
      for (const i of idx) cardX[i] = Math.max(cardX[i], PAD + CARD_W / 2)
    }
    return { stripW, dotX, cardX, showLabel }
  }, [parts, stripSize.width])

  const stripH = stripSize.height || 500
  const centerY = stripH / 2

  return (
    <div
      className="story-view"
      style={{ ['--story-accent' as string]: accent }}
      role="dialog"
      aria-label={`Story of ${event.title}`}
    >
      <header className="story-head">
        {summary?.thumbnail && <img className="story-hero" src={summary.thumbnail} alt="" />}
        <div className="story-head-text">
          <button className="story-back" onClick={onClose}>
            ← Back to the map
          </button>
          <h1>{event.title}</h1>
          <div className="story-date">{dateLabel}</div>
          {summary?.extract && <p className="story-extract">{summary.extract}</p>}
          {wpUrl && (
            <a className="story-wplink" href={wpUrl} target="_blank" rel="noopener noreferrer">
              Read the full article on Wikipedia ↗
            </a>
          )}
        </div>
      </header>

      {parts === null && <div className="story-loading">Reading the article…</div>}
      {parts !== null && parts.length === 0 && (
        <div className="story-loading">
          Couldn't load this article's text — try the Wikipedia link above.
        </div>
      )}

      {parts !== null && parts.length > 0 && (
        <div className="story-strip-wrap" ref={stripRef}>
          {layout && (
            <div className="story-strip" style={{ width: layout.stripW, minWidth: layout.stripW }}>
              <div className="story-axis" aria-hidden />
              <svg
                className="story-links"
                width={layout.stripW}
                height={stripH}
                viewBox={`0 0 ${layout.stripW} ${stripH}`}
                aria-hidden
              >
                {parts.map((_, i) => {
                  const above = i % 2 === 0
                  const cardEdgeY = above ? centerY - 30 : centerY + 30
                  return (
                    <line
                      key={i}
                      x1={layout.dotX[i]}
                      y1={centerY}
                      x2={layout.cardX[i]}
                      y2={cardEdgeY}
                      stroke="currentColor"
                      strokeWidth="1.4"
                      opacity="0.55"
                    />
                  )
                })}
              </svg>
              {parts.map((p, i) => {
                const above = i % 2 === 0
                return (
                  <div key={i} className="story-node">
                    <span
                      className="story-dot"
                      style={{ left: layout.dotX[i] }}
                      title={p.dateLabel ?? p.title}
                      aria-hidden
                    />
                    {layout.showLabel[i] && p.dateLabel && (
                      <span
                        className={`story-dot-date ${above ? 'below-axis' : 'above-axis'}`}
                        style={{ left: layout.dotX[i] }}
                      >
                        {p.dateLabel}
                      </span>
                    )}
                    <article
                      className={`story-card ${above ? 'above' : 'below'}`}
                      style={{ left: layout.cardX[i] - CARD_W / 2, width: CARD_W }}
                    >
                      {p.image && <img src={p.image} alt="" loading="lazy" />}
                      <div className="sc-head">
                        <h3>{p.title}</h3>
                        {p.dateLabel && <span className="sc-date">{p.dateLabel}</span>}
                      </div>
                      <div className="sc-body">
                        {p.paragraphs.map((text, j) => (
                          <p key={j}>{text}</p>
                        ))}
                      </div>
                    </article>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

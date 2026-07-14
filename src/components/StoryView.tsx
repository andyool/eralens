import { useEffect, useState } from 'react'
import type { HistEvent } from '../lib/types'
import { formatEventDate } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'
import { fetchWikiSummary, wikipediaUrl, type WikiSummary } from '../lib/wiki'
import { fetchStory, type StorySection } from '../lib/wikiStory'

interface Props {
  event: HistEvent
  onClose: () => void
}

/**
 * The deepest layer: one event told as its own story. A horizontal timeline
 * runs through the middle; each beat — a top-level section of the event's
 * Wikipedia article, in chronological order — hangs off it on a connector
 * line, as a card of prose and the section's image.
 */
export default function StoryView({ event, onClose }: Props) {
  const [summary, setSummary] = useState<WikiSummary | null>(null)
  const [story, setStory] = useState<StorySection[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setStory(null)
    fetchWikiSummary(event).then((s) => {
      if (!cancelled) setSummary(s)
    })
    fetchStory(event).then((s) => {
      if (!cancelled) setStory(s)
    })
    return () => {
      cancelled = true
    }
  }, [event])

  const accent = categoryColor(event.categories[0])
  const wpUrl = wikipediaUrl(event)
  const title = event.wikiTitle?.split('#')[0] ?? ''
  const dateLabel = event.endYear
    ? `${formatEventDate(event)} — ${event.endYear}`
    : formatEventDate(event)

  return (
    <div className="story-view" style={{ ['--story-accent' as string]: accent }} role="dialog" aria-label={`Story of ${event.title}`}>
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

      {story === null && <div className="story-loading">Reading the article…</div>}
      {story !== null && story.length === 0 && (
        <div className="story-loading">Couldn't load this article's sections — try the Wikipedia link above.</div>
      )}

      {story !== null && story.length > 0 && (
        <div className="story-strip-wrap">
          <div className="story-strip" style={{ minWidth: `${story.length * 300}px` }}>
            <div className="story-axis" aria-hidden />
            <span className="story-axis-label start">{dateLabel.split(' — ')[0]}</span>
            {event.endYear && <span className="story-axis-label end">{event.endYear}</span>}
            {story.map((beat, i) => {
              const x = ((i + 0.5) / story.length) * 100
              const above = i % 2 === 0
              return (
                <div
                  key={beat.index}
                  className={`story-node ${above ? 'above' : 'below'}`}
                  style={{ left: `${x}%` }}
                >
                  <span className="story-dot" aria-hidden />
                  <span className="story-connector" aria-hidden />
                  <article className="story-card">
                    {beat.image && <img src={beat.image} alt="" loading="lazy" />}
                    <h3>{beat.title}</h3>
                    <p>{beat.text}</p>
                    <a
                      href={`https://en.wikipedia.org/wiki/${title}#${beat.anchor}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      read this part ↗
                    </a>
                  </article>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

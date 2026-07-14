import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryId, Era, HistEvent, TimeView } from './lib/types'
import { loadEvents, EVENTS } from './data/events'
import { CATEGORIES } from './data/categories'
import { MIN_YEAR, MAX_YEAR, viewAround, viewFromSpan, viewMidYear } from './lib/timeMapping'
import { buildForest, type HNode } from './lib/hierarchy'
import { discover, type LuckyMode } from './lib/discover'
import { sound } from './lib/sound'
import { usePrefersReducedMotion, useMediaQuery } from './hooks'

import SearchBox from './components/SearchBox'
import Discover from './components/Discover'
import Sidebar from './components/Sidebar'
import EraRail from './components/EraRail'
import Breadcrumb from './components/Breadcrumb'
import TimeCanvas from './components/TimeCanvas'
import Navigator from './components/Navigator'
import EventCard from './components/EventCard'
import ListView from './components/ListView'
import MapView from './components/MapView'
import ComparisonView from './components/ComparisonView'

type ViewMode = 'timeline' | 'list' | 'map' | 'compare'
const MODES: { id: ViewMode; icon: string; label: string }[] = [
  { id: 'timeline', icon: '✦', label: 'Timeline' },
  { id: 'list', icon: '☰', label: 'List' },
  { id: 'map', icon: '🌍', label: 'Map' },
  { id: 'compare', icon: '⚖', label: 'Compare' },
]

const FULL_VIEW: TimeView = { startYear: MIN_YEAR, endYear: MAX_YEAR }

export default function App() {
  const [events, setEvents] = useState<HistEvent[]>(EVENTS)
  const [view, setViewState] = useState<TimeView>(FULL_VIEW)
  const [activeCats, setActiveCats] = useState<Set<CategoryId>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeEraId, setActiveEraId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mode, setMode] = useState<ViewMode>('timeline')
  const [soundOn, setSoundOn] = useState(false)
  const [toast, setToast] = useState<{ title: string; desc: string; color: string } | null>(null)
  const [hintDone, setHintDone] = useState(false)

  const reducedMotion = usePrefersReducedMotion()
  const isMobile = useMediaQuery('(max-width: 860px)')

  // Real events, auto-clustered into millennium → century → decade → event →
  // moment containers so everything steps down cleanly.
  const forest = useMemo(() => buildForest(events, { cluster: true }), [events])
  const containers = useMemo(
    () => [...forest.map.values()].filter((n) => n.children.length > 0),
    [forest],
  )
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  useEffect(() => {
    let cancelled = false
    loadEvents().then((data) => {
      if (cancelled) return
      setEvents(data)
      const param = new URLSearchParams(location.search).get('event')
      if (param) {
        const ev = data.find((e) => e.id === param)
        if (ev) {
          setViewState(viewAround(ev.year))
          setSelectedId(ev.id)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (hintDone) return
    const t = setTimeout(() => setHintDone(true), 8000)
    return () => clearTimeout(t)
  }, [hintDone])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4600)
    return () => clearTimeout(t)
  }, [toast])

  // Node predicate lets filters see through containers (a war shows if any of
  // its battles match); the event predicate drives list/keyboard nav.
  const nodePredicate = useMemo(() => {
    if (activeCats.size === 0) return () => true
    return (node: HNode) => {
      for (const c of node.subtreeCats) if (activeCats.has(c)) return true
      return false
    }
  }, [activeCats])
  const eventMatches = useMemo(() => {
    if (activeCats.size === 0) return () => true
    return (ev: HistEvent) => ev.categories.some((c) => activeCats.has(c))
  }, [activeCats])

  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>()
    for (const cat of CATEGORIES) m.set(cat.id, 0)
    for (const ev of events) {
      if (ev.year < view.startYear || ev.year > view.endYear) continue
      for (const c of ev.categories) m.set(c, (m.get(c) ?? 0) + 1)
    }
    return m
  }, [events, view])

  const visibleSorted = useMemo(
    () =>
      events
        .filter((e) => e.tier !== 'moment' && e.year >= view.startYear && e.year <= view.endYear && eventMatches(e))
        .sort((a, b) => a.year - b.year),
    [events, view, eventMatches],
  )

  const focusNode: HNode | null = useMemo(() => {
    const mid = viewMidYear(view)
    let best: HNode | null = null
    for (const n of containers) {
      if (n.spanStart <= mid && n.spanEnd >= mid) {
        if (!best || n.depth > best.depth) best = n
      }
    }
    return best
  }, [containers, view])

  const selectedEvent = selectedId ? byId.get(selectedId) ?? null : null

  const setView = useCallback((v: TimeView) => {
    setViewState(v)
    setActiveEraId(null)
    setHintDone(true)
  }, [])

  const updateUrl = useCallback((id: string | null) => {
    const url = new URL(location.href)
    if (id) url.searchParams.set('event', id)
    else url.searchParams.delete('event')
    history.replaceState(null, '', url)
  }, [])

  const select = useCallback(
    (id: string | null, focus = false) => {
      setSelectedId(id)
      updateUrl(id)
      setHintDone(true)
      if (id) {
        if (soundOn) sound.select()
        if (focus) {
          const ev = byId.get(id)
          if (ev) {
            setViewState(viewAround(ev.year))
            setActiveEraId(null)
          }
        }
        if (isMobile) setSidebarOpen(false)
      }
    },
    [byId, soundOn, isMobile, updateUrl],
  )

  const drill = useCallback(
    (id: string) => {
      const node = forest.map.get(id)
      if (!node) return
      if (node.children.length > 0) {
        setViewState(viewFromSpan(node.spanStart, node.spanEnd))
        setActiveEraId(null)
        setHintDone(true)
        if (soundOn) sound.select()
      } else {
        select(id)
      }
    },
    [forest, soundOn, select],
  )

  const selectEra = useCallback(
    (era: Era) => {
      setViewState({ startYear: era.startYear, endYear: era.endYear })
      setActiveEraId(era.id)
      setToast({ title: era.name, desc: era.description, color: era.color })
      setHintDone(true)
      if (soundOn) sound.era()
    },
    [soundOn],
  )

  const toggleCat = useCallback((id: CategoryId) => {
    setActiveCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const onlyCat = useCallback((id: CategoryId) => setActiveCats(new Set([id])), [])
  const clearCats = useCallback(() => setActiveCats(new Set()), [])

  const lucky = useCallback(
    (mode: LuckyMode) => {
      const ev = discover(events.filter((e) => e.tier !== 'moment'), mode, new Date())
      if (!ev) return
      setViewState(viewAround(ev.year))
      setActiveEraId(null)
      setSelectedId(ev.id)
      updateUrl(ev.id)
      setHintDone(true)
      setToast({ title: 'Discover', desc: ev.title, color: '#8b9dff' })
      if (soundOn) sound.select()
    },
    [events, soundOn, updateUrl],
  )

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo" aria-hidden />
          <span className="name">EraLens</span>
          <span className="tag hide-sm">a map of time</span>
        </div>

        <button
          className="icon-btn only-sm"
          aria-label="Toggle filters"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          <span className="glyph" aria-hidden>
            ☰
          </span>
        </button>

        <SearchBox events={events} onPick={(ev) => select(ev.id, true)} />

        <div className="header-spacer" />

        <div className="header-actions">
          <Discover onPick={lucky} />
          <div className="mode-switch" role="group" aria-label="View mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${mode === m.id ? 'active' : ''}`}
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
                title={m.label}
              >
                <span className="glyph" aria-hidden>
                  {m.icon}
                </span>
                <span className="hide-sm">{m.label}</span>
              </button>
            ))}
          </div>
          <button
            className={`icon-btn ${soundOn ? 'active' : ''}`}
            aria-pressed={soundOn}
            onClick={() => setSoundOn((s) => !s)}
            title={soundOn ? 'Sound on' : 'Sound off'}
          >
            <span className="glyph" aria-hidden>
              {soundOn ? '🔊' : '🔈'}
            </span>
          </button>
        </div>
      </header>

      <div className="stage">
        <Sidebar
          counts={counts}
          active={activeCats}
          onToggle={toggleCat}
          onOnly={onlyCat}
          onClear={clearCats}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        {isMobile && sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

        <div className="canvas-col">
          {mode === 'list' && (
            <div className="canvas-wrap">
              <ListView events={visibleSorted} onSelect={(id) => select(id, false)} />
            </div>
          )}
          {mode === 'map' && (
            <MapView
              events={events}
              view={view}
              eventMatches={eventMatches}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
            />
          )}
          {mode === 'compare' && (
            <ComparisonView
              events={events}
              view={view}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
            />
          )}
          {mode === 'timeline' && (
            <TimeCanvas
              events={events}
              forest={forest}
              view={view}
              onViewChange={setView}
              nodePredicate={nodePredicate}
              eventMatches={eventMatches}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
              onDrill={drill}
              reducedMotion={reducedMotion}
              showHint={!hintDone}
            />
          )}

          {mode === 'timeline' && <EraRail activeEraId={activeEraId} onSelect={selectEra} />}

          {mode === 'timeline' && (
            <Breadcrumb
              focus={focusNode}
              onHome={() => setView(FULL_VIEW)}
              onCrumb={(node) => setView(viewFromSpan(node.spanStart, node.spanEnd))}
            />
          )}

          {toast && (
            <div className="toast" style={{ ['--toast-color' as string]: toast.color }} role="status">
              <div className="t-name">{toast.title}</div>
              <div className="t-desc">{toast.desc}</div>
            </div>
          )}

          {selectedEvent && (
            <div className="card-backdrop">
              <EventCard
                event={selectedEvent}
                events={events}
                forest={forest}
                onSelectEvent={(id) => select(id, true)}
                onDrill={drill}
                onClose={() => select(null)}
              />
            </div>
          )}
        </div>
      </div>

      <Navigator view={view} events={events} onChange={setView} />
    </div>
  )
}

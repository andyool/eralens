import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CategoryId, Era, HistEvent, TimeView } from './lib/types'
import { loadEvents, EVENTS, type CivDef, type RegionDef } from './data/events'
import { CATEGORIES, categoryColor } from './data/categories'
import { MIN_YEAR, MAX_YEAR, clampView, viewAround, viewFromSpan, viewMidYear } from './lib/timeMapping'
import { buildForest, type HNode } from './lib/hierarchy'
import { buildCausalIndex } from './lib/related'
import { discover, type LuckyMode } from './lib/discover'
import { sound } from './lib/sound'
import { usePrefersReducedMotion, useMediaQuery } from './hooks'

import SearchBox from './components/SearchBox'
import Discover from './components/Discover'
import Sidebar from './components/Sidebar'
import EraRail from './components/EraRail'
import FilterRails from './components/FilterRails'
import Breadcrumb from './components/Breadcrumb'
import TimeCanvas from './components/TimeCanvas'
import Navigator from './components/Navigator'
import EventCard from './components/EventCard'
import StoryView from './components/StoryView'
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
  const [civDefs, setCivDefs] = useState<CivDef[]>([])
  const [regionDefs, setRegionDefs] = useState<RegionDef[]>([])
  const [view, setViewState] = useState<TimeView>(FULL_VIEW)
  const [activeCats, setActiveCats] = useState<Set<CategoryId>>(new Set())
  const [activeCivMask, setActiveCivMask] = useState(0)
  const [activeRegionMask, setActiveRegionMask] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeEraId, setActiveEraId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mode, setMode] = useState<ViewMode>('timeline')
  const [soundOn, setSoundOn] = useState(false)
  const [toast, setToast] = useState<{ title: string; desc: string; color: string } | null>(null)
  const [hintDone, setHintDone] = useState(false)

  // Focus mode: exploring one event's own timeline (its battles, phases, …).
  // A stack so you can step into a war, then a campaign, and back out again.
  const [focusStack, setFocusStack] = useState<{ id: string; returnView: TimeView }[]>([])
  const focusId = focusStack.length > 0 ? focusStack[focusStack.length - 1].id : null

  // The deepest layer: a leaf event opened as a full-screen illustrated story
  // built from its Wikipedia article sections.
  const [storyEvent, setStoryEvent] = useState<HistEvent | null>(null)

  // View history for the ↩ Back button — recorded on jumps (eras, searches,
  // range selections), not on every wheel tick.
  const viewHistory = useRef<TimeView[]>([])
  const [canBack, setCanBack] = useState(false)

  const reducedMotion = usePrefersReducedMotion()
  const isMobile = useMediaQuery('(max-width: 860px)')

  // Real events, auto-clustered into millennium → century → decade → event →
  // moment containers so everything steps down cleanly.
  const fullForest = useMemo(() => buildForest(events, { cluster: true }), [events])
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const causalIndex = useMemo(() => buildCausalIndex(events, byId), [events, byId])
  const causalOf = useCallback((id: string) => causalIndex.get(id), [causalIndex])

  // In focus mode only the focused event's subtree (plus its direct causes and
  // effects — the "relevant events") is on the canvas.
  const visibleEvents = useMemo(() => {
    if (!focusId) return events
    const root = fullForest.map.get(focusId)
    if (!root || root.children.length === 0) return events
    const out: HistEvent[] = []
    const stack = [...root.children]
    while (stack.length > 0) {
      const n = stack.pop()!
      out.push(n.ev)
      for (const c of n.children) stack.push(c)
    }
    const links = causalIndex.get(focusId)
    if (links) {
      const inSet = new Set(out.map((e) => e.id))
      for (const id of [...links.causes, ...links.effects]) {
        if (!inSet.has(id) && id !== focusId) {
          const ev = byId.get(id)
          if (ev) out.push(ev)
        }
      }
    }
    return out
  }, [events, focusId, fullForest, causalIndex, byId])
  const visibleIds = useMemo(() => new Set(visibleEvents.map((e) => e.id)), [visibleEvents])

  // The forest the canvas renders: full clustered forest normally; in focus
  // mode a flat forest of the subtree (no time buckets — the event itself is
  // the timeline).
  const forest = useMemo(
    () => (focusId ? buildForest(visibleEvents, { cluster: false }) : fullForest),
    [focusId, visibleEvents, fullForest],
  )
  const containers = useMemo(
    () => [...forest.map.values()].filter((n) => n.children.length > 0),
    [forest],
  )

  useEffect(() => {
    let cancelled = false
    loadEvents().then(({ events: data, civs, regions }) => {
      if (cancelled) return
      setEvents(data)
      setCivDefs(civs)
      setRegionDefs(regions)
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
    if (activeCats.size === 0 && activeCivMask === 0 && activeRegionMask === 0) return () => true
    return (node: HNode) => {
      if (activeCivMask !== 0 && (node.subtreeCivMask & activeCivMask) === 0) return false
      if (activeRegionMask !== 0 && (node.subtreeRegionMask & activeRegionMask) === 0) return false
      if (activeCats.size === 0) return true
      for (const c of node.subtreeCats) if (activeCats.has(c)) return true
      return false
    }
  }, [activeCats, activeCivMask, activeRegionMask])
  const eventMatches = useMemo(() => {
    if (activeCats.size === 0 && activeCivMask === 0 && activeRegionMask === 0) return () => true
    return (ev: HistEvent) => {
      if (activeCivMask !== 0 && ((ev.civMask ?? 0) & activeCivMask) === 0) return false
      if (activeRegionMask !== 0 && ((ev.regionMask ?? 0) & activeRegionMask) === 0) return false
      if (activeCats.size === 0) return true
      return ev.categories.some((c) => activeCats.has(c))
    }
  }, [activeCats, activeCivMask, activeRegionMask])

  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>()
    for (const cat of CATEGORIES) m.set(cat.id, 0)
    for (const ev of visibleEvents) {
      if (ev.year < view.startYear || ev.year > view.endYear) continue
      if (activeCivMask !== 0 && ((ev.civMask ?? 0) & activeCivMask) === 0) continue
      if (activeRegionMask !== 0 && ((ev.regionMask ?? 0) & activeRegionMask) === 0) continue
      for (const c of ev.categories) m.set(c, (m.get(c) ?? 0) + 1)
    }
    return m
  }, [visibleEvents, view, activeCivMask, activeRegionMask])

  const visibleSorted = useMemo(
    () =>
      visibleEvents
        .filter((e) => e.tier !== 'moment' && e.year >= view.startYear && e.year <= view.endYear && eventMatches(e))
        .sort((a, b) => a.year - b.year),
    [visibleEvents, view, eventMatches],
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
  const focusEvent = focusId ? byId.get(focusId) ?? null : null

  const setView = useCallback((v: TimeView) => {
    setViewState(v)
    setActiveEraId(null)
    setHintDone(true)
  }, [])

  const pushHistory = useCallback((v: TimeView) => {
    viewHistory.current.push(v)
    if (viewHistory.current.length > 60) viewHistory.current.shift()
    setCanBack(true)
  }, [])

  /** A deliberate jump (era, search, range selection) — recorded for ↩ Back. */
  const jumpView = useCallback(
    (v: TimeView) => {
      pushHistory(view)
      setView(clampView(v))
    },
    [view, pushHistory, setView],
  )

  const goBack = useCallback(() => {
    const prev = viewHistory.current.pop()
    setCanBack(viewHistory.current.length > 0)
    if (prev) setView(prev)
  }, [setView])

  const exitFocus = useCallback(() => {
    setFocusStack((s) => {
      const top = s[s.length - 1]
      if (top) setViewState(top.returnView)
      return s.slice(0, -1)
    })
    setActiveEraId(null)
    setHintDone(true)
  }, [])

  // Escape steps out: the open card first, then the story, then focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selectedId) return // TimeCanvas/card handle closing the selection
      if (storyEvent) {
        setStoryEvent(null)
        return
      }
      if (focusStack.length > 0) exitFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, storyEvent, focusStack.length, exitFocus])

  /** Full reset: leave focus mode entirely and show all of time. */
  const resetAll = useCallback(() => {
    setFocusStack([])
    setSelectedId(null)
    setView(FULL_VIEW)
  }, [setView])

  /**
   * Enter focus mode on a container event: the canvas becomes that event's own
   * timeline. `span` overrides the zoom target when the children were added in
   * this same update (moments) and the forest hasn't rebuilt yet.
   */
  const enterFocus = useCallback(
    (id: string, span?: [number, number]) => {
      const node = fullForest.map.get(id)
      if (!node) return
      const s = span ?? [node.spanStart, node.spanEnd]
      setFocusStack((prev) => [...prev, { id, returnView: view }])
      setViewState(viewFromSpan(s[0], s[1]))
      setActiveEraId(null)
      setSelectedId(null)
      setHintDone(true)
      if (soundOn) sound.select()
    },
    [fullForest, view, soundOn],
  )

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
            // Jumping to something outside the focused subtree (search, lucky)
            // leaves focus mode so the target is actually on the canvas.
            if (focusStack.length > 0 && !visibleIds.has(id)) setFocusStack([])
            pushHistory(view)
            setViewState(viewAround(ev.year))
            setActiveEraId(null)
          }
        }
        if (isMobile) setSidebarOpen(false)
      }
    },
    [byId, soundOn, isMobile, updateUrl, focusStack.length, visibleIds, pushHistory, view],
  )

  const drill = useCallback(
    (id: string) => {
      const node = forest.map.get(id) ?? fullForest.map.get(id)
      if (!node) return
      if (node.children.length > 0) {
        // Synthetic time buckets just zoom; a real event opens as its own
        // timeline — only its battles, phases and related events on canvas.
        if (node.ev.id.startsWith('t:')) {
          jumpView(viewFromSpan(node.spanStart, node.spanEnd))
          if (soundOn) sound.select()
        } else {
          enterFocus(id)
        }
        return
      }
      const ev = node.ev
      if (ev.wikiTitle && ev.tier !== 'moment') {
        // The last layer: no more events inside — open the event as a story
        // timeline built from its Wikipedia article.
        setSelectedId(null)
        setStoryEvent(ev)
        setHintDone(true)
        if (soundOn) sound.select()
        return
      }
      select(id)
    },
    [forest, fullForest, soundOn, select, jumpView, enterFocus],
  )

  const selectEra = useCallback(
    (era: Era) => {
      setFocusStack([])
      pushHistory(view)
      setViewState({ startYear: era.startYear, endYear: era.endYear })
      setActiveEraId(era.id)
      setToast({ title: era.name, desc: era.description, color: era.color })
      setHintDone(true)
      if (soundOn) sound.era()
    },
    [soundOn, pushHistory, view],
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

  const toggleCiv = useCallback(
    (bit: number, def: CivDef) => {
      const turningOn = (activeCivMask & (1 << bit)) === 0
      setActiveCivMask((m) => m ^ (1 << bit))
      if (turningOn) {
        // A chosen year range is sacred: filtering to a civilization keeps it
        // and shows that civilization's events within it. Only from the
        // everything-view does the chip also frame the civilization's era.
        const atFullView = view.startYear <= MIN_YEAR + 1 && view.endYear >= MAX_YEAR - 1
        if (atFullView) {
          jumpView({ startYear: def.start, endYear: def.end })
          setToast({ title: def.label, desc: 'Showing only events of this civilisation.', color: '#8b9dff' })
        } else {
          setToast({ title: def.label, desc: 'Only this civilisation, within your year range.', color: '#8b9dff' })
        }
      }
    },
    [activeCivMask, jumpView, view],
  )
  const toggleRegion = useCallback((bit: number) => setActiveRegionMask((m) => m ^ (1 << bit)), [])
  const clearAllFilters = useCallback(() => {
    setActiveCats(new Set())
    setActiveCivMask(0)
    setActiveRegionMask(0)
  }, [])

  const lucky = useCallback(
    (mode: LuckyMode) => {
      const ev = discover(events.filter((e) => e.tier !== 'moment'), mode, new Date())
      if (!ev) return
      setFocusStack([])
      pushHistory(view)
      setViewState(viewAround(ev.year))
      setActiveEraId(null)
      setSelectedId(ev.id)
      updateUrl(ev.id)
      setHintDone(true)
      setToast({ title: 'Discover', desc: ev.title, color: '#8b9dff' })
      if (soundOn) sound.select()
    },
    [events, soundOn, updateUrl, pushHistory, view],
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
              events={visibleEvents}
              view={view}
              eventMatches={eventMatches}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
            />
          )}
          {mode === 'compare' && (
            <ComparisonView
              events={visibleEvents}
              view={view}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
            />
          )}
          {mode === 'timeline' && (
            <TimeCanvas
              events={visibleEvents}
              forest={forest}
              view={view}
              onViewChange={setView}
              onRangeSelect={jumpView}
              nodePredicate={nodePredicate}
              eventMatches={eventMatches}
              causalOf={causalOf}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
              onDrill={drill}
              reducedMotion={reducedMotion}
              showHint={!hintDone}
            />
          )}

          {mode === 'timeline' && <EraRail activeEraId={activeEraId} onSelect={selectEra} />}

          {mode === 'timeline' && (
            <FilterRails
              civs={civDefs}
              regions={regionDefs}
              activeCivMask={activeCivMask}
              activeRegionMask={activeRegionMask}
              activeCats={activeCats}
              onToggleCiv={toggleCiv}
              onToggleRegion={toggleRegion}
              onToggleCat={toggleCat}
              onClearAll={clearAllFilters}
            />
          )}

          {mode === 'timeline' && focusEvent && (
            <div className="focus-banner" role="status">
              <span
                className="fb-dot"
                style={{ background: categoryColor(focusEvent.categories[0]) }}
                aria-hidden
              />
              <span className="fb-label">
                Inside <strong>{focusEvent.title}</strong>
                <span className="fb-count"> · {visibleEvents.length} events</span>
              </span>
              <button className="fb-exit" onClick={exitFocus}>
                ✕ Back{focusStack.length > 1 ? ' out one level' : ' to the timeline'}
              </button>
            </div>
          )}

          {mode === 'timeline' && (
            <Breadcrumb
              focus={focusNode}
              onHome={resetAll}
              onCrumb={(node) => jumpView(viewFromSpan(node.spanStart, node.spanEnd))}
            />
          )}

          {toast && (
            <div className="toast" style={{ ['--toast-color' as string]: toast.color }} role="status">
              <div className="t-name">{toast.title}</div>
              <div className="t-desc">{toast.desc}</div>
            </div>
          )}

          {storyEvent && mode === 'timeline' && (
            <StoryView event={storyEvent} onClose={() => setStoryEvent(null)} />
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

      <Navigator
        view={view}
        events={visibleEvents}
        onChange={setView}
        onSelectRange={jumpView}
        onBack={goBack}
        canBack={canBack}
        onResetAll={resetAll}
      />
    </div>
  )
}

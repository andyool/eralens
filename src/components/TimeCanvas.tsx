import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import { ParticleField } from '../lib/particleField'
import type { Forest, HNode } from '../lib/hierarchy'
import { panView, zoomView } from '../lib/timeMapping'
import { compactDate } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'
import { fetchWikiSummary } from '../lib/wiki'

interface Props {
  events: HistEvent[]
  forest: Forest
  view: TimeView
  onViewChange: (v: TimeView) => void
  nodePredicate: (node: HNode) => boolean
  eventMatches: (ev: HistEvent) => boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDrill: (id: string) => void
  reducedMotion: boolean
  showHint: boolean
}

export default function TimeCanvas({
  events,
  forest,
  view,
  onViewChange,
  nodePredicate,
  eventMatches,
  selectedId,
  onSelect,
  onDrill,
  reducedMotion,
  showHint,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fieldRef = useRef<ParticleField | null>(null)

  const [hoverId, setHoverId] = useState<string | null>(null)
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null)

  const visibleSorted = useMemo(
    () =>
      events
        .filter((e) => e.tier !== 'moment' && e.year >= view.startYear && e.year <= view.endYear && eventMatches(e))
        .sort((a, b) => a.year - b.year),
    [events, view, eventMatches],
  )

  const emphasisId = hoverId ?? selectedId
  const hoverNode = hoverId ? forest.map.get(hoverId) : null
  const hoverEvent = hoverNode?.ev ?? null

  // ── Field lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
    const field = new ParticleField(canvasRef.current, () => {
      const id = hoverIdRef.current
      if (id) {
        const pos = field.screenPosOf(id)
        if (pos) setChip((c) => (c && c.x === pos.x && c.y === pos.y ? c : pos))
      }
    })
    fieldRef.current = field
    field.setReducedMotion(reducedMotion)
    field.setForest(forestRef.current)
    field.setFilter(nodePredicate)
    field.setView(view)
    field.start()

    const ro = new ResizeObserver(() => field.resize())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      field.destroy()
      fieldRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const forestRef = useRef(forest)
  forestRef.current = forest
  useEffect(() => {
    fieldRef.current?.setForest(forest)
  }, [forest])
  useEffect(() => {
    fieldRef.current?.setView(view)
  }, [view])
  useEffect(() => {
    fieldRef.current?.setFilter(nodePredicate)
  }, [nodePredicate])
  useEffect(() => {
    fieldRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])

  const hoverIdRef = useRef<string | null>(null)
  hoverIdRef.current = hoverId
  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    if (!emphasisId) {
      field.setEmphasis(null)
      return
    }
    field.setEmphasis(emphasisId)
    const ev = forest.map.get(emphasisId)?.ev
    if (!ev?.wikiTitle) return
    let cancelled = false
    fetchWikiSummary(ev).then((s) => {
      if (cancelled || !s?.thumbnail) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (!cancelled && (hoverIdRef.current === emphasisId || selectedId === emphasisId)) {
          field.setEmphasis(emphasisId, img)
        }
      }
      img.src = s.thumbnail
    })
    return () => {
      cancelled = true
    }
  }, [emphasisId, forest, selectedId])

  // ── Pointer interaction ──────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{
    active: boolean
    moved: boolean
    startX: number
    startY: number
    startView: TimeView
    pinchDist: number
    pinchView: TimeView
    pinchWithin: number
  } | null>(null)
  const lastSwitch = useRef(0)

  const localXY = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width }
  }

  const updateHover = useCallback((x: number, y: number, radius: number) => {
    const field = fieldRef.current
    if (!field) return
    const best = field.pick(x, y, radius)
    const now = performance.now()
    const nextId = best?.id ?? null
    if (nextId !== hoverIdRef.current) {
      const grace = nextId ? 55 : 110
      if (now - lastSwitch.current < grace) return
      lastSwitch.current = now
      setHoverId(nextId)
    }
    if (best) setChip({ x: best.x, y: best.y })
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const rect = canvasRef.current!.getBoundingClientRect()
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left
      drag.current = {
        active: false,
        moved: true,
        startX: x,
        startY: y,
        startView: view,
        pinchDist: dist,
        pinchView: view,
        pinchWithin: rect.width ? midX / rect.width : 0.5,
      }
      return
    }

    drag.current = {
      active: true,
      moved: false,
      startX: x,
      startY: y,
      startView: view,
      pinchDist: 0,
      pinchView: view,
      pinchWithin: 0,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y, width } = localXY(e)
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (pointers.current.size === 2 && drag.current) {
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (drag.current.pinchDist > 0) {
        const factor = drag.current.pinchDist / Math.max(1, dist)
        onViewChange(zoomView(drag.current.pinchView, drag.current.pinchWithin, factor))
      }
      return
    }

    if (drag.current?.active && e.pressure > 0) {
      const dx = x - drag.current.startX
      const dy = y - drag.current.startY
      if (!drag.current.moved && Math.hypot(dx, dy) > 5) drag.current.moved = true
      if (drag.current.moved) {
        setHoverId(null)
        setChip(null)
        onViewChange(panView(drag.current.startView, dx / Math.max(1, width)))
        return
      }
    }

    if (e.pointerType !== 'touch' && (!drag.current || !drag.current.moved)) {
      updateHover(x, y, 26)
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    const wasDrag = drag.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      if (wasDrag && wasDrag.active && !wasDrag.moved) {
        const { x, y } = localXY(e)
        const radius = e.pointerType === 'touch' ? 34 : 24
        const best = fieldRef.current?.pick(x, y, radius)
        if (best?.isAggregate) {
          onDrill(best.id)
          setHoverId(null)
          setChip(null)
        } else {
          onSelect(best?.id ?? null)
          if (e.pointerType === 'touch') {
            setHoverId(best?.id ?? null)
            if (best) setChip({ x: best.x, y: best.y })
            else setChip(null)
          }
        }
      }
      drag.current = null
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const within = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    onViewChange(zoomView(view, within, factor))
  }

  const onLeave = () => {
    if (!drag.current?.moved) {
      setHoverId(null)
      setChip(null)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      if (visibleSorted.length === 0) return
      const anchor = selectedId ?? hoverId
      let idx = anchor ? visibleSorted.findIndex((v) => v.id === anchor) : -1
      idx = e.key === 'ArrowRight' ? Math.min(idx + 1, visibleSorted.length - 1) : Math.max(idx - 1, 0)
      if (idx < 0) idx = 0
      const ev = visibleSorted[idx]
      onSelect(ev.id)
      setHoverId(ev.id)
      const pos = fieldRef.current?.screenPosOf(ev.id)
      if (pos) setChip(pos)
    } else if (e.key === 'Enter' && hoverId) {
      onSelect(hoverId)
    } else if (e.key === 'Escape') {
      onSelect(null)
    }
  }

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="field-canvas"
        role="application"
        aria-label="Timeline of events. Use left and right arrow keys to move between events and Enter to open one."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={onLeave}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      />

      {hoverEvent && chip && (
        <div
          className="hover-chip"
          style={{
            left: Math.max(120, Math.min(chip.x, (wrapRef.current?.clientWidth ?? 4000) - 120)),
            top: chip.y,
          }}
          aria-hidden
        >
          <div className="hc-title">{hoverEvent.title}</div>
          <div className="hc-meta">
            <span className="hc-dot" style={{ background: categoryColor(hoverEvent.categories[0]) }} />
            {compactDate(hoverEvent)}
            {hoverNode && hoverNode.children.length > 0 && (
              <span className="hc-contains">· contains {hoverNode.descendantCount} · click to open</span>
            )}
          </div>
        </div>
      )}

      {showHint && (
        <div className="canvas-hint">
          Move across the field to discover events · click a ringed dot to zoom in · drag to pan
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {hoverEvent ? `${hoverEvent.title}, ${compactDate(hoverEvent)}` : ''}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import { ParticleField } from '../lib/particleField'
import type { Forest, HNode } from '../lib/hierarchy'
import type { CausalLinks } from '../lib/related'
import { clampView, panView, xToYear, zoomView } from '../lib/timeMapping'
import { compactDate, formatYear } from '../lib/dateFormat'
import { categoryColor } from '../data/categories'
import { fetchWikiSummary } from '../lib/wiki'

interface Props {
  events: HistEvent[]
  forest: Forest
  view: TimeView
  onViewChange: (v: TimeView) => void
  /** A deliberate range selection (shift-drag) — recorded in history for ↩ Back. */
  onRangeSelect: (v: TimeView) => void
  nodePredicate: (node: HNode) => boolean
  eventMatches: (ev: HistEvent) => boolean
  causalOf: (id: string) => CausalLinks | undefined
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDrill: (id: string) => void
  reducedMotion: boolean
  showHint: boolean
}

const NO_LINKS: ReadonlySet<string> = new Set()

export default function TimeCanvas({
  events,
  forest,
  view,
  onViewChange,
  onRangeSelect,
  nodePredicate,
  eventMatches,
  causalOf,
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
      field.setRelated(NO_LINKS as Set<string>, NO_LINKS as Set<string>)
      return
    }
    field.setEmphasis(emphasisId)
    // Light up the causal neighbourhood: causes and effects of the hovered or
    // selected event stay bright while the rest of the field fades back.
    const links = causalOf(emphasisId)
    field.setRelated(
      links?.causes ?? (NO_LINKS as Set<string>),
      links?.effects ?? (NO_LINKS as Set<string>),
    )
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
  }, [emphasisId, forest, selectedId, causalOf])

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

  // Latest view for animation callbacks that outlive a render.
  const viewRef = useRef(view)
  viewRef.current = view

  // Inertia: the field keeps gliding after a flick, like a real strip of film.
  const velocity = useRef({ v: 0, lastX: 0, lastT: 0 })
  const inertiaRaf = useRef<number | null>(null)
  const stopInertia = useCallback(() => {
    if (inertiaRaf.current != null) cancelAnimationFrame(inertiaRaf.current)
    inertiaRaf.current = null
  }, [])
  const startInertia = useCallback(() => {
    if (reducedMotion) return
    let v = velocity.current.v // px/ms, positive = dragging right
    if (Math.abs(v) < 0.08) return
    v = Math.max(-3.5, Math.min(3.5, v))
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last)
      last = now
      const width = canvasRef.current?.getBoundingClientRect().width ?? 1
      onViewChange(panView(viewRef.current, (v * dt) / Math.max(1, width)))
      v *= Math.exp(-dt / 260)
      if (Math.abs(v) > 0.02) inertiaRaf.current = requestAnimationFrame(step)
      else inertiaRaf.current = null
    }
    inertiaRaf.current = requestAnimationFrame(step)
  }, [onViewChange, reducedMotion])
  useEffect(() => stopInertia, [stopInertia])

  // Shift-drag range selection, drawn as a translucent band with live dates.
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null)
  const brushing = useRef(false)

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
    stopInertia()

    if (e.shiftKey && pointers.current.size === 1) {
      brushing.current = true
      setBrush({ x0: x, x1: x })
      setHoverId(null)
      setChip(null)
      return
    }

    velocity.current = { v: 0, lastX: x, lastT: performance.now() }

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

    if (brushing.current) {
      setBrush((b) => (b ? { ...b, x1: x } : b))
      return
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
        // Smoothed velocity sample for the release inertia.
        const now = performance.now()
        const dt = now - velocity.current.lastT
        if (dt > 0) {
          const inst = (x - velocity.current.lastX) / dt
          velocity.current.v = velocity.current.v * 0.75 + inst * 0.25
          velocity.current.lastX = x
          velocity.current.lastT = now
        }
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

    if (brushing.current) {
      brushing.current = false
      const { x } = localXY(e)
      const width = canvasRef.current?.getBoundingClientRect().width ?? 1
      setBrush((b) => {
        if (b && Math.abs(x - b.x0) > 10) {
          const lo = Math.min(b.x0, x)
          const hi = Math.max(b.x0, x)
          onRangeSelect(
            clampView({ startYear: xToYear(lo, view, width), endYear: xToYear(hi, view, width) }),
          )
        }
        return null
      })
      drag.current = null
      return
    }

    if (pointers.current.size === 0) {
      if (wasDrag && wasDrag.active && wasDrag.moved) {
        startInertia()
      }
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
    stopInertia()
    const rect = canvasRef.current!.getBoundingClientRect()
    const within = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
    // Delta-proportional factor: gentle on trackpads, solid on wheel notches.
    const factor = Math.exp(Math.max(-320, Math.min(320, e.deltaY)) * 0.0016)
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
            {(() => {
              const links = causalOf(hoverEvent.id)
              if (!links || links.causes.size + links.effects.size === 0) return null
              return (
                <span className="hc-contains">
                  {links.causes.size > 0 && ` · ${links.causes.size} cause${links.causes.size > 1 ? 's' : ''}`}
                  {links.effects.size > 0 && ` · ${links.effects.size} effect${links.effects.size > 1 ? 's' : ''}`}
                </span>
              )
            })()}
          </div>
        </div>
      )}

      {brush && Math.abs(brush.x1 - brush.x0) > 4 && (
        <div
          className="range-brush"
          style={{ left: Math.min(brush.x0, brush.x1), width: Math.abs(brush.x1 - brush.x0) }}
          aria-hidden
        >
          <span className="brush-label left">
            {formatYear(xToYear(Math.min(brush.x0, brush.x1), view, wrapRef.current?.clientWidth ?? 1))}
          </span>
          <span className="brush-label right">
            {formatYear(xToYear(Math.max(brush.x0, brush.x1), view, wrapRef.current?.clientWidth ?? 1))}
          </span>
        </div>
      )}

      {showHint && (
        <div className="canvas-hint">
          Drag to pan · scroll to zoom · shift-drag to select a range · click a ringed dot to open
          its timeline
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {hoverEvent ? `${hoverEvent.title}, ${compactDate(hoverEvent)}` : ''}
      </div>
    </div>
  )
}

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import {
  axisTicks,
  clampView,
  fractionInView,
  fractionOnFullAxis,
  panView,
  unwarp,
  warp,
  xToYear,
  yearAtFullAxisFraction,
  zoomView,
} from '../lib/timeMapping'
import { sliceInView } from '../lib/eventWindow'
import { formatYear } from '../lib/dateFormat'
import { useResizeObserver } from '../hooks'

interface Props {
  view: TimeView
  /** Year-sorted events (oldest first) — enables binary-search slicing. */
  events: HistEvent[]
  onChange: (view: TimeView) => void
  /** A deliberate range selection — recorded in history for ↩ Back. */
  onSelectRange: (view: TimeView) => void
  onBack: () => void
  canBack: boolean
  onResetAll: () => void
}

/**
 * The bottom scale — the primary way to pick a date range. It always shows the
 * *visible* range (zoom into the 20th century and it reads 1900 … 2000) using
 * the same warped time mapping as the main canvas, so the density silhouette
 * lines up column-for-column with the dots above it.
 *
 * Drag across it to sweep out a range: release, and the view zooms to exactly
 * that span. Scroll to zoom around the cursor. ↩ Back undoes jumps.
 */
/** "1969", "44 BC", "44 BCE", "AD 79", "-44" → astronomical year. */
function parseYearInput(s: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(bce?|ce|ad)?\s*$/i.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return /^bce?$/i.test(m[2] ?? '') ? -Math.abs(n) : n
}

/** Editable form of a view bound ("500 BCE", "1969"). */
function yearInputValue(year: number): string {
  const y = Math.round(year)
  if (y < -99_999) return String(y) // deep time — leave raw
  return y < 0 ? `${-y} BCE` : String(y)
}

export default function Navigator({
  view,
  events,
  onChange,
  onSelectRange,
  onBack,
  canBack,
  onResetAll,
}: Props) {
  const [trackRef, size] = useResizeObserver<HTMLDivElement>()
  const histRef = useRef<HTMLCanvasElement | null>(null)
  const overviewRef = useRef<HTMLCanvasElement | null>(null)
  const ovDragging = useRef(false)
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null)

  // The precise year-range picker. Inputs mirror the view unless being edited.
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')
  const [rangeInvalid, setRangeInvalid] = useState(false)
  const editing = useRef(false)
  useEffect(() => {
    if (editing.current) return
    setFromStr(yearInputValue(view.startYear))
    setToStr(yearInputValue(view.endYear))
    setRangeInvalid(false)
  }, [view.startYear, view.endYear])

  const commitRange = useCallback(() => {
    const a = parseYearInput(fromStr)
    const b = parseYearInput(toStr)
    if (a === null || b === null || a >= b) {
      setRangeInvalid(true)
      return
    }
    setRangeInvalid(false)
    editing.current = false
    onSelectRange(clampView({ startYear: a, endYear: b }))
  }, [fromStr, toStr, onSelectRange])
  const brushing = useRef(false)

  const width = size.width || 800
  const ticks = useMemo(() => axisTicks(view, width, 60), [view, width])

  // ── Overview strip: all of time, with a "you are here" window ─────────
  // The density silhouette over the FULL axis only depends on the dataset,
  // so it redraws on data/size changes — never while panning.
  useEffect(() => {
    const canvas = overviewRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = width
    const h = canvas.clientHeight || 18
    if (w < 2) return
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const bins = Math.max(80, Math.min(560, Math.floor(w / 2)))
    const density = new Array<number>(bins).fill(0)
    for (const ev of events) {
      if (ev.tier === 'moment') continue
      const f = fractionOnFullAxis(ev.year)
      if (f < 0 || f > 1) continue
      density[Math.min(bins - 1, Math.floor(f * bins))] += 1
    }
    const max = Math.max(1, ...density)
    ctx.fillStyle = 'rgba(139,157,255,0.4)'
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < bins; i++) {
      const x = (i / (bins - 1)) * w
      const v = Math.sqrt(density[i] / max)
      ctx.lineTo(x, h - v * (h - 2))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }, [events, width])

  /** Recentre the view (keeping its warped width) on an overview position. */
  const overviewJump = useCallback(
    (clientX: number) => {
      const el = overviewRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const tMid = warp(yearAtFullAxisFraction(frac))
      const half = (warp(view.startYear) - warp(view.endYear)) / 2
      onChange(clampView({ startYear: unwarp(tMid + half), endYear: unwarp(tMid - half) }))
    },
    [view, onChange],
  )

  // Window box position on the full axis (older = left).
  const ovLeft = fractionOnFullAxis(view.startYear) * 100
  const ovRight = fractionOnFullAxis(view.endYear) * 100

  // The silhouette is decorative — let it trail the urgent view updates so a
  // fast pan never blocks on redrawing the histogram.
  const deferredView = useDeferredValue(view)

  // Density silhouette of the events inside the visible range.
  useEffect(() => {
    const canvas = histRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = size.width || canvas.clientWidth
    const h = size.height || canvas.clientHeight
    if (w === 0 || h === 0) return
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const bins = Math.max(60, Math.min(420, Math.floor(w / 3)))
    const density = new Array<number>(bins).fill(0)
    for (const ev of sliceInView(events, deferredView)) {
      if (ev.tier === 'moment') continue
      const f = fractionInView(ev.year, deferredView)
      if (f < 0 || f > 1) continue
      density[Math.min(bins - 1, Math.floor(f * bins))] += 1
    }
    const max = Math.max(1, ...density)
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(91,200,255,0.55)')
    grad.addColorStop(1, 'rgba(139,157,255,0.06)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < bins; i++) {
      const x = (i / (bins - 1)) * w
      const v = Math.sqrt(density[i] / max) // sqrt keeps small counts visible
      ctx.lineTo(x, h - v * (h - 4))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()

    // Faint grid lines under the ticks so the scale reads against the wave.
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.lineWidth = 1
    for (const t of ticks) {
      const x = Math.round(t.fraction * w) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, t.major ? 2 : h * 0.45)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
  }, [events, deferredView, ticks, size.width, size.height])

  const localX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      return Math.max(0, Math.min(rect.width, clientX - rect.left))
    },
    [trackRef],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const x = localX(e.clientX)
      brushing.current = true
      setBrush({ x0: x, x1: x })
      document.body.style.userSelect = 'none'
    },
    [localX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!brushing.current) return
      const x = localX(e.clientX)
      setBrush((b) => (b ? { ...b, x1: x } : b))
    },
    [localX],
  )

  const endBrush = useCallback(
    (e: React.PointerEvent) => {
      if (!brushing.current) return
      brushing.current = false
      document.body.style.userSelect = ''
      const x = localX(e.clientX)
      setBrush((b) => {
        if (b && Math.abs(x - b.x0) > 8) {
          const lo = Math.min(b.x0, x)
          const hi = Math.max(b.x0, x)
          onSelectRange(
            clampView({ startYear: xToYear(lo, view, width), endYear: xToYear(hi, view, width) }),
          )
        }
        return null
      })
    },
    [localX, onSelectRange, view, width],
  )

  const onWheel = (e: React.WheelEvent) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const within = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
    // Delta-proportional factor: gentle on trackpads, solid on wheel notches.
    const factor = Math.exp(Math.max(-320, Math.min(320, e.deltaY)) * 0.0016)
    onChange(zoomView(view, within, factor))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(panView(view, e.key === 'ArrowLeft' ? 0.12 : -0.12))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      onChange(zoomView(view, 0.5, 1 / 1.4))
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      onChange(zoomView(view, 0.5, 1.4))
    }
  }

  const brushLo = brush ? Math.min(brush.x0, brush.x1) : 0
  const brushHi = brush ? Math.max(brush.x0, brush.x1) : 0
  const brushActive = brush != null && brushHi - brushLo > 4

  return (
    <div className="navigator" aria-label="Time scale">
      <div
        className="nav-overview"
        title="All of time — click or drag to move the window"
        onPointerDown={(e) => {
          e.preventDefault()
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          ovDragging.current = true
          overviewJump(e.clientX)
        }}
        onPointerMove={(e) => {
          if (ovDragging.current) overviewJump(e.clientX)
        }}
        onPointerUp={() => {
          ovDragging.current = false
        }}
        onPointerCancel={() => {
          ovDragging.current = false
        }}
      >
        <canvas className="nav-ov-canvas" ref={overviewRef} aria-hidden />
        <span className="nav-ov-label left" aria-hidden>
          Big Bang
        </span>
        <span className="nav-ov-label right" aria-hidden>
          Now
        </span>
        <div
          className="nav-ov-window"
          aria-hidden
          style={{
            left: `${ovLeft}%`,
            width: `max(6px, ${Math.max(0, ovRight - ovLeft)}%)`,
          }}
        />
      </div>

      <div
        className={`nav-track ${brushActive ? 'brushing' : ''}`}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endBrush}
        onPointerCancel={endBrush}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        role="slider"
        tabIndex={0}
        aria-label="Time scale. Drag across it to zoom to a range, scroll to zoom, arrow keys to pan, plus and minus to zoom."
        aria-valuetext={`${formatYear(view.startYear)} to ${formatYear(view.endYear)}`}
      >
        <canvas className="nav-hist" ref={histRef} aria-hidden />
        {brushActive && (
          <div className="nav-selection" style={{ left: brushLo, width: brushHi - brushLo }}>
            <span className="brush-label left">{formatYear(xToYear(brushLo, view, width))}</span>
            <span className="brush-label right">{formatYear(xToYear(brushHi, view, width))}</span>
          </div>
        )}
        {!brushActive && <span className="nav-hint-text">drag across a range to zoom to it</span>}
      </div>

      <div className="nav-ticks" aria-hidden>
        {ticks.map((t) => (
          <span
            key={t.year}
            className={`nav-tick ${t.major ? 'major' : ''}`}
            style={{ left: `${t.fraction * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="nav-caption">
        <form
          className={`nav-range ${rangeInvalid ? 'invalid' : ''}`}
          onSubmit={(e) => {
            e.preventDefault()
            commitRange()
          }}
          aria-label="Jump to an exact year range"
        >
          <span className="nr-label">Years</span>
          <input
            className="nr-input"
            value={fromStr}
            onChange={(e) => {
              setFromStr(e.target.value)
              setRangeInvalid(false)
            }}
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            aria-label="Start year (e.g. 1900 or 44 BCE)"
            placeholder="1900"
            size={7}
          />
          <span className="nr-arrow">→</span>
          <input
            className="nr-input"
            value={toStr}
            onChange={(e) => {
              setToStr(e.target.value)
              setRangeInvalid(false)
            }}
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            aria-label="End year (e.g. 2000 or 30 BCE)"
            placeholder="2000"
            size={7}
          />
          <button className="nav-mini-btn nr-go" type="submit">
            Go
          </button>
          <span className="nr-showing hide-sm">
            {formatYear(view.startYear)} → {formatYear(view.endYear)}
          </span>
        </form>
        <span className="zoom-btns">
          <button className="nav-mini-btn" onClick={onBack} disabled={!canBack} title="Back to the previous view">
            ↩ Back
          </button>
          <button className="nav-mini-btn" onClick={() => onChange(zoomView(view, 0.5, 1 / 1.6))}>
            Zoom in
          </button>
          <button className="nav-mini-btn" onClick={() => onChange(zoomView(view, 0.5, 1.6))}>
            Zoom out
          </button>
          <button className="nav-mini-btn" onClick={onResetAll}>
            All of time
          </button>
        </span>
      </div>
    </div>
  )
}

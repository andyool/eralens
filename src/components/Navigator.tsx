import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import {
  axisTicks,
  clampView,
  fractionInView,
  panView,
  xToYear,
  zoomView,
} from '../lib/timeMapping'
import { formatYear } from '../lib/dateFormat'
import { useResizeObserver } from '../hooks'

interface Props {
  view: TimeView
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
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null)
  const brushing = useRef(false)

  const width = size.width || 800
  const ticks = useMemo(() => axisTicks(view, width, 60), [view, width])

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
    for (const ev of events) {
      if (ev.tier === 'moment') continue
      const f = fractionInView(ev.year, view)
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
  }, [events, view, ticks, size.width, size.height])

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
        <span>
          Showing <span className="range">{formatYear(view.startYear)}</span> →{' '}
          <span className="range">{formatYear(view.endYear)}</span>
        </span>
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

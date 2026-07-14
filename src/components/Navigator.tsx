import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import {
  MIN_YEAR,
  MAX_YEAR,
  clampView,
  fractionOnFullAxis,
  yearAtFullAxisFraction,
  zoomView,
} from '../lib/timeMapping'
import { formatYear } from '../lib/dateFormat'
import { useResizeObserver } from '../hooks'

interface Props {
  view: TimeView
  events: HistEvent[]
  onChange: (view: TimeView) => void
}

// Log-spaced reference marks across the whole Big Bang → now axis.
const AXIS_MARKS_BP = [0, 1000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000]

type DragMode = 'start' | 'end' | 'pan' | null

export default function Navigator({ view, events, onChange }: Props) {
  const [trackRef, size] = useResizeObserver<HTMLDivElement>()
  const histRef = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<{ mode: DragMode; grabFrac: number; startFrac: number; endFrac: number }>({
    mode: null,
    grabFrac: 0,
    startFrac: 0,
    endFrac: 1,
  })

  const fracStart = fractionOnFullAxis(view.startYear)
  const fracEnd = fractionOnFullAxis(view.endYear)

  // Precompute the density silhouette over the full axis.
  const density = useMemo(() => {
    const bins = 240
    const arr = new Array(bins).fill(0)
    for (const ev of events) {
      const f = fractionOnFullAxis(ev.year)
      const b = Math.max(0, Math.min(bins - 1, Math.floor(f * bins)))
      arr[b] += 1
    }
    return arr
  }, [events])

  // Draw the histogram whenever size or data changes.
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

    const bins = density.length
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
      const y = h - v * (h - 4)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }, [density, size.width, size.height])

  const fracFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [trackRef])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d.mode) return
      const f = fracFromClientX(e.clientX)
      if (d.mode === 'start') {
        const nf = Math.min(f, d.endFrac - 0.006)
        onChange(clampView({ startYear: yearAtFullAxisFraction(nf), endYear: view.endYear }))
      } else if (d.mode === 'end') {
        const nf = Math.max(f, d.startFrac + 0.006)
        onChange(clampView({ startYear: view.startYear, endYear: yearAtFullAxisFraction(nf) }))
      } else if (d.mode === 'pan') {
        let delta = f - d.grabFrac
        let ns = d.startFrac + delta
        let ne = d.endFrac + delta
        if (ns < 0) {
          ne -= ns
          ns = 0
        }
        if (ne > 1) {
          ns -= ne - 1
          ne = 1
        }
        onChange(
          clampView({ startYear: yearAtFullAxisFraction(ns), endYear: yearAtFullAxisFraction(ne) }),
        )
      }
    }
    const onUp = () => {
      drag.current.mode = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [fracFromClientX, onChange, view.startYear, view.endYear])

  const beginDrag = (mode: Exclude<DragMode, null>) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { mode, grabFrac: fracFromClientX(e.clientX), startFrac: fracStart, endFrac: fracEnd }
    document.body.style.userSelect = 'none'
  }

  const onWheel = (e: React.WheelEvent) => {
    const focal = fracFromClientX(e.clientX)
    // focal fraction is on the full axis; convert to fraction within the view.
    const within = (focal - fracStart) / Math.max(1e-6, fracEnd - fracStart)
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18
    onChange(zoomView(view, within, factor))
  }

  const marks = AXIS_MARKS_BP.map((bp) => {
    const year = MAX_YEAR - bp
    return { year, frac: fractionOnFullAxis(year), label: markLabel(bp) }
  }).filter((m) => m.frac >= 0 && m.frac <= 1)

  return (
    <div className="navigator" aria-label="Time range navigator">
      <div
        className={`nav-track ${drag.current.mode === 'pan' ? 'dragging' : ''}`}
        ref={trackRef}
        onPointerDown={beginDrag('pan')}
        onWheel={onWheel}
        role="group"
        aria-label="Drag to pan; drag the handles to change the start and end of the visible period"
      >
        <canvas className="nav-hist" ref={histRef} aria-hidden />
        <div className="nav-mask" style={{ left: 0, width: `${fracStart * 100}%` }} />
        <div className="nav-mask" style={{ right: 0, width: `${(1 - fracEnd) * 100}%` }} />
        <div
          className="nav-selection"
          style={{ left: `${fracStart * 100}%`, width: `${(fracEnd - fracStart) * 100}%` }}
          onPointerDown={beginDrag('pan')}
        />
        <div
          className="nav-handle"
          style={{ left: `${fracStart * 100}%` }}
          onPointerDown={beginDrag('start')}
          role="slider"
          tabIndex={0}
          aria-label="Start of period"
          aria-valuetext={formatYear(view.startYear)}
          onKeyDown={(e) => handleKey(e, view, onChange, 'start')}
        />
        <div
          className="nav-handle"
          style={{ left: `${fracEnd * 100}%` }}
          onPointerDown={beginDrag('end')}
          role="slider"
          tabIndex={0}
          aria-label="End of period"
          aria-valuetext={formatYear(view.endYear)}
          onKeyDown={(e) => handleKey(e, view, onChange, 'end')}
        />
      </div>

      <div className="nav-ticks" aria-hidden>
        {marks.map((m) => (
          <span
            key={m.year}
            className="nav-tick major"
            style={{ left: `${m.frac * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="nav-caption">
        <span>
          Showing <span className="range">{formatYear(view.startYear)}</span> →{' '}
          <span className="range">{formatYear(view.endYear)}</span>
        </span>
        <span className="zoom-btns">
          <button className="nav-mini-btn" onClick={() => onChange(zoomView(view, 0.5, 1 / 1.6))}>
            Zoom in
          </button>
          <button className="nav-mini-btn" onClick={() => onChange(zoomView(view, 0.5, 1.6))}>
            Zoom out
          </button>
          <button
            className="nav-mini-btn"
            onClick={() => onChange({ startYear: MIN_YEAR, endYear: MAX_YEAR })}
          >
            All of time
          </button>
        </span>
      </div>
    </div>
  )
}

function markLabel(bp: number): string {
  if (bp === 0) return 'now'
  if (bp >= 1_000_000_000) return `${bp / 1_000_000_000} Gya`
  if (bp >= 1_000_000) return `${bp / 1_000_000} Mya`
  if (bp >= 1000) return `${bp / 1000} kya`
  return `${bp}`
}

function handleKey(
  e: React.KeyboardEvent,
  view: TimeView,
  onChange: (v: TimeView) => void,
  which: 'start' | 'end',
) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const dir = e.key === 'ArrowRight' ? 1 : -1
  const f = which === 'start' ? fractionOnFullAxis(view.startYear) : fractionOnFullAxis(view.endYear)
  const nf = Math.max(0, Math.min(1, f + dir * 0.01))
  const year = yearAtFullAxisFraction(nf)
  if (which === 'start') onChange(clampView({ startYear: year, endYear: view.endYear }))
  else onChange(clampView({ startYear: view.startYear, endYear: year }))
}

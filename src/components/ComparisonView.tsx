import { useEffect, useMemo, useRef, useState } from 'react'
import type { CategoryId, HistEvent, TimeView } from '../lib/types'
import { CATEGORIES, CATEGORY_MAP, categoryColor } from '../data/categories'
import { yearToX, axisTicks } from '../lib/timeMapping'
import { decimalYear } from '../lib/hierarchy'
import { baseRadius } from '../lib/significance'
import { compactDate } from '../lib/dateFormat'
import { useResizeObserver } from '../hooks'

interface Props {
  events: HistEvent[]
  view: TimeView
  selectedId: string | null
  onSelect: (id: string) => void
}

interface Screen {
  ev: HistEvent
  x: number
  y: number
}

const PAD = 16

function Lane({
  value,
  onChange,
  count,
  color,
}: {
  value: CategoryId
  onChange: (c: CategoryId) => void
  count: number
  color: string
}) {
  return (
    <div className="cmp-lane-label">
      <span className="cmp-swatch" style={{ background: color }} />
      <select value={value} onChange={(e) => onChange(e.target.value as CategoryId)}>
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="cmp-count">{count}</span>
    </div>
  )
}

export default function ComparisonView({ events, view, selectedId, onSelect }: Props) {
  const [wrapRef, size] = useResizeObserver<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [catA, setCatA] = useState<CategoryId>('wars')
  const [catB, setCatB] = useState<CategoryId>('technology')
  const [hoverId, setHoverId] = useState<string | null>(null)
  const screenRef = useRef<Screen[]>([])

  const inView = useMemo(
    () =>
      events.filter(
        (e) => e.tier !== 'moment' && e.year >= view.startYear && e.year <= view.endYear,
      ),
    [events, view],
  )
  const listA = useMemo(() => inView.filter((e) => e.categories.includes(catA)), [inView, catA])
  const listB = useMemo(() => inView.filter((e) => e.categories.includes(catB)), [inView, catB])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = size.width || canvas.clientWidth
    const h = size.height || canvas.clientHeight
    if (w < 2 || h < 2) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const innerW = w - PAD * 2
    const midY = h / 2
    const laneAY = h * 0.28
    const laneBY = h * 0.72
    const half = h * 0.2

    // Middle axis line + ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(w, midY)
    ctx.stroke()
    ctx.fillStyle = 'rgba(170,178,197,0.8)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    for (const t of axisTicks(view, innerW, 80)) {
      const x = PAD + t.fraction * innerW
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath()
      ctx.moveTo(x, laneAY - half)
      ctx.lineTo(x, laneBY + half)
      ctx.stroke()
      ctx.fillText(t.label, x, midY + 4)
    }

    const screen: Screen[] = []
    const drawLane = (list: HistEvent[], cat: CategoryId, centerY: number, dir: number) => {
      const color = categoryColor(cat)
      const rgb = color
      // bucket by x, stack away from the centre line
      const buckets = new Map<number, HistEvent[]>()
      const xOf = (e: HistEvent) => PAD + yearToX(decimalYear(e), view, innerW)
      for (const e of list) {
        const b = Math.round(xOf(e) / 7)
        const arr = buckets.get(b) ?? []
        arr.push(e)
        buckets.set(b, arr)
      }
      for (const arr of buckets.values()) {
        arr.sort((a, b) => b.significance - a.significance)
        const spacing = Math.min(9, (half - 6) / (arr.length + 0.5))
        arr.forEach((e, i) => {
          const x = xOf(e)
          const y = centerY + dir * (6 + i * spacing)
          screen.push({ ev: e, x, y })
          if (e.id === hoverId || e.id === selectedId) return
          ctx.beginPath()
          ctx.fillStyle = rgb + 'cc'
          ctx.arc(x, y, baseRadius(e) + 0.4, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    }
    drawLane(listA, catA, laneAY, -1)
    drawLane(listB, catB, laneBY, 1)
    screenRef.current = screen

    const emphId = hoverId ?? selectedId
    const emph = screen.find((s) => s.ev.id === emphId)
    if (emph) {
      const color = categoryColor(emph.ev.categories[0])
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(emph.x, emph.y, baseRadius(emph.ev) + 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke()
    }
  }, [listA, listB, catA, catB, view, size.width, size.height, hoverId, selectedId])

  const pick = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    let best: string | null = null
    let bestD = 15 * 15
    for (const s of screenRef.current) {
      const d = (s.x - px) ** 2 + (s.y - py) ** 2
      if (d < bestD) {
        bestD = d
        best = s.ev.id
      }
    }
    return best
  }

  const hoverEv = hoverId ? screenRef.current.find((s) => s.ev.id === hoverId)?.ev : null

  return (
    <div className="cmp-view">
      <div className="cmp-head">
        <span className="cmp-title">Compare</span>
        <Lane value={catA} onChange={setCatA} count={listA.length} color={categoryColor(catA)} />
        <span className="cmp-vs">vs</span>
        <Lane value={catB} onChange={setCatB} count={listB.length} color={categoryColor(catB)} />
        <span className="cmp-hint">
          {CATEGORY_MAP[catA].label} above · {CATEGORY_MAP[catB].label} below · same time axis
        </span>
      </div>
      <div className="cmp-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="cmp-canvas"
          onPointerMove={(e) => setHoverId(pick(e.clientX, e.clientY))}
          onPointerLeave={() => setHoverId(null)}
          onClick={(e) => {
            const id = pick(e.clientX, e.clientY)
            if (id) onSelect(id)
          }}
          style={{ cursor: hoverId ? 'pointer' : 'default' }}
        />
        {hoverEv && (
          <div className="map-tooltip">
            <strong>{hoverEv.title}</strong> · {compactDate(hoverEv)}
          </div>
        )}
      </div>
    </div>
  )
}

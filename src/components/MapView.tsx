import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistEvent, TimeView } from '../lib/types'
import { CONTINENTS, resolveCoords } from '../data/geo'
import { categoryColor } from '../data/categories'
import { baseRadius } from '../lib/significance'
import { compactDate } from '../lib/dateFormat'
import { useResizeObserver } from '../hooks'

interface Props {
  events: HistEvent[]
  view: TimeView
  eventMatches: (ev: HistEvent) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
}

interface Placed {
  ev: HistEvent
  lon: number
  lat: number
}

function hashJitter(id: string): [number, number] {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const a = ((h >>> 0) % 1000) / 1000 - 0.5
  const b = (((h >>> 10) & 1023) / 1023) - 0.5
  return [a, b]
}

export default function MapView({ events, view, eventMatches, selectedId, onSelect }: Props) {
  const [wrapRef, size] = useResizeObserver<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const placedRef = useRef<{ ev: HistEvent; x: number; y: number }[]>([])

  const placed = useMemo<Placed[]>(() => {
    const out: Placed[] = []
    for (const ev of events) {
      if (ev.tier === 'moment') continue
      if (ev.year < view.startYear || ev.year > view.endYear) continue
      if (!eventMatches(ev)) continue
      const c = resolveCoords(ev)
      if (!c) continue
      out.push({ ev, lon: c[0], lat: c[1] })
    }
    return out
  }, [events, view, eventMatches])

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

    // Map rect (2:1 equirectangular, letterboxed + padded).
    const pad = 24
    const availW = w - pad * 2
    const availH = h - pad * 2
    const mapW = Math.min(availW, availH * 2)
    const mapH = mapW / 2
    const ox = (w - mapW) / 2
    const oy = (h - mapH) / 2
    const proj = (lon: number, lat: number) => ({
      x: ox + ((lon + 180) / 360) * mapW,
      y: oy + ((90 - lat) / 180) * mapH,
    })

    // Graticule.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let lon = -180; lon <= 180; lon += 30) {
      const a = proj(lon, 90)
      const b = proj(lon, -90)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    for (let lat = -60; lat <= 90; lat += 30) {
      const a = proj(-180, lat)
      const b = proj(180, lat)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    // Continents (faint context).
    ctx.fillStyle = 'rgba(139,157,255,0.07)'
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    for (const poly of CONTINENTS) {
      ctx.beginPath()
      poly.forEach(([lon, lat], i) => {
        const p = proj(lon, lat)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // Event points (jittered a touch so co-located events don't fully overlap).
    const placedScreen: { ev: HistEvent; x: number; y: number }[] = []
    for (const { ev, lon, lat } of placed) {
      const [jx, jy] = hashJitter(ev.id)
      const p = proj(lon, lat)
      const x = p.x + jx * 6
      const y = p.y + jy * 6
      placedScreen.push({ ev, x, y })
      if (ev.id === hoverId || ev.id === selectedId) continue
      const color = categoryColor(ev.categories[0])
      ctx.beginPath()
      ctx.fillStyle = color + 'cc'
      ctx.arc(x, y, baseRadius(ev) + 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
    placedRef.current = placedScreen

    // Emphasis for hovered / selected.
    const emphId = hoverId ?? selectedId
    const emph = placedScreen.find((p) => p.ev.id === emphId)
    if (emph) {
      const color = categoryColor(emph.ev.categories[0])
      const r = baseRadius(emph.ev) + 4
      const grad = ctx.createRadialGradient(emph.x, emph.y, 0, emph.x, emph.y, r * 3)
      grad.addColorStop(0, color + '66')
      grad.addColorStop(1, color + '00')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(emph.x, emph.y, r * 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(emph.x, emph.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke()
    }
  }, [placed, size.width, size.height, hoverId, selectedId])

  const pick = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    let best: string | null = null
    let bestD = 16 * 16
    for (const p of placedRef.current) {
      const d = (p.x - px) ** 2 + (p.y - py) ** 2
      if (d < bestD) {
        bestD = d
        best = p.ev.id
      }
    }
    return best
  }

  const hoverEv = hoverId ? placed.find((p) => p.ev.id === hoverId)?.ev : null

  return (
    <div className="map-view" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerMove={(e) => setHoverId(pick(e.clientX, e.clientY))}
        onPointerLeave={() => setHoverId(null)}
        onClick={(e) => {
          const id = pick(e.clientX, e.clientY)
          if (id) onSelect(id)
        }}
        style={{ cursor: hoverId ? 'pointer' : 'default' }}
      />
      <div className="map-note">
        {placed.length.toLocaleString()} located event{placed.length === 1 ? '' : 's'} in this period.
        Events without a known place aren’t shown.
      </div>
      {hoverEv && (
        <div className="map-tooltip">
          <strong>{hoverEv.title}</strong> · {compactDate(hoverEv)}
          {hoverEv.location ? ` · ${hoverEv.location}` : ''}
        </div>
      )}
    </div>
  )
}

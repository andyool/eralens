import type { HistEvent, TimeView } from './types'
import { categoryColor } from '../data/categories'
import { yearToX } from './timeMapping'
import { baseRadius, selectionScore } from './significance'

export interface PickResult {
  id: string
  x: number
  y: number
  dist: number
}

interface Particle {
  ev: HistEvent
  x: number
  y: number
  tx: number
  ty: number
  r: number
  tr: number
  alpha: number
  tAlpha: number
  color: string
  colorRgb: [number, number, number]
  visible: boolean
  seed: number
  tau: number // per-particle smoothing time constant (ms)
}

type FilterPredicate = (ev: HistEvent) => boolean

const BUCKET_PX = 7
const BASE_SPACING = 8
const HALO_ALPHA = 0.9

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // → [0,1)
  return ((h >>> 0) % 100000) / 100000
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The particle field. An imperative canvas renderer deliberately kept outside
 * React's render loop: it owns layout, the "fly into formation" animation and
 * cursor hit-testing, and only calls back out to report frames.
 */
export class ParticleField {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0

  private particles = new Map<string, Particle>()
  private ordered: Particle[] = []
  private view: TimeView = { startYear: -13_800_000_000, endYear: 2026 }
  private predicate: FilterPredicate = () => true

  private emphasisId: string | null = null
  private emphasisImage: HTMLImageElement | null = null
  private pulse = 0

  private reducedMotion = false
  private rafId: number | null = null
  private lastTs = 0
  private running = false
  private onFrame?: () => void

  constructor(canvas: HTMLCanvasElement, onFrame?: () => void) {
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.canvas = canvas
    this.ctx = ctx
    this.onFrame = onFrame
    this.resize()
  }

  setReducedMotion(v: boolean) {
    this.reducedMotion = v
  }

  setEvents(events: HistEvent[]) {
    this.particles.clear()
    for (const ev of events) {
      const color = categoryColor(ev.categories[0])
      this.particles.set(ev.id, {
        ev,
        x: 0,
        y: 0,
        tx: 0,
        ty: 0,
        r: 0,
        tr: baseRadius(ev),
        alpha: 0,
        tAlpha: 0,
        color,
        colorRgb: hexToRgb(color),
        visible: false,
        seed: hashId(ev.id),
        tau: 110 + hashId(ev.id + 'tau') * 120,
      })
    }
    this.layout(true)
  }

  setView(view: TimeView) {
    this.view = view
    this.layout(false)
    this.ensureRunning()
  }

  setFilter(predicate: FilterPredicate) {
    this.predicate = predicate
    this.layout(false)
    this.ensureRunning()
  }

  setEmphasis(id: string | null, image: HTMLImageElement | null = null) {
    if (id !== this.emphasisId) this.pulse = 0
    this.emphasisId = id
    this.emphasisImage = image
    this.ensureRunning()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.layout(true)
    this.ensureRunning()
  }

  /** Compute target positions for the current view + filter. */
  private layout(snap: boolean) {
    const { width, height, view } = this
    const centerY = height * 0.5
    const maxHalf = Math.max(20, Math.min(centerY, height - centerY) - 12)
    const pad = 10

    // Which particles are visible, and their raw x.
    const visible: Particle[] = []
    const slack = 0 // could widen the window; keep tight for crisp edges
    for (const p of this.particles.values()) {
      const inRange = p.ev.year >= view.startYear - slack && p.ev.year <= view.endYear + slack
      const passes = inRange && this.predicate(p.ev)
      p.visible = passes
      if (passes) {
        const jitterX = (p.seed - 0.5) * 2.5
        p.tx = pad + yearToX(p.ev.year, view, width - pad * 2) + jitterX
        visible.push(p)
      } else {
        p.tAlpha = 0
      }
    }

    // Bucket by x to build the vertical "waveform" stacks.
    const buckets = new Map<number, Particle[]>()
    for (const p of visible) {
      const b = Math.round(p.tx / BUCKET_PX)
      const list = buckets.get(b) ?? []
      list.push(p)
      buckets.set(b, list)
    }

    for (const list of buckets.values()) {
      // Most significant nearest the centre line → easier to hit & see.
      list.sort((a, b) => b.ev.significance - a.ev.significance)
      const count = list.length
      const spacing = Math.min(BASE_SPACING, maxHalf / (count / 2 + 0.6))
      for (let i = 0; i < count; i++) {
        const p = list[i]
        // slot 0 at centre, then alternate above/below.
        const step = Math.ceil(i / 2)
        const sign = i % 2 === 0 ? -1 : 1
        const jitterY = (hashId(p.ev.id + 'y') - 0.5) * spacing * 0.5
        p.ty = centerY + sign * step * spacing + jitterY
        p.tAlpha = 1
      }
    }

    if (snap) {
      for (const p of this.particles.values()) {
        p.x = p.tx
        p.y = p.ty
        p.alpha = p.tAlpha
        p.r = p.tr
      }
    } else {
      // New arrivals start from their target x but slightly off, so they
      // "fly in" rather than popping.
      for (const p of visible) {
        if (p.alpha < 0.02) {
          p.x = p.tx
          p.y = this.height * 0.5
        }
      }
    }

    // Keep a draw order: important + emphasised drawn last (on top).
    this.ordered = Array.from(this.particles.values()).sort(
      (a, b) => a.ev.significance - b.ev.significance,
    )
  }

  private ensureRunning() {
    if (!this.running) {
      this.running = true
      this.lastTs = 0
      this.rafId = requestAnimationFrame(this.frame)
    }
  }

  start() {
    this.ensureRunning()
  }

  stop() {
    this.running = false
    if (this.rafId != null) cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  private frame = (ts: number) => {
    if (!this.running) return
    const dt = this.lastTs ? Math.min(64, ts - this.lastTs) : 16
    this.lastTs = ts

    let active = false
    for (const p of this.particles.values()) {
      const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt / p.tau)
      const dx = p.tx - p.x
      const dy = p.ty - p.y
      const da = p.tAlpha - p.alpha
      const dr = p.tr - p.r
      p.x += dx * k
      p.y += dy * k
      p.alpha += da * k
      p.r += dr * k
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3 || Math.abs(da) > 0.01 || Math.abs(dr) > 0.05) {
        active = true
      }
    }

    if (this.emphasisId) {
      this.pulse += dt / 1000
      active = true
    }

    this.render()
    this.onFrame?.()

    if (active || this.emphasisId) {
      this.rafId = requestAnimationFrame(this.frame)
    } else {
      this.running = false
      this.rafId = null
    }
  }

  private render() {
    const { ctx, width, height } = this
    ctx.clearRect(0, 0, width, height)

    // Ordinary particles.
    for (const p of this.ordered) {
      if (p.alpha < 0.02) continue
      if (p.ev.id === this.emphasisId) continue
      const [r, g, b] = p.colorRgb
      ctx.beginPath()
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.72 * p.alpha).toFixed(3)})`
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Emphasised (hovered / selected) particle, drawn on top.
    const em = this.emphasisId ? this.particles.get(this.emphasisId) : null
    if (em && em.alpha > 0.02) {
      this.drawEmphasis(em)
    }
  }

  private drawEmphasis(p: Particle) {
    const { ctx } = this
    const [r, g, b] = p.colorRgb
    const pulseR = 1 + Math.sin(this.pulse * 3) * 0.06
    const R = Math.max(9, p.tr * 3.2) * pulseR

    // Soft halo.
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 2.4)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.28)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(p.x, p.y, R * 2.4, 0, Math.PI * 2)
    ctx.fill()

    // Core: image (clipped) if available, else colour fill.
    ctx.save()
    ctx.beginPath()
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    ctx.closePath()
    if (this.emphasisImage && this.emphasisImage.complete && this.emphasisImage.naturalWidth > 0) {
      ctx.clip()
      const img = this.emphasisImage
      const scale = Math.max((R * 2) / img.naturalWidth, (R * 2) / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    } else {
      ctx.fillStyle = `rgba(${r},${g},${b},${HALO_ALPHA})`
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    }

    // Ring.
    ctx.lineWidth = 2
    ctx.strokeStyle = `rgba(255,255,255,0.92)`
    ctx.stroke()
  }

  /** Rank visible particles near the cursor and return the best candidate. */
  pick(px: number, py: number, radius = 26): PickResult | null {
    let best: PickResult | null = null
    let bestScore = -Infinity
    const r2 = radius * radius
    for (const p of this.particles.values()) {
      if (!p.visible || p.alpha < 0.4) continue
      const dx = p.x - px
      const dy = p.y - py
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const dist = Math.sqrt(d2)
      const proximity = 1 - dist / radius
      const score = selectionScore(p.ev, proximity)
      if (score > bestScore) {
        bestScore = score
        best = { id: p.ev.id, x: p.x, y: p.y, dist }
      }
    }
    return best
  }

  screenPosOf(id: string): { x: number; y: number } | null {
    const p = this.particles.get(id)
    if (!p) return null
    return { x: p.x, y: p.y }
  }

  isVisible(id: string): boolean {
    return this.particles.get(id)?.visible ?? false
  }

  destroy() {
    this.stop()
  }
}

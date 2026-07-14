import type { HistEvent } from './types'

/**
 * The "blow by blow" of a single event, built from the COMPLETE text of its
 * Wikipedia article. The article is split into chronological parts: every
 * paragraph that mentions a date starts a new part anchored at that date;
 * date-less paragraphs stay attached to the part they follow. Nothing is
 * truncated — each part carries its full paragraphs.
 */
export interface StoryPart {
  /** Section heading this part falls under. */
  title: string
  /** Human label of the anchoring date mention ("14 October 1066"). */
  dateLabel: string | null
  /** Decimal year used to position the part on the timeline. */
  date: number
  /** Complete paragraphs, in article order. */
  paragraphs: string[]
  image?: string
}

const SKIP_SECTIONS =
  /^(references|external links|see also|notes?|bibliography|sources|further reading|citations|footnotes|gallery|works cited|explanatory notes|primary sources|secondary sources)$/i

const API = 'https://en.wikipedia.org/w/api.php'
const cache = new Map<string, StoryPart[]>()
const inflight = new Map<string, Promise<StoryPart[]>>()

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const MONTH_RE = 'January|February|March|April|May|June|July|August|September|October|November|December'
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function toDecimal(year: number, month?: number, day?: number): number {
  let frac = 0
  if (month && month >= 1 && month <= 12) frac = (CUM_DAYS[month - 1] + ((day ?? 15) - 1)) / 365.25
  return year + frac
}

interface DateMention {
  date: number
  label: string
}

/**
 * Find the first plausible date mention in a paragraph. Bare years must fall
 * within a window around the event so casualty figures, distances and page
 * numbers don't read as dates.
 */
export function extractDate(text: string, aroundYear: number): DateMention | null {
  const windowOk = (y: number) => Math.abs(y - aroundYear) <= 600

  // "14 October 1066" (optionally BC/BCE)
  let m = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})\\s+(\\d{1,4})\\b(\\s*(?:BC|BCE))?`).exec(text)
  if (m) {
    const y = m[4] ? -Number(m[3]) : Number(m[3])
    if (windowOk(y)) {
      return { date: toDecimal(y, MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])), label: m[0].trim() }
    }
  }
  // "October 14, 1066"
  m = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2}),?\\s+(\\d{1,4})\\b(\\s*(?:BC|BCE))?`).exec(text)
  if (m) {
    const y = m[4] ? -Number(m[3]) : Number(m[3])
    if (windowOk(y)) {
      return { date: toDecimal(y, MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2])), label: m[0].trim() }
    }
  }
  // "October 1066"
  m = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{3,4})\\b(\\s*(?:BC|BCE))?`).exec(text)
  if (m) {
    const y = m[3] ? -Number(m[2]) : Number(m[2])
    if (windowOk(y)) return { date: toDecimal(y, MONTHS.indexOf(m[1].toLowerCase()) + 1), label: m[0].trim() }
  }
  // "44 BC"
  m = /\b(\d{1,4})\s*(BC|BCE)\b/.exec(text)
  if (m) {
    const y = -Number(m[1])
    if (windowOk(y)) return { date: toDecimal(y), label: m[0].trim() }
  }
  // "AD 79"
  m = /\bAD\s+(\d{1,4})\b/.exec(text)
  if (m) {
    const y = Number(m[1])
    if (windowOk(y)) return { date: toDecimal(y), label: m[0].trim() }
  }
  // Bare year "in 1066" — needs a dating preposition, otherwise ship counts
  // and army sizes ("776 ships", "14,000 men") read as years.
  const bare = /\b(?:in|by|from|until|around|circa|early|late|before|after|since|between|of)\s+(\d{3,4})\b(?![\d,.%])/gi
  let bm: RegExpExecArray | null
  while ((bm = bare.exec(text)) !== null) {
    const y = Number(bm[1])
    if (y >= 100 && windowOk(y)) return { date: toDecimal(y), label: bm[1] }
  }
  return null
}

function cleanText(s: string): string {
  return s
    .replace(/\[\d+\]|\[[a-z]\]|\[edit\]|\[citation needed\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetch and segment the whole article. One request for the full parse; the
 * HTML is walked with DOMParser so headings, paragraphs and images keep their
 * order. Cached; resolves to [] offline.
 */
export async function fetchStory(ev: HistEvent): Promise<StoryPart[]> {
  const title = ev.wikiTitle?.split('#')[0]
  if (!title) return []
  const hit = cache.get(title)
  if (hit) return hit
  const running = inflight.get(title)
  if (running) return running

  const promise = (async () => {
    try {
      const res = await fetch(
        `${API}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&origin=*&redirects=1`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { parse?: { text?: string } }
      const doc = new DOMParser().parseFromString(data.parse?.text ?? '', 'text/html')
      const rootEl = doc.querySelector('.mw-parser-output') ?? doc.body

      const parts: StoryPart[] = []
      let current: StoryPart | null = null
      let heading = 'Overview'
      let skipping = false

      const pushPart = (date: DateMention | null, text: string): StoryPart => {
        const part: StoryPart = {
          title: heading,
          dateLabel: date?.label ?? null,
          date: date?.date ?? Number.NaN,
          paragraphs: [text],
        }
        parts.push(part)
        return part
      }

      for (const el of Array.from(rootEl.children)) {
        const tag = el.tagName
        // Modern parser output wraps headings: <div class="mw-heading"><h2>…
        const hEl =
          tag === 'H2' || tag === 'H3'
            ? el
            : el.classList?.contains('mw-heading')
              ? el.querySelector('h2, h3')
              : null
        if (hEl) {
          const h = cleanText(hEl.textContent ?? '')
          if (hEl.tagName === 'H2') skipping = SKIP_SECTIONS.test(h)
          if (!skipping && h) {
            heading = h
            current = null // a new section always starts a new part
          }
          continue
        }
        if (skipping) continue
        if (tag === 'P') {
          const text = cleanText(el.textContent ?? '')
          if (text.length < 40) continue
          const date = extractDate(text, ev.year)
          if (date !== null || current === null) current = pushPart(date, text)
          else current.paragraphs.push(text)
          continue
        }
        // Attach the first image we meet to the currently open part.
        const img = el.querySelector?.('img[src*="upload.wikimedia.org"]')
        if (img && current && !current.image) {
          let src = img.getAttribute('src') ?? ''
          if (src.startsWith('//')) src = `https:${src}`
          if (src.includes('/thumb/')) current.image = src
        }
      }

      // Date-less parts inherit a position just after the previous dated part
      // (or just before the next one, for a date-less opening).
      const firstDated = parts.find((p) => !Number.isNaN(p.date))
      let prev = firstDated ? firstDated.date - 0.002 : ev.year
      for (const p of parts) {
        if (Number.isNaN(p.date)) p.date = prev + 0.001
        prev = p.date
      }
      // Chronological order; stable, so equal dates keep article order.
      const ordered = parts
        .map((p, i) => ({ p, i }))
        .sort((a, b) => a.p.date - b.p.date || a.i - b.i)
        .map(({ p }) => p)

      if (ordered.length > 0) cache.set(title, ordered)
      return ordered
    } catch {
      return []
    } finally {
      inflight.delete(title)
    }
  })()

  inflight.set(title, promise)
  return promise
}

import type { HistEvent } from './types'

/**
 * The "blow by blow" of a single event, built from its Wikipedia article:
 * each top-level section becomes a story beat with its heading, the first
 * paragraphs of prose, and the section's first image when it has one.
 */
export interface StorySection {
  index: string
  title: string
  anchor: string
  text: string
  image?: string
}

const SKIP_SECTIONS =
  /^(references|external links|see also|notes?|bibliography|sources|further reading|citations|footnotes|gallery|works cited|explanatory notes|primary sources|secondary sources)$/i

const API = 'https://en.wikipedia.org/w/api.php'
const cache = new Map<string, StorySection[]>()
const inflight = new Map<string, Promise<StorySection[]>>()

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
}

/** Pull readable prose + the first content image out of a section's HTML. */
function extractContent(html: string): { text: string; image?: string } {
  const im = /<img[^>]+src="([^"]+upload\.wikimedia\.org[^"]+)"[^>]*>/.exec(html)
  let image = im?.[1]
  if (image?.startsWith('//')) image = `https:${image}`
  // Skip tiny icons/formulae — thumbnails carry a /thumb/ path segment.
  if (image && !image.includes('/thumb/')) image = undefined

  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) =>
      decodeEntities(stripHtml(m[1]))
        .replace(/\[\d+\]|\[[a-z]\]/g, '') // citation markers
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((t) => t.length > 60)
  let text = paras.slice(0, 2).join('  ')
  if (text.length > 460) {
    const cut = text.slice(0, 460)
    text = `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 380))}…`
  }
  return { text, image }
}

/**
 * Fetch the story of an event: one beat per usable top-level article section,
 * in narrative (chronological) order. Cached; resolves to [] offline.
 */
export async function fetchStory(ev: HistEvent): Promise<StorySection[]> {
  const title = ev.wikiTitle?.split('#')[0]
  if (!title) return []
  const hit = cache.get(title)
  if (hit) return hit
  const running = inflight.get(title)
  if (running) return running

  const promise = (async () => {
    try {
      const secRes = await fetch(
        `${API}?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&formatversion=2&origin=*&redirects=1`,
        { headers: { Accept: 'application/json' } },
      )
      if (!secRes.ok) throw new Error(`status ${secRes.status}`)
      const secData = (await secRes.json()) as {
        parse?: { sections?: { toclevel?: number; line?: string; anchor?: string; index?: string }[] }
      }
      const sections = (secData.parse?.sections ?? [])
        .filter((s) => s.toclevel === 1 && s.index)
        .map((s) => ({ ...s, clean: decodeEntities(stripHtml(s.line ?? '')) }))
        .filter((s) => s.clean.length > 0 && !SKIP_SECTIONS.test(s.clean))
        .slice(0, 10)

      const beats = await Promise.all(
        sections.map(async (s) => {
          try {
            const res = await fetch(
              `${API}?action=parse&page=${encodeURIComponent(title)}&prop=text&section=${s.index}&format=json&formatversion=2&origin=*&redirects=1`,
              { headers: { Accept: 'application/json' } },
            )
            if (!res.ok) return null
            const data = (await res.json()) as { parse?: { text?: string } }
            const { text, image } = extractContent(data.parse?.text ?? '')
            if (!text) return null
            const beat: StorySection = { index: s.index!, title: s.clean, anchor: s.anchor ?? '', text }
            if (image) beat.image = image
            return beat
          } catch {
            return null
          }
        }),
      )
      const story = beats.filter((b): b is StorySection => b !== null)
      if (story.length > 0) cache.set(title, story)
      return story
    } catch {
      return []
    } finally {
      inflight.delete(title)
    }
  })()

  inflight.set(title, promise)
  return promise
}

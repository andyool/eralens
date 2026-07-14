import type { HistEvent, EventTier, CategoryId } from './types'

/**
 * A node in the containment forest. Every event is a node; a node with children
 * is a "container" (a war, an era, a time bucket) that can be drilled into.
 */
export interface HNode {
  ev: HistEvent
  parent: HNode | null
  children: HNode[]
  depth: number
  /** Total descendants at every level (used for sizing + "contains N"). */
  descendantCount: number
  /** Oldest / newest decimal-year across this node's whole subtree. */
  spanStart: number
  spanEnd: number
  /** Union of categories across the subtree — lets filters see into containers. */
  subtreeCats: Set<CategoryId>
}

export interface Forest {
  map: Map<string, HNode>
  roots: HNode[]
}

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/**
 * A fractional year that folds in month, day and (for battle-scale moments) a
 * sub-day fraction, so children spread along the time axis when you zoom in far
 * enough — keeping the invariant that horizontal position always means date.
 */
export function decimalYear(ev: HistEvent): number {
  let frac = 0
  if (ev.month && ev.month >= 1 && ev.month <= 12) {
    const doy = CUM_DAYS[ev.month - 1] + ((ev.day ?? 1) - 1)
    frac += doy / 365.25
  }
  if (ev.dayFraction != null) frac += ev.dayFraction / 365.25
  return ev.year + frac
}

export function tierOf(node: HNode): EventTier {
  if (node.ev.tier) return node.ev.tier
  if (node.children.length > 0) return node.depth === 0 ? 'era' : 'period'
  return node.parent ? 'moment' : 'event'
}

export function isTimeBucket(node: HNode): boolean {
  return node.ev.id.startsWith('t:')
}

// ── Time-bucket auto-clustering ──────────────────────────────────────────
// Events older than this stay at the top level (deep time is sparse + iconic).
const RECORDED_MIN = -10000

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
function millLabel(m: number): string {
  return m >= 0 ? `${ordinal(m / 1000 + 1)} millennium` : `${ordinal(-m / 1000)} millennium BCE`
}
function centLabel(c: number): string {
  return c >= 0 ? `${ordinal(c / 100 + 1)} century` : `${ordinal(-c / 100)} century BCE`
}

interface BucketSpec {
  level: 'mill' | 'cent' | 'dec'
  key: number
  start: number
  end: number
  title: string
}

function bucketChain(year: number): BucketSpec[] {
  if (year < RECORDED_MIN) return []
  const mk = Math.floor(year / 1000) * 1000
  const ck = Math.floor(year / 100) * 100
  const chain: BucketSpec[] = [
    { level: 'mill', key: mk, start: mk, end: mk + 999, title: millLabel(mk) },
    { level: 'cent', key: ck, start: ck, end: ck + 99, title: centLabel(ck) },
  ]
  if (year >= 1000) {
    const dk = Math.floor(year / 10) * 10
    chain.push({ level: 'dec', key: dk, start: dk, end: dk + 9, title: `${dk}s` })
  }
  return chain
}

function makeNode(ev: HistEvent): HNode {
  return {
    ev,
    parent: null,
    children: [],
    depth: 0,
    descendantCount: 0,
    spanStart: decimalYear(ev),
    spanEnd: decimalYear(ev),
    subtreeCats: new Set(),
  }
}

/** Build the containment forest, optionally auto-clustering into time buckets. */
export function buildForest(events: HistEvent[], opts?: { cluster?: boolean }): Forest {
  const map = new Map<string, HNode>()
  for (const ev of events) map.set(ev.id, makeNode(ev))

  let roots: HNode[] = []
  for (const node of map.values()) {
    const pid = node.ev.parentId
    const parent = pid ? map.get(pid) : undefined
    if (parent && parent !== node) {
      node.parent = parent
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  if (opts?.cluster) {
    const buckets = new Map<string, HNode>()
    const getBucket = (spec: BucketSpec): HNode => {
      const id = `t:${spec.level}:${spec.key}`
      let n = buckets.get(id)
      if (!n) {
        n = makeNode({
          id,
          title: spec.title,
          year: spec.start,
          endYear: spec.end,
          precision: spec.level === 'dec' ? 'decade' : 'century',
          type: 'event',
          tier: spec.level === 'mill' ? 'era' : 'period',
          categories: [],
          significance: 55,
          description: `Events from the ${spec.title}.`,
        })
        buckets.set(id, n)
        map.set(id, n)
      }
      return n
    }

    const newRoots: HNode[] = []
    for (const root of roots) {
      const chain = bucketChain(root.ev.year)
      if (chain.length === 0) {
        newRoots.push(root)
        continue
      }
      let parentNode: HNode | null = null
      for (const spec of chain) {
        const b = getBucket(spec)
        if (parentNode && b.parent !== parentNode) {
          b.parent = parentNode
          parentNode.children.push(b)
        }
        parentNode = b
      }
      root.parent = parentNode
      parentNode!.children.push(root)
    }
    for (const b of buckets.values()) if (!b.parent) newRoots.push(b)
    roots = collapseSingletonBuckets(newRoots)
  }

  // Depth (top-down) + order children by time.
  const setDepth = (node: HNode, d: number) => {
    node.depth = d
    node.children.sort(
      (a, b) => decimalYear(a.ev) - decimalYear(b.ev) || (a.ev.sequence ?? 0) - (b.ev.sequence ?? 0),
    )
    for (const c of node.children) setDepth(c, d + 1)
  }
  for (const r of roots) setDepth(r, 0)

  // Spans + counts + subtree categories (bottom-up).
  const compute = (node: HNode): void => {
    const cats = new Set<CategoryId>(node.ev.categories)
    let count = 0
    for (const c of node.children) {
      compute(c)
      node.spanStart = Math.min(node.spanStart, c.spanStart)
      node.spanEnd = Math.max(node.spanEnd, c.spanEnd)
      count += c.descendantCount + 1
      for (const cat of c.subtreeCats) cats.add(cat)
    }
    node.subtreeCats = cats
    node.descendantCount = count
  }
  for (const r of roots) compute(r)

  roots.sort((a, b) => a.spanStart - b.spanStart)
  return { map, roots }
}

/** Collapse time-bucket containers that hold only a single child (keeps the tree tidy). */
function collapseSingletonBuckets(roots: HNode[]): HNode[] {
  const collapse = (node: HNode) => {
    let changed = true
    while (changed) {
      changed = false
      const next: HNode[] = []
      for (const c of node.children) {
        if (c.ev.id.startsWith('t:') && c.children.length === 1) {
          const g = c.children[0]
          g.parent = node
          next.push(g)
          changed = true
        } else {
          next.push(c)
        }
      }
      node.children = next
    }
    for (const c of node.children) collapse(c)
  }
  let changedR = true
  while (changedR) {
    changedR = false
    const nr: HNode[] = []
    for (const r of roots) {
      if (r.ev.id.startsWith('t:') && r.children.length === 1) {
        const g = r.children[0]
        g.parent = null
        nr.push(g)
        changedR = true
      } else {
        nr.push(r)
      }
    }
    roots = nr
  }
  for (const r of roots) collapse(r)
  return roots
}

export function ancestorsOf(node: HNode): HNode[] {
  const out: HNode[] = []
  let p = node.parent
  while (p) {
    out.unshift(p)
    p = p.parent
  }
  return out
}

export interface LodCallbacks {
  intersects: (node: HNode) => boolean
  expandable: (node: HNode) => boolean
}

/**
 * Level-of-detail selection. Walks the forest top-down: a container whose span
 * is wide enough on screen is "opened" into its children; otherwise it is
 * rendered as a single aggregate dot. This is the semantic zoom that makes the
 * cloud step down from centuries → wars → battles → moments as you zoom in.
 */
export function selectVisibleNodes(roots: HNode[], cb: LodCallbacks): HNode[] {
  const out: HNode[] = []
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    if (!cb.intersects(node)) continue
    if (node.children.length > 0 && cb.expandable(node)) {
      for (const c of node.children) stack.push(c)
    } else {
      out.push(node)
    }
  }
  return out
}

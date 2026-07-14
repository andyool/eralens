import type { HistEvent, EventTier } from './types'

/**
 * A node in the containment forest. Every event is a node; a node with children
 * is a "container" (a war, an era, a program) that can be drilled into.
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

/** Build the containment forest and precompute spans + descendant counts. */
export function buildForest(events: HistEvent[]): Forest {
  const map = new Map<string, HNode>()
  for (const ev of events) {
    map.set(ev.id, {
      ev,
      parent: null,
      children: [],
      depth: 0,
      descendantCount: 0,
      spanStart: decimalYear(ev),
      spanEnd: decimalYear(ev),
    })
  }

  const roots: HNode[] = []
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

  // Depth (top-down) + order children by time.
  const setDepth = (node: HNode, d: number) => {
    node.depth = d
    node.children.sort((a, b) => decimalYear(a.ev) - decimalYear(b.ev) || (a.ev.sequence ?? 0) - (b.ev.sequence ?? 0))
    for (const c of node.children) setDepth(c, d + 1)
  }
  for (const r of roots) setDepth(r, 0)

  // Spans + counts (bottom-up).
  const compute = (node: HNode): void => {
    let count = 0
    for (const c of node.children) {
      compute(c)
      node.spanStart = Math.min(node.spanStart, c.spanStart)
      node.spanEnd = Math.max(node.spanEnd, c.spanEnd)
      count += c.descendantCount + 1
    }
    node.descendantCount = count
  }
  for (const r of roots) compute(r)

  roots.sort((a, b) => a.spanStart - b.spanStart)
  return { map, roots }
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
  /** Does this node's subtree intersect the current view at all? */
  intersects: (node: HNode) => boolean
  /** Should this container be opened (show children) rather than shown as one dot? */
  expandable: (node: HNode) => boolean
}

/**
 * Level-of-detail selection. Walks the forest top-down: a container whose span
 * is wide enough on screen is "opened" into its children; otherwise it is
 * rendered as a single aggregate dot. This is the semantic zoom that makes the
 * cloud step down from wars → battles → moments as you zoom in.
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

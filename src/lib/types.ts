// Core domain types for EraLens.

/** How precisely an event's date is known. Drives how dates are rendered. */
export type DatePrecision =
  | 'day'
  | 'month'
  | 'year'
  | 'decade'
  | 'century'
  | 'circa'
  | 'era'
  | 'geological'

/**
 * The kind of thing a point represents. Histography treated everything as an
 * "event"; we keep the richer distinction so filters and cards can be smarter.
 */
export type EventType =
  | 'event'
  | 'birth'
  | 'death'
  | 'invention'
  | 'discovery'
  | 'work'
  | 'battle'
  | 'wars'
  | 'treaty'
  | 'disaster'
  | 'founding'
  | 'construction'
  | 'exploration'
  | 'moment'

export type CategoryId =
  | 'cosmos'
  | 'life'
  | 'politics'
  | 'wars'
  | 'science'
  | 'technology'
  | 'art'
  | 'literature'
  | 'music'
  | 'religion'
  | 'exploration'
  | 'construction'
  | 'disasters'
  | 'rights'
  | 'economics'
  | 'sports'

/** An explicit, labelled relationship between two events. */
export interface EventRelation {
  /** Target event id. */
  id: string
  kind: 'led_to' | 'caused_by' | 'same_movement'
}

/**
 * Depth of a node in the containment hierarchy. A war contains battles contains
 * moments; an era contains periods. Tiers are a hint for styling/aggregation —
 * the actual tree is defined by `parentId`.
 */
export type EventTier = 'era' | 'period' | 'event' | 'moment'

export interface HistEvent {
  id: string
  title: string
  /**
   * Astronomical year number of the (start of the) event. May be a very large
   * negative number for deep time (e.g. the Big Bang is ~ -1.38e10). Fractional
   * years are allowed but month/day carry sub-year precision instead.
   */
  year: number
  /** Optional 1-12 when precision is 'month' or finer. */
  month?: number
  /** Optional 1-31 when precision is 'day'. */
  day?: number
  /** Optional end year for events with real duration (empires, ages). */
  endYear?: number
  precision: DatePrecision
  type: EventType
  categories: CategoryId[]
  /** 0-100 editorial/heuristic importance. Higher floats to the top. */
  significance: number
  /** 0-1 how much source material backs the record (a Stage-2 signal, seeded here). */
  confidence?: number
  description: string
  people?: string[]
  location?: string
  /** [lon, lat] — reserved for the Stage-2 map view. */
  coordinates?: [number, number]
  /** English Wikipedia article title, used for links + lazy enrichment. */
  wikiTitle?: string
  /** Wikidata Q-id when known, for a structured-source link. */
  wikidataId?: string
  /** Explicit curated relationships (causal / movement). */
  relations?: EventRelation[]
  /** Bitmask over the loaded civilization definitions (see data/events.ts). */
  civMask?: number
  /** Bitmask over the loaded region definitions. */
  regionMask?: number

  // ── Containment hierarchy (moments ⊂ events ⊂ periods ⊂ eras) ──────────
  /** Id of the containing event/period/war. Absent = a top-level node. */
  parentId?: string
  /** Optional tier hint. Inferred from depth when absent. */
  tier?: EventTier
  /** Order within the parent — used to spread sub-moments that lack a precise time. */
  sequence?: number
  /**
   * Position within the day (0..1) for sub-day moments (e.g. phases of a
   * battle), so they spread along the axis when zoomed to a single day.
   */
  dayFraction?: number
  /**
   * True for generated placeholder sub-moments that exist only to demonstrate
   * density and drill-down. These never assert specific historical facts and
   * are always visually badged as illustrative.
   */
  illustrative?: boolean
}

export interface Category {
  id: CategoryId
  label: string
  /** Emoji glyph used as a lightweight icon. */
  icon: string
  color: string
  blurb: string
}

export interface Era {
  id: string
  name: string
  startYear: number
  endYear: number
  description: string
  color: string
  /** Optional id of a hero event to feature. */
  heroEventId?: string
  /** Grouping for the era rail. */
  group: 'cosmic' | 'prehistory' | 'ancient' | 'medieval' | 'modern' | 'cultural'
}

/** The currently selected time window shown in the main visualisation. */
export interface TimeView {
  startYear: number
  endYear: number
}

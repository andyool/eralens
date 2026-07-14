import type { HistEvent } from '../lib/types'

/**
 * A small gazetteer mapping the place names used in the dataset to approximate
 * [lon, lat]. Lets the map plot events that have a `location` but no explicit
 * coordinates, with no network lookup. Keys are lower-cased; resolution also
 * tries the country after the last comma.
 */
export const GAZETTEER: Record<string, [number, number]> = {
  france: [2.3, 46.6],
  paris: [2.35, 48.85],
  versailles: [2.13, 48.8],
  'agincourt, france': [2.14, 50.46],
  'crécy, france': [1.9, 50.25],
  'poitiers, france': [0.34, 46.58],
  'orléans, france': [1.9, 47.9],
  'normandy, france': [-0.37, 49.18],
  'verdun, france': [5.38, 49.16],
  'somme, france': [2.3, 49.98],
  england: [-1.5, 52.3],
  britain: [-2.0, 54.0],
  'united kingdom': [-2.0, 54.0],
  london: [-0.13, 51.5],
  belgium: [4.47, 50.5],
  italy: [12.5, 42.8],
  rome: [12.5, 41.9],
  pompeii: [14.49, 40.75],
  greece: [22.0, 39.0],
  athens: [23.73, 37.98],
  'olympia, greece': [21.63, 37.64],
  germany: [10.4, 51.2],
  berlin: [13.4, 52.52],
  wittenberg: [12.65, 51.87],
  mainz: [8.27, 50.0],
  spain: [-3.7, 40.4],
  turkey: [35.0, 39.0],
  constantinople: [28.98, 41.01],
  gallipoli: [26.4, 40.4],
  egypt: [30.8, 26.8],
  'giza, egypt': [31.13, 29.98],
  alexandria: [29.92, 31.2],
  carthage: [10.32, 36.85],
  'south africa': [24.0, -29.0],
  judea: [35.2, 31.8],
  medina: [39.6, 24.47],
  baghdad: [44.36, 33.31],
  babylon: [44.42, 32.54],
  sumer: [46.0, 31.0],
  iraq: [43.7, 33.2],
  jericho: [35.45, 31.87],
  india: [78.9, 22.0],
  'agra, india': [78.04, 27.17],
  'indus valley': [68.5, 27.0],
  china: [104.2, 35.9],
  japan: [138.0, 36.2],
  hawaii: [-157.9, 21.3],
  cambodia: [104.9, 12.6],
  russia: [90.0, 61.0],
  ussr: [50.0, 55.0],
  ukraine: [31.2, 49.0],
  stalingrad: [44.5, 48.7],
  'united states': [-98.0, 39.5],
  'washington, d.c.': [-77.04, 38.9],
  philadelphia: [-75.16, 39.95],
  'new york': [-74.0, 40.7],
  massachusetts: [-71.8, 42.3],
  boston: [-71.06, 42.36],
  virginia: [-78.6, 37.5],
  'north carolina': [-79.0, 35.5],
  mexico: [-102.5, 23.6],
  haiti: [-72.3, 18.9],
  newfoundland: [-56.0, 49.0],
  cern: [6.05, 46.23],
  'the moon': [0, 0], // filtered out on the map
}

function key(s: string): string {
  return s.trim().toLowerCase()
}

/** Resolve an event to [lon, lat], or null if we can't place it. */
export function resolveCoords(ev: HistEvent): [number, number] | null {
  if (ev.coordinates) return ev.coordinates
  if (!ev.location) return null
  if (ev.location.toLowerCase() === 'the moon') return null
  const loc = key(ev.location)
  if (GAZETTEER[loc]) return GAZETTEER[loc]
  // Fall back to the part after the last comma (usually the country).
  const comma = ev.location.lastIndexOf(',')
  if (comma >= 0) {
    const tail = key(ev.location.slice(comma + 1))
    if (GAZETTEER[tail]) return GAZETTEER[tail]
  }
  return null
}

/** Equirectangular projection: [lon,lat] → pixel {x,y} within a w×h rect. */
export function project(lon: number, lat: number, w: number, h: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h }
}

/**
 * Very simplified continent outlines (lon/lat vertex rings) for a stylised world
 * silhouette. Deliberately low-detail — drawn faintly as geographic context
 * behind the real, precisely-placed event points.
 */
export const CONTINENTS: [number, number][][] = [
  // North America
  [
    [-168, 65], [-160, 71], [-140, 70], [-125, 70], [-100, 72], [-80, 73], [-64, 60], [-56, 52],
    [-66, 45], [-70, 42], [-75, 35], [-81, 25], [-97, 26], [-97, 18], [-105, 20], [-112, 24],
    [-117, 32], [-124, 40], [-124, 48], [-135, 57], [-150, 59], [-168, 65],
  ],
  // South America
  [
    [-81, 7], [-77, 1], [-80, -5], [-75, -14], [-71, -18], [-70, -30], [-73, -40], [-75, -48],
    [-68, -52], [-65, -55], [-58, -51], [-57, -38], [-48, -25], [-40, -22], [-35, -8], [-45, -2],
    [-51, 0], [-60, 5], [-70, 11], [-77, 8], [-81, 7],
  ],
  // Africa
  [
    [-17, 15], [-16, 22], [-5, 32], [10, 37], [20, 32], [32, 31], [43, 12], [51, 12], [42, -2],
    [40, -15], [35, -24], [27, -34], [18, -35], [12, -17], [9, -1], [8, 4], [-8, 5], [-17, 15],
  ],
  // Europe
  [
    [-10, 36], [-9, 44], [-2, 49], [2, 51], [-4, 58], [7, 63], [12, 66], [26, 71], [40, 66],
    [38, 55], [30, 46], [28, 41], [20, 40], [13, 45], [12, 38], [3, 43], [-2, 36], [-10, 36],
  ],
  // Asia
  [
    [26, 41], [40, 48], [55, 52], [68, 55], [82, 56], [98, 52], [112, 52], [130, 55], [143, 52],
    [142, 45], [130, 42], [128, 35], [122, 30], [121, 22], [108, 18], [103, 1], [95, 6], [90, 22],
    [80, 8], [73, 20], [64, 25], [52, 27], [40, 34], [30, 38], [26, 41],
  ],
  // Australia
  [
    [113, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -18], [150, -25], [153, -28],
    [150, -37], [143, -39], [135, -35], [129, -32], [115, -34], [114, -28], [113, -22],
  ],
]

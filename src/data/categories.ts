import type { Category, CategoryId } from '../lib/types'

/**
 * Subject categories. Colours are chosen to stay distinct against a dark field
 * and to remain distinguishable for the most common forms of colour-blindness
 * (no red/green-only pairings carry meaning on their own — the icon + label do).
 */
export const CATEGORIES: Category[] = [
  { id: 'cosmos', label: 'Cosmos & Earth', icon: '🌌', color: '#8b9dff', blurb: 'The universe, the Solar System and the shaping of the planet.' },
  { id: 'life', label: 'Life & Evolution', icon: '🧬', color: '#4fd1a5', blurb: 'The origin and evolution of living things.' },
  { id: 'politics', label: 'Politics & States', icon: '🏛️', color: '#f4a259', blurb: 'Empires, revolutions, treaties and the machinery of power.' },
  { id: 'wars', label: 'Wars & Conflict', icon: '⚔️', color: '#f76c6c', blurb: 'Battles, campaigns and the wars that redrew the map.' },
  { id: 'science', label: 'Science', icon: '🔬', color: '#5bc8ff', blurb: 'Theories, discoveries and the growth of knowledge.' },
  { id: 'technology', label: 'Technology', icon: '⚙️', color: '#c9a0ff', blurb: 'Inventions and the tools that changed daily life.' },
  { id: 'art', label: 'Art', icon: '🎨', color: '#ff9ecb', blurb: 'Painting, sculpture and the visual imagination.' },
  { id: 'literature', label: 'Literature', icon: '📖', color: '#ffd166', blurb: 'Books, ideas and the written word.' },
  { id: 'music', label: 'Music', icon: '🎵', color: '#a0e7a0', blurb: 'Composition, performance and sound.' },
  { id: 'religion', label: 'Religion', icon: '🕊️', color: '#e6d2b5', blurb: 'Faiths, texts and spiritual movements.' },
  { id: 'exploration', label: 'Exploration', icon: '🧭', color: '#6fe0d6', blurb: 'Voyages, discovery of places and the reach outward.' },
  { id: 'construction', label: 'Construction', icon: '🏗️', color: '#d0b48a', blurb: 'Monuments, cities and great works of building.' },
  { id: 'disasters', label: 'Disasters', icon: '🌊', color: '#ff7b54', blurb: 'Plagues, quakes, famines and catastrophe.' },
  { id: 'rights', label: 'Rights & Society', icon: '✊', color: '#ffb3c1', blurb: 'Movements for freedom, suffrage and justice.' },
  { id: 'economics', label: 'Economy & Trade', icon: '💱', color: '#9bd76b', blurb: 'Money, markets, trade routes and industry.' },
]

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>

export function categoryColor(id: CategoryId): string {
  return CATEGORY_MAP[id]?.color ?? '#9aa4b2'
}

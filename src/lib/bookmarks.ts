import { useSyncExternalStore } from 'react'

/**
 * Saved events ("My collection"). A tiny localStorage-backed store — ids only,
 * newest first — with a subscription so any component stays in sync, including
 * across tabs via the `storage` event.
 */

const KEY = 'eralens:saved:v1'

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) return data.filter((x): x is string => typeof x === 'string')
  } catch {
    /* corrupted or unavailable storage — start empty */
  }
  return []
}

let ids: readonly string[] = typeof localStorage !== 'undefined' ? load() : []
const listeners = new Set<() => void>()

function commit(next: readonly string[]) {
  ids = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full or blocked — keep the in-memory state */
  }
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    ids = load()
    for (const fn of listeners) fn()
  })
}

export function getSaved(): readonly string[] {
  return ids
}

export function isSaved(id: string): boolean {
  return ids.includes(id)
}

/** Toggle an event in the collection. Returns true when it is now saved. */
export function toggleSaved(id: string): boolean {
  if (ids.includes(id)) {
    commit(ids.filter((x) => x !== id))
    return false
  }
  commit([id, ...ids])
  return true
}

export function removeSaved(id: string): void {
  if (ids.includes(id)) commit(ids.filter((x) => x !== id))
}

export function clearSaved(): void {
  if (ids.length > 0) commit([])
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reactive list of saved event ids, newest first. */
export function useSavedIds(): readonly string[] {
  return useSyncExternalStore(subscribe, getSaved)
}

import { useEffect, useRef, useState } from 'react'
import { LUCKY_MODES, type LuckyMode } from '../lib/discover'

interface Props {
  onPick: (mode: LuckyMode) => void
}

export default function Discover({ onPick }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className="discover" ref={ref} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Discover a random event"
      >
        <span className="glyph" aria-hidden>
          ✨
        </span>
        <span className="hide-sm">Feeling lucky</span>
      </button>
      {open && (
        <div className="lucky-menu" role="menu">
          {LUCKY_MODES.map((m) => (
            <button
              key={m.id}
              role="menuitem"
              className="lucky-item"
              onClick={() => {
                onPick(m.id)
                setOpen(false)
              }}
            >
              <span aria-hidden>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

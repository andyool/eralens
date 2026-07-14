import type { HNode } from '../lib/hierarchy'
import { ancestorsOf } from '../lib/hierarchy'
import { categoryColor } from '../data/categories'

interface Props {
  focus: HNode | null
  onHome: () => void
  onCrumb: (node: HNode) => void
}

/**
 * Shows where you are in the containment hierarchy — e.g.
 * Everything › Hundred Years' War › Battle of Agincourt — with each level
 * clickable to zoom back out to it.
 */
export default function Breadcrumb({ focus, onHome, onCrumb }: Props) {
  if (!focus) return null
  const chain = [...ancestorsOf(focus), focus]
  return (
    <nav className="breadcrumb" aria-label="Containment path">
      <button className="crumb" onClick={onHome}>
        ✦ Everything
      </button>
      {chain.map((node, i) => {
        const isCurrent = i === chain.length - 1
        return (
          <span key={node.ev.id} style={{ display: 'contents' }}>
            <span className="crumb-sep" aria-hidden>
              ›
            </span>
            <button
              className={`crumb ${isCurrent ? 'current' : ''}`}
              onClick={() => !isCurrent && onCrumb(node)}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <span
                className="c-swatch"
                style={{ background: categoryColor(node.ev.categories[0]) }}
                aria-hidden
              />
              {node.ev.title}
              {node.children.length > 0 && (
                <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                  · {node.descendantCount}
                </span>
              )}
            </button>
          </span>
        )
      })}
    </nav>
  )
}

import type { Era } from '../lib/types'
import { ERAS } from '../data/eras'

interface Props {
  activeEraId: string | null
  onSelect: (era: Era) => void
}

const GROUP_LABEL: Record<Era['group'], string> = {
  cosmic: 'Cosmic',
  prehistory: 'Prehistory',
  ancient: 'Antiquity',
  medieval: 'Historical eras',
  modern: 'Historical eras',
  cultural: 'Civilisations',
}

export default function EraRail({ activeEraId, onSelect }: Props) {
  let lastLabel = ''
  return (
    <nav className="era-rail" aria-label="Jump to a historical era">
      {ERAS.map((era) => {
        const label = GROUP_LABEL[era.group]
        const showLabel = label !== lastLabel
        lastLabel = label
        return (
          <span key={era.id} style={{ display: 'contents' }}>
            {showLabel && <span className="era-group-label">{label}</span>}
            <button
              className={`era-chip ${activeEraId === era.id ? 'active' : ''}`}
              style={{ ['--era-color' as string]: era.color }}
              onClick={() => onSelect(era)}
              title={era.description}
              aria-pressed={activeEraId === era.id}
            >
              <span className="e-swatch" aria-hidden />
              {era.name}
            </button>
          </span>
        )
      })}
    </nav>
  )
}

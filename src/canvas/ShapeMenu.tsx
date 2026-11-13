/**
 * Floating ink-selection menu. Absolute HTML overlay on top of the Konva stage;
 * not modal, it does not steal focus until the user presses an action.
 *
 * Single action: convert the selected strokes into a figure (promotion), using
 * the recognizer's suggestion when available or a manual pick from the library.
 */
import type { SelectionRect } from '@/ink/index.js'
import type { PromotionSuggestion } from '@/recognizer/suggest.js'
import type { Library } from '@/library/index.js'

interface ShapeMenuProps {
  /** Selection rectangle the menu position derives from. */
  rect: SelectionRect
  /** Recognizer suggestion for the selected strokes (top-1 first). null: no preselection. */
  suggestion: PromotionSuggestion | null
  /** Library, for the manual "other type" selector. */
  library: Library
  /** Called with the chosen type to convert the ink into a figure. */
  onPromote: (objectType: string) => void
  /** Called on the close button. */
  onClose: () => void
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const MENU_BG = '#ffffff'
const MENU_BORDER = '1px solid #d1d5db'
const MENU_SHADOW = '0 2px 8px rgba(0,0,0,0.15)'
const MENU_RADIUS = 8
const BTN_RADIUS = 4

function menuContainerStyle(x: number, y: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    zIndex: 10,
    background: MENU_BG,
    border: MENU_BORDER,
    borderRadius: MENU_RADIUS,
    boxShadow: MENU_SHADOW,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 160,
    maxWidth: 220,
    fontFamily: 'sans-serif',
    fontSize: 12,
    userSelect: 'none',
  }
}

/** Styles of the primary promotion button (top-1 candidate). */
const promotePrimaryBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: BTN_RADIUS,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** Styles of the alternative promotion buttons (candidates 2 and 3). */
const promoteAltBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  background: 'transparent',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: BTN_RADIUS,
  cursor: 'pointer',
  fontSize: 11,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** Styles of the "other type…" select in the promotion section. */
const promoteSelectStyle: React.CSSProperties = {
  padding: '3px 4px',
  border: '1px solid #d1d5db',
  borderRadius: BTN_RADIUS,
  fontSize: 11,
  background: 'white',
  color: '#374151',
  cursor: 'pointer',
  width: '100%',
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  padding: '1px 5px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#9ca3af',
  fontSize: 13,
  lineHeight: 1,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShapeMenu({ rect, suggestion, library, onPromote, onClose }: ShapeMenuProps) {
  // Position: bottom-right corner of the normalized rect + offset
  const normX = rect.width >= 0 ? rect.x + rect.width : rect.x
  const normY = rect.height >= 0 ? rect.y : rect.y + rect.height
  const menuX = normX + 8
  const menuY = normY

  // Library types (except "texto") for the manual selector
  const allTypes = Array.from(library.keys()).filter(name => name !== 'texto').sort()

  const handlePromoteSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val) onPromote(val)
  }

  // Suggestion candidates: top-1 and up to 2 alternatives
  const top1 = suggestion?.candidates[0] ?? null
  const alternatives = suggestion?.candidates.slice(1, 3) ?? []

  return (
    <div style={menuContainerStyle(menuX, menuY)}>
      <button
        style={closeBtnStyle}
        onClick={onClose}
        title="Close"
        aria-label="Close the ink selection menu"
      >
        ✕
      </button>

      <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 2, paddingRight: 16 }}>
        Convert to a figure
      </div>

      {top1 !== null ? (
        <>
          <button
            style={promotePrimaryBtnStyle}
            onClick={() => onPromote(top1.name)}
            title={`Convert as "${top1.name}" (confidence: ${Math.round(top1.score * 100)}%)`}
          >
            {top1.name}?
            <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 4, fontSize: 10 }}>
              {Math.round(top1.score * 100)}%
            </span>
          </button>

          {alternatives.map(candidate => (
            <button
              key={candidate.name}
              style={promoteAltBtnStyle}
              onClick={() => onPromote(candidate.name)}
              title={`Convert as "${candidate.name}" (confidence: ${Math.round(candidate.score * 100)}%)`}
            >
              {candidate.name}
              <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 10 }}>
                {Math.round(candidate.score * 100)}%
              </span>
            </button>
          ))}
        </>
      ) : null}

      {/* Always visible; the only control when there is no suggestion */}
      <select
        style={promoteSelectStyle}
        defaultValue=""
        onChange={handlePromoteSelectChange}
        title="Choose the object type to convert to"
        aria-label="Choose the object type to convert to"
      >
        <option value="" disabled>Other type…</option>
        {allTypes.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  )
}

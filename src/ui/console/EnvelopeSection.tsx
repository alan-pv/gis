/**
 * Console section: raw envelope JSON (paste, or load a lesson turn) with the lesson
 * picker, the formal/casual register toggle, Load turn / Run / Reset board.
 * Collapsed by default.
 */
import type { LoadedSeed } from '@/demo/lessons.js'

export interface EnvelopeSectionProps {
  seeds: LoadedSeed[]
  selectedSeedId: string
  selectedSeed: LoadedSeed | null
  seedStep: number
  register: 'formal' | 'coloquial'
  loadedCaseTags: string[]
  activeUtterance: string | null
  envelopeText: string
  parseError: string | null
  isRunning: boolean
  onSelectSeed: (id: string) => void
  onSetRegister: (r: 'formal' | 'coloquial') => void
  onLoadTurn: () => void
  onRun: () => void
  onResetBoard: () => void
  onTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

export function EnvelopeSection({
  seeds, selectedSeedId, selectedSeed, seedStep, register, loadedCaseTags, activeUtterance, envelopeText,
  parseError, isRunning, onSelectSeed, onSetRegister, onLoadTurn, onRun, onResetBoard, onTextChange,
}: EnvelopeSectionProps) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 11, color: '#444', fontWeight: 600, cursor: 'pointer' }}>
        Envelope and lessons
      </summary>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Envelope JSON (paste, or load a lesson turn)</div>

        {/* Row 1: lesson picker + register toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <select
            value={selectedSeedId}
            onChange={e => onSelectSeed(e.target.value)}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid #ccc',
              borderRadius: 4,
              background: 'white',
              color: '#1a1a1a',
              minWidth: 0,
            }}
          >
            {seeds.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          {/* Formal / casual toggle */}
          {(['formal', 'coloquial'] as const).map(r => (
            <button
              key={r}
              onClick={() => onSetRegister(r)}
              style={{
                padding: '4px 8px',
                fontSize: 10,
                background: register === r ? '#2563eb' : 'transparent',
                color: register === r ? 'white' : '#2563eb',
                border: '1px solid #2563eb',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {r === 'formal' ? 'Formal' : 'Casual'}
            </button>
          ))}
        </div>

        {/* Row 2: Load turn + Run + Reset board */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {/* "Load turn N/M": fills the textarea, does NOT run */}
          {(() => {
            const total = selectedSeed?.turns.length ?? 0
            const atEnd = seedStep >= total
            return (
              <button
                onClick={onLoadTurn}
                disabled={atEnd || total === 0}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  border: `1px solid ${atEnd || total === 0 ? '#aaa' : '#2563eb'}`,
                  borderRadius: 6,
                  cursor: atEnd || total === 0 ? 'default' : 'pointer',
                  color: atEnd || total === 0 ? '#aaa' : '#2563eb',
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                {atEnd ? 'End' : `Load turn ${seedStep + 1}/${total}`}
              </button>
            )
          })()}

          {/* "▶ Run": parseEnvelopeText → applyEnvelope */}
          <button
            onClick={onRun}
            disabled={isRunning}
            style={{
              padding: '6px 16px',
              background: isRunning ? '#ccc' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: isRunning ? 'default' : 'pointer',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {isRunning ? '⏳ Animating…' : '▶ Run'}
          </button>

          {/* "⟲ Reset board": clears the canvas (resetDocument) + the step */}
          <button
            onClick={onResetBoard}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #888',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#555',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            ⟲ Reset board
          </button>
        </div>

        {/* Active utterance */}
        {activeUtterance !== null && (
          <div style={{
            fontSize: 11,
            color: '#888',
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            🗣 {activeUtterance}
          </div>
        )}

        {/* case_tags chips of the loaded turn */}
        {loadedCaseTags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {loadedCaseTags.map(tag => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  background: '#e0e7ff',
                  color: '#3730a3',
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <textarea
          value={envelopeText}
          onChange={onTextChange}
          rows={8}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 8,
            border: parseError ? '1px solid #f87171' : '1px solid #ccc',
            borderRadius: 4,
            resize: 'vertical',
            background: 'white',
            color: '#1a1a1a',
            boxSizing: 'border-box',
          }}
          placeholder={'{\n  "schema_version": "1.0",\n  "operations": []\n}'}
          spellCheck={false}
        />
      </div>
    </details>
  )
}

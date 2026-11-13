/** Console section: a typed teacher phrase — enqueued as 'manual', skipping the gate. */
export interface PhraseSectionProps {
  agentInput: string
  onChange: (value: string) => void
  onInterpret: () => void
  recentUtterances: string[]
}

export function PhraseSection({ agentInput, onChange, onInterpret, recentUtterances }: PhraseSectionProps) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: '#444', fontWeight: 600, marginBottom: 4 }}>
        Teacher phrase
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={agentInput}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { onInterpret() } }}
          placeholder="Type a phrase…"
          style={{
            width: 200,
            fontFamily: 'sans-serif',
            fontSize: 13,
            padding: '5px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            background: 'white',
            color: '#1a1a1a',
          }}
        />
        <button
          onClick={() => { onInterpret() }}
          disabled={agentInput.trim() === ''}
          style={{
            padding: '5px 12px',
            background: agentInput.trim() === '' ? '#ccc' : '#16a34a',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: agentInput.trim() === '' ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}
        >
          Interpret
        </button>
      </div>
      {recentUtterances.length > 0 && (
        <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
          Context: {recentUtterances.slice(-2).map((u, i) => (
            <span key={i} style={{ marginRight: 4 }}>"{u}"</span>
          ))}
        </div>
      )}
    </div>
  )
}

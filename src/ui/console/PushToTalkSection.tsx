/**
 * Console section: push-to-talk with the Web Speech API. Hold pressed = start(),
 * release = stop(); the final phrase enters the same queue as "Interpret".
 */
export interface PushToTalkSectionProps {
  busy: boolean
  recording: boolean
  partial: string
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp: () => void
}

export function PushToTalkSection({ busy, recording, partial, onPointerDown, onPointerUp }: PushToTalkSectionProps) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: '#444', fontWeight: 600, marginBottom: 4 }}>
        Push-to-talk (Web Speech API — cloud)
      </div>
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        disabled={busy}
        style={{
          padding: '6px 14px',
          background: recording ? '#dc2626' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: busy ? 'default' : 'pointer',
          fontWeight: 600,
          fontSize: 13,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {recording ? '● Recording… (release to transcribe)' : '🎤 Hold to talk'}
      </button>
      {/* Development partial: never written on the board. */}
      {partial !== '' && (
        <div style={{ fontSize: 11, color: '#666', marginTop: 4, fontStyle: 'italic' }}>
          partial: "{partial}"
        </div>
      )}
    </div>
  )
}

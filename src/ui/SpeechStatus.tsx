/**
 * SpeechStatus — floating indicators of the voice input: the privacy badge (the
 * audio goes to a Google cloud service, never hidden behind the developer toggle:
 * the board is projected in front of children) and the live partial transcript of
 * the continuous session (informative only, never written on the board).
 */
export interface SpeechStatusProps {
  /** Show the privacy badge (not in the static demo: there is no voice). */
  showPrivacyBadge: boolean
  /** Continuous session open. */
  listening: boolean
  partial: string
}

export function SpeechStatus({ showPrivacyBadge, listening, partial }: SpeechStatusProps) {
  return (
    <>
      {showPrivacyBadge && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(var(--gis-space-5) + 68px)',
            right: 'var(--gis-space-5)',
            zIndex: 'var(--gis-z-floating)',
            background: 'var(--gis-danger)',
            color: 'var(--gis-text-inverse)',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 999,
            boxShadow: 'var(--gis-shadow-md)',
            whiteSpace: 'nowrap',
          }}
          title="Speech is transcribed with Chrome's Web Speech API: the audio is sent to a Google cloud service, it is not local."
        >
          STT: Google (cloud)
        </div>
      )}
      {listening && partial !== '' && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(var(--gis-space-5) + 92px)',
            right: 'var(--gis-space-5)',
            zIndex: 'var(--gis-z-floating)',
            background: 'var(--gis-surface-raised)',
            color: 'var(--gis-text-primary)',
            fontSize: 11,
            fontStyle: 'italic',
            padding: '3px 8px',
            borderRadius: 6,
            boxShadow: 'var(--gis-shadow-md)',
            maxWidth: 240,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          "{partial}"
        </div>
      )}
    </>
  )
}

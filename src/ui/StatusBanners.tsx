/** Developer-mode banners: error (parse or agent), info (empty response) and validation warnings. */
export interface StatusBannersProps {
  parseError: string | null
  agentInfo: string | null
  warnings: string[]
}

export function StatusBanners({ parseError, agentInfo, warnings }: StatusBannersProps) {
  return (
    <>
      {parseError && (
        <div style={{ background: '#fee2e2', padding: '4px 16px', fontSize: 12, color: '#991b1b', borderBottom: '1px solid #fca5a5' }}>
          Error: {parseError}
        </div>
      )}

      {/* Informative: the agent answered with operations: [] */}
      {agentInfo && (
        <div style={{ background: '#f3f4f6', padding: '4px 16px', fontSize: 12, color: '#374151', borderBottom: '1px solid #d1d5db' }}>
          {agentInfo}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ background: '#fff3cd', padding: '4px 16px', fontSize: 12, color: '#856404' }}>
          Warnings: {warnings.slice(-3).join(' | ')}
        </div>
      )}
    </>
  )
}

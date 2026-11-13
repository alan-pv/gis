/** Console section: the state §2 the agent sees of the active page (updates on every change). */
import { useMemo } from 'react'
import { documentToAgentState } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'

export interface AgentStateSectionProps {
  document: GisDocument
  recentUtterances: string[]
}

export function AgentStateSection({ document, recentUtterances }: AgentStateSectionProps) {
  const agentStateJson = useMemo(
    () => JSON.stringify(
      documentToAgentState(document, { width: CANVAS_W, height: CANVAS_H }, recentUtterances),
      null,
      2,
    ),
    [document, recentUtterances],
  )

  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 11, color: '#444', fontWeight: 600, cursor: 'pointer' }}>
        State §2 (agent)
      </summary>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
          What the agent sees of the active page (updates on every change)
        </div>
        <pre
          style={{
            margin: 0,
            maxHeight: 320,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.4,
            padding: 8,
            background: '#1e1e1e',
            color: '#d4d4d4',
            border: '1px solid #333',
            borderRadius: 4,
            whiteSpace: 'pre',
          }}
        >
          {agentStateJson}
        </pre>
      </div>
    </details>
  )
}

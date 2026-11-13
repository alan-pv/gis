/**
 * DevConsole — the developer console (View → Developer mode): queue panel, typed
 * phrase, push-to-talk, raw envelope box and the state the agent sees.
 */
import { Terminal } from 'lucide-react'
import type { GisDocument } from '@/document/index.js'
import type { Queue } from '@/speech/queue.js'
import { DevDock } from './DevDock.js'
import { DevWindow } from './DevWindow.js'
import { QueuePanel } from './QueuePanel.js'
import { PhraseSection } from './PhraseSection.js'
import type { PhraseSectionProps } from './PhraseSection.js'
import { PushToTalkSection } from './PushToTalkSection.js'
import type { PushToTalkSectionProps } from './PushToTalkSection.js'
import { EnvelopeSection } from './EnvelopeSection.js'
import type { EnvelopeSectionProps } from './EnvelopeSection.js'
import { AgentStateSection } from './AgentStateSection.js'

export interface DevConsoleProps {
  collapsed: boolean
  onToggleCollapse: () => void
  document: GisDocument
  queue: { queue: Queue; onForce: (id: string) => void; onClear: () => void }
  phrase: PhraseSectionProps
  pushToTalk: PushToTalkSectionProps
  envelope: EnvelopeSectionProps
}

export function DevConsole({ collapsed, onToggleCollapse, document, queue, phrase, pushToTalk, envelope }: DevConsoleProps) {
  return (
    <DevDock>
      <DevWindow
        title="Console"
        icon={<Terminal size={15} strokeWidth={1.75} />}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      >
        {/* Phrase queue (always visible): phrases entering and leaving */}
        <div style={{ marginTop: 12 }}>
          <QueuePanel queue={queue.queue} onForce={queue.onForce} onClear={queue.onClear} />
        </div>
        <PhraseSection {...phrase} />
        <PushToTalkSection {...pushToTalk} />
        <EnvelopeSection {...envelope} />
        <AgentStateSection document={document} recentUtterances={phrase.recentUtterances} />
      </DevWindow>
    </DevDock>
  )
}

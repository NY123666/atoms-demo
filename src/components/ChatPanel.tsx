import type { GenStepState, Project } from '../types'
import Composer from './Composer'
import StepLog from './StepLog'
import { formatDateTime } from '../lib/format'
import { IconHistory, IconSpark } from './Icons'

interface ChatPanelProps {
  project: Project
  draft: string
  onDraft: (v: string) => void
  onSubmit: () => void
  running: boolean
  onStop: () => void
  steps: GenStepState[]
  streamText: string
  totalMs: number
  onJumpVersion: (versionId: string) => void
}

const ITERATE_HINTS = ['再加一个暗色主题切换', '把数据用柱状图展示', '支持导出成 JSON 文件', '加一个搜索框过滤列表']

export default function ChatPanel({
  project,
  draft,
  onDraft,
  onSubmit,
  running,
  onStop,
  steps,
  streamText,
  totalMs,
  onJumpVersion,
}: ChatPanelProps) {
  const hasVersion = project.versions.length > 0

  return (
    <div className="chat">
      <div className="chat-scroll">
        {project.messages.length === 0 ? (
          <div className="chat-empty">
            <h3>
              <IconSpark size={15} />
              描述你要的应用
            </h3>
            <p>它会先跑通核心交互，再按你的追加描述继续迭代。每次生成都会存成一版，可以随时回滚。</p>
          </div>
        ) : (
          project.messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                <div className="msg-bubble">{m.content}</div>
                <span className="msg-time">{formatDateTime(m.createdAt)}</span>
              </div>
            ) : (
              <div key={m.id} className="msg msg-assistant">
                <div className="msg-bubble">
                  <p>{m.content}</p>
                  {m.versionId ? (
                    <button className="msg-action" onClick={() => onJumpVersion(m.versionId!)} type="button">
                      <IconHistory size={12} />
                      查看这一版产物
                    </button>
                  ) : null}
                </div>
              </div>
            ),
          )
        )}

        {(running || steps.length > 0) && (
          <StepLog steps={steps} running={running} streamText={streamText} totalMs={totalMs} />
        )}
      </div>

      <div className="chat-composer">
        <Composer
          value={draft}
          onChange={onDraft}
          onSubmit={onSubmit}
          running={running}
          onStop={onStop}
          size="sm"
          submitLabel={hasVersion ? '继续迭代' : '生成'}
          placeholder={hasVersion ? '继续描述要改什么，例如：加一个搜索框' : '例如：做一个待办清单，能筛选和统计完成率'}
          under={
            hasVersion ? (
              <div className="hint-chips">
                {ITERATE_HINTS.map((h) => (
                  <button key={h} className="chip chip-sm" onClick={() => onDraft(h)} type="button">
                    {h}
                  </button>
                ))}
              </div>
            ) : null
          }
        />
      </div>
    </div>
  )
}

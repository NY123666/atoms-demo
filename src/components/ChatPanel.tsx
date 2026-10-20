import type { GenStepState, Project } from '../types'
import Composer from './Composer'
import StepLog from './StepLog'
import RunRecord from './RunRecord'
import { formatDateTime } from '../lib/format'
import type { EnhanceOverview } from '../lib/enhance'
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
  /** 这一版产物已经有/还缺哪些通用能力，由 enhance.ts 判定 */
  overview: EnhanceOverview
}

/**
 * 下一步建议。
 *
 * 这里原来是四个写死的提示，于是它会把「加一个搜索框」推荐给一个**已经有搜索框**的版本：
 * 点下去不会有任何变化，跟这套代码在别处坚持的「识别不到就不硬凑」自相矛盾。
 * 现在改成按当前这一版的实际能力算（同一套判定，见 enhance.ts）：
 * 已经有的一律不推荐，四项全齐了就直接说齐了，而不是继续摆一排点了没用的按钮。
 */
function NextSteps({ overview, onPick }: { overview: EnhanceOverview; onPick: (v: string) => void }) {
  if (overview.suggest.length === 0) {
    return (
      <div className="next-steps">
        <span className="next-label">下一步</span>
        <span className="next-note">搜索 / 导出 / 柱状图 / 暗色这四项通用能力这一版都齐了，直接说你想加的新东西就行。</span>
      </div>
    )
  }
  return (
    <div className="next-steps">
      <div className="hint-chips">
        <span className="next-label">下一步可以加</span>
        {overview.suggest.map((s) => (
          <button
            key={s.id}
            className="chip chip-sm"
            onClick={() => onPick(s.prompt)}
            title={`点一下填进输入框：${s.prompt}`}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>
      {overview.have.length > 0 ? <span className="next-note">这一版已经有：{overview.have.join(' · ')}</span> : null}
    </div>
  )
}

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
  overview,
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
                  {m.run ? (
                    <RunRecord run={m.run} versionId={m.versionId} onJumpVersion={onJumpVersion} />
                  ) : m.versionId ? (
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
          under={hasVersion ? <NextSteps overview={overview} onPick={onDraft} /> : null}
        />
      </div>
    </div>
  )
}

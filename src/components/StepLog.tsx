import type { GenStepState } from '../types'
import { formatDuration } from '../lib/format'
import { IconCheck, IconClose, IconSpark } from './Icons'

interface StepLogProps {
  steps: GenStepState[]
  running: boolean
  streamText: string
  totalMs: number
}

export default function StepLog({ steps, running, streamText, totalMs }: StepLogProps) {
  const done = steps.filter((s) => s.status === 'done').length

  return (
    <div className="steplog">
      <div className="steplog-head">
        <span className={`dot ${running ? 'busy' : 'idle'}`} />
        <strong>{running ? '智能体执行中' : steps.length > 0 ? '本次执行记录' : '等待任务'}</strong>
        <span className="steplog-count">
          {steps.length > 0 ? `${done}/${steps.length} 步` : ''}
          {totalMs > 0 ? ` · ${formatDuration(totalMs)}` : ''}
        </span>
      </div>

      {steps.length === 0 ? (
        <p className="steplog-hint">描述你想要的页面，这里会逐步显示每一步真实做了什么。</p>
      ) : (
        <ol className="steplog-list">
          {steps.map((s, i) => {
            const ms = s.startedAt ? (s.finishedAt ?? Date.now()) - s.startedAt : 0
            return (
              <li key={`${s.title}-${i}`} className={`step step-${s.status}`}>
                <span className="step-mark">
                  {s.status === 'done' ? <IconCheck size={12} /> : s.status === 'error' ? <IconClose size={12} /> : s.status === 'running' ? <IconSpark size={12} /> : i + 1}
                </span>
                <div className="step-body">
                  <div className="step-title">
                    {s.title}
                    {s.status === 'done' && ms > 0 ? <em>{formatDuration(ms)}</em> : null}
                  </div>
                  {s.detail ? <p className="step-detail">{s.detail}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {running && streamText ? (
        <div className="stream-box">
          <div className="stream-head">
            <IconSpark size={12} />
            模型实时输出
          </div>
          <pre>{streamText.slice(-1200)}</pre>
        </div>
      ) : null}
    </div>
  )
}

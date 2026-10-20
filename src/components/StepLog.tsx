import type { GenStepState } from '../types'
import { formatDuration } from '../lib/format'
import { IconCheck, IconClose } from './Icons'

/**
 * 步骤列表的纯展示部分。执行中的 StepLog 和存档的 RunRecord 共用这一份渲染，
 * 保证"当场看到的"和"刷新后回看的"长一个样。
 */
export function StepList({ steps }: { steps: GenStepState[] }) {
  return (
    <ol className="steplog-list">
      {steps.map((s, i) => {
        const ms = s.startedAt ? (s.finishedAt ?? Date.now()) - s.startedAt : 0
        return (
          <li key={`${s.title}-${i}`} className={`step step-${s.status}`}>
            <span className="step-mark">
              {s.status === 'done' ? (
                <IconCheck size={12} />
              ) : s.status === 'error' ? (
                <IconClose size={12} />
              ) : (
                i + 1
              )}
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
  )
}

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
        <strong>{running ? '正在执行' : steps.length > 0 ? '执行记录' : '空闲'}</strong>
        <span className="steplog-count">
          {steps.length > 0 ? `${done}/${steps.length} 步` : ''}
          {totalMs > 0 ? ` · ${formatDuration(totalMs)}` : ''}
        </span>
      </div>

      {steps.length === 0 ? (
        <p className="steplog-hint">
          每一步真实做了什么都会记在这里：解析需求 → 组装上下文 → 生成代码 → 自检 → 装载预览。
        </p>
      ) : (
        <StepList steps={steps} />
      )}

      {running && streamText ? (
        <div className="stream-box">
          <div className="stream-head">模型实时输出</div>
          <pre>{streamText.slice(-1200)}</pre>
        </div>
      ) : null}
    </div>
  )
}

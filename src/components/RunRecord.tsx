import { useState } from 'react'
import type { GenRun } from '../types'
import { formatDuration } from '../lib/format'
import { ranStepCount } from '../lib/run'
import { StepList } from './StepLog'
import { IconChevron, IconClose, IconHistory, IconStop } from './Icons'

interface RunRecordProps {
  run: GenRun
  /** 成功时绑定的版本；没有（失败/停止）就只展示步骤，不出现"看产物" */
  versionId?: string
  onJumpVersion: (versionId: string) => void
}

const STATUS_LABEL: Record<GenRun['status'], string> = {
  done: '已存档',
  error: '失败',
  stopped: '已停止',
}

/**
 * 存档后的执行记录（挂在聊天消息里，刷新后仍可回看）。
 * 默认收起，只露出一行摘要；点开看每一步做了什么、花了多久。
 */
export default function RunRecord({ run, versionId, onJumpVersion }: RunRecordProps) {
  const [open, setOpen] = useState(false)
  const ran = ranStepCount(run.steps)
  const total = run.steps.length

  return (
    <div className={`run-record run-${run.status} ${open ? 'open' : ''}`}>
      <button className="run-record-head" onClick={() => setOpen((v) => !v)} type="button" aria-expanded={open}>
        <span className={`dot dot-status ${run.status === 'error' ? 'error' : run.status === 'stopped' ? 'stopped' : 'ok'}`} />
        <IconHistory size={12} />
        <strong>执行记录</strong>
        <em className="run-record-status">
          {run.status === 'error' ? <IconClose size={11} /> : run.status === 'stopped' ? <IconStop size={11} /> : null}
          {STATUS_LABEL[run.status]}
        </em>
        <span className="run-record-meta">
          {total > 0 ? `${ran}/${total} 步` : '0 步'}
          {run.durationMs > 0 ? ` · ${formatDuration(run.durationMs)}` : ''}
        </span>
        <IconChevron size={13} className="run-record-chevron" />
      </button>

      {open ? (
        <div className="run-record-body">
          <StepList steps={run.steps} />
          {run.error ? <p className="run-record-error">{run.error}</p> : null}
          {versionId ? (
            <button className="msg-action" onClick={() => onJumpVersion(versionId!)} type="button">
              <IconHistory size={12} />
              查看这一版产物
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

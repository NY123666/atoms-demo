import type { AppVersion } from '../types'
import { downloadHtml } from '../lib/share'
import { formatDateTime, formatDuration, formatTokens } from '../lib/format'
import { IconCheck, IconDownload, IconHistory, IconTrash } from './Icons'

interface VersionTimelineProps {
  versions: AppVersion[]
  currentVersionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export default function VersionTimeline({ versions, currentVersionId, onSelect, onDelete }: VersionTimelineProps) {
  const ordered = [...versions].sort((a, b) => b.index - a.index)

  return (
    <div className="timeline">
      <div className="timeline-head">
        <IconHistory size={14} />
        版本存档
        <span className="count">{versions.length}</span>
      </div>

      {ordered.length === 0 ? (
        <p className="timeline-hint">
          每次生成或迭代都会自动存档一版，可以随时回滚到任意历史版本。
        </p>
      ) : (
        <ol className="timeline-list">
          {ordered.map((v) => {
            const active = v.id === currentVersionId
            return (
              <li key={v.id} className={`tl-item ${active ? 'active' : ''}`}>
                <button className="tl-main" onClick={() => onSelect(v.id)} type="button">
                  <span className="tl-top">
                    <span className="tl-index">v{v.index}</span>
                    {active ? (
                      <span className="tl-current">
                        <IconCheck size={11} />
                        当前
                      </span>
                    ) : null}
                  </span>
                  <span className="tl-label">{v.label}</span>
                  <span className="tl-meta">
                    {v.source === 'demo' ? '演示引擎' : v.model ?? '模型'} · {formatDuration(v.durationMs)}
                    {v.tokens ? ` · ${formatTokens(v.tokens)}` : ''}
                    {v.autoFixed ? ' · 已自动修复' : ''}
                  </span>
                  <span className="tl-time">{formatDateTime(v.createdAt)}</span>
                </button>
                <div className="tl-tools">
                  <button
                    title="导出这一版"
                    onClick={() => downloadHtml(`${v.label || 'app'}-v${v.index}`, v.html)}
                    type="button"
                  >
                    <IconDownload size={12} />
                  </button>
                  <button
                    title="删除这一版"
                    onClick={() => {
                      if (window.confirm(`删除 v${v.index}？`)) onDelete(v.id)
                    }}
                    type="button"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

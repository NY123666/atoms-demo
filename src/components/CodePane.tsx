import { useMemo, useState } from 'react'
import type { AppVersion } from '../types'
import { copyText, formatBytes, formatTokens } from '../lib/format'
import { downloadHtml } from '../lib/share'
import { toast } from '../lib/toast'
import { IconCheck, IconCopy, IconDownload, IconSearch } from './Icons'

interface CodePaneProps {
  version: AppVersion | null
}

export default function CodePane({ version }: CodePaneProps) {
  const [query, setQuery] = useState('')

  const stats = useMemo(() => {
    if (!version) return null
    return { lines: version.html.split('\n').length, bytes: version.html.length }
  }, [version])

  if (!version) {
    return <div className="pane-empty">还没有产物。先在左侧描述你需要的页面。</div>
  }

  const hitCount = query.trim() ? version.html.toLowerCase().split(query.trim().toLowerCase()).length - 1 : 0

  return (
    <div className="codepane">
      <div className="pane-bar">
        <div className="pane-bar-left">
          <span className="tag">v{version.index}</span>
          <span className="pane-meta">
            {stats?.lines} 行 · {formatBytes(stats?.bytes ?? 0)}
            {version.tokens ? ` · ${formatTokens(version.tokens)}` : ''}
          </span>
        </div>
        <div className="pane-bar-right">
          <label className="inline-search">
            <IconSearch size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="在代码里查找" />
            {query.trim() ? <span className="inline-search-count">{hitCount} 处</span> : null}
          </label>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const ok = await copyText(version.html)
              toast(ok ? '已复制完整源码' : '复制失败，请手动选中复制', ok ? 'success' : 'error')
            }}
            type="button"
          >
            <IconCopy size={13} />
            复制
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              downloadHtml(version.label || 'app', version.html)
              toast('已导出单文件 HTML', 'success')
            }}
            type="button"
          >
            <IconDownload size={13} />
            导出
          </button>
        </div>
      </div>

      {version.note ? (
        <p className="pane-note">
          <IconCheck size={12} />
          {version.note}
        </p>
      ) : null}

      <pre className="code-block">{version.html}</pre>
    </div>
  )
}

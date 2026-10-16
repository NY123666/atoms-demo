import { useMemo, useState } from 'react'
import {
  createProject,
  deleteProject,
  duplicateProject,
  toggleStar,
  useStore,
} from '../lib/store'
import { findProvider } from '../lib/providers'
import { go } from '../lib/router'
import { timeAgo } from '../lib/format'
import { toast } from '../lib/toast'
import { IconLayers, IconPlus, IconSearch, IconSettings, IconStar, IconTrash, IconCopy } from './Icons'

interface SidebarProps {
  activeProjectId: string | null
}

export default function Sidebar({ activeProjectId }: SidebarProps) {
  const { projects, settings, persistError } = useStore()
  const [query, setQuery] = useState('')
  const [starOnly, setStarOnly] = useState(false)

  const provider = findProvider(settings.activeProviderId)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects
      .filter((p) => (starOnly ? p.starred : true))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || p.messages.some((m) => m.content.toLowerCase().includes(q)) : true))
      .sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt)
  }, [projects, query, starOnly])

  function onNew() {
    const p = createProject()
    go(`/p/${p.id}`)
  }

  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => go('/')} type="button">
        <span className="brand-mark">F</span>
        <span className="brand-text">
          <strong>Forge</strong>
          <em>一句话生成可运行应用</em>
        </span>
      </button>

      <div className="side-actions">
        <button className="btn btn-primary btn-block" onClick={onNew} type="button">
          <IconPlus size={15} />
          新建应用
        </button>
      </div>

      <div className="side-search">
        <IconSearch size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索我的应用" />
        <button
          className={`chip-toggle ${starOnly ? 'on' : ''}`}
          onClick={() => setStarOnly((v) => !v)}
          title="只看收藏"
          type="button"
        >
          <IconStar size={13} />
        </button>
      </div>

      <div className="side-list">
        {list.length === 0 ? (
          <p className="side-empty">
            {projects.length === 0 ? '还没有应用，点上面「新建应用」开始。' : '没有匹配的应用。'}
          </p>
        ) : (
          list.map((p) => {
            const active = p.id === activeProjectId
            return (
              <div key={p.id} className={`side-item ${active ? 'active' : ''}`}>
                <button className="side-item-main" onClick={() => go(`/p/${p.id}`)} type="button">
                  <span className="side-item-name">
                    {p.starred ? <IconStar size={12} className="star-on" /> : null}
                    {p.name}
                  </span>
                  <span className="side-item-meta">
                    {p.versions.length} 版 · {timeAgo(p.updatedAt)}
                  </span>
                </button>
                <div className="side-item-tools">
                  <button
                    title={p.starred ? '取消收藏' : '收藏'}
                    onClick={() => toggleStar(p.id)}
                    type="button"
                  >
                    <IconStar size={13} className={p.starred ? 'star-on' : ''} />
                  </button>
                  <button
                    title="创建副本"
                    onClick={() => {
                      const copy = duplicateProject(p.id)
                      if (copy) {
                        toast('已创建副本', 'success')
                        go(`/p/${copy.id}`)
                      }
                    }}
                    type="button"
                  >
                    <IconCopy size={13} />
                  </button>
                  <button
                    title="删除"
                    onClick={() => {
                      if (window.confirm(`删除「${p.name}」？此操作不可撤销。`)) {
                        deleteProject(p.id)
                        if (active) go('/')
                        toast('已删除', 'info')
                      }
                    }}
                    type="button"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {persistError ? <p className="side-warn">{persistError}</p> : null}

      <button className="side-foot" onClick={() => go('/settings')} type="button">
        <IconLayers size={14} />
        <span>
          <strong>{provider.name}</strong>
          <em>{settings.activeProviderId === 'demo' ? '无需 Key · 模板引擎' : '自带 Key · 浏览器直连'}</em>
        </span>
        <IconSettings size={15} />
      </button>
    </aside>
  )
}

import { useMemo, useState } from 'react'
import Composer from './Composer'
import ProjectFilters from './ProjectFilters'
import { DEMO_SHOWCASE } from '../lib/demoEngine'
import { deriveTitle } from '../lib/intent'
import { createProject, useStore, deleteProject, toggleStar, duplicateProject } from '../lib/store'
import { HOSTED_PROVIDER_ID, STATION_PROVIDER_ID, findProvider } from '../lib/providers'
import { useHosted } from '../lib/hosted'
import { stationModel } from '../lib/station'
import { setHandoff } from '../lib/handoff'
import { go } from '../lib/router'
import { timeAgo } from '../lib/format'
import { toast } from '../lib/toast'
import { DEFAULT_QUERY, currentVersionOf, filterProjects, isFiltering, type ProjectQuery } from '../lib/projects'
import { IconLayers, IconPlus, IconRefresh, IconSettings, IconStar, IconTrash } from './Icons'

export default function Dashboard() {
  const { projects, settings } = useStore()
  const hosted = useHosted()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState<ProjectQuery>(DEFAULT_QUERY)
  const provider = findProvider(settings.activeProviderId)
  // 网格和侧边栏共用同一份判定，避免"同一个词在左边搜得到、在右边搜不到"。
  const rows = useMemo(() => filterProjects(projects, query), [projects, query])
  const filtering = isFiltering(query)

  function start(prompt: string) {
    const text = prompt.trim()
    if (!text) return
    const project = createProject(deriveTitle(text))
    setHandoff(project.id, text)
    go(`/p/${project.id}`)
  }

  return (
    <div className="page page-home">
      <header className="hero">
        <div className="hero-tags">
          <span className="pill pill-accent">当前引擎：{provider.name}</span>
          {settings.activeProviderId === 'demo' ? (
            <span className="pill">演示引擎 · 无需 API Key</span>
          ) : settings.activeProviderId === STATION_PROVIDER_ID ? (
            // 跟下面那句「Key 只存在你的浏览器里」正相反，所以必须单开一支：
            // 内置模型的 Key 在页面里，说成"只存在你浏览器里"是错的，尽管访客也拿不到它。
            <span className="pill">本站内置 {stationModel()} · 无需配置</span>
          ) : settings.activeProviderId === HOSTED_PROVIDER_ID ? (
            // 把剩余额度放在首屏：访客不用点进设置就知道"这个还能用几次"，
            // 额度见底时也有心理预期，而不是生成到一半突然被拒。
            <span className="pill">
              {`本站额度调用 ${hosted.model ?? '内置模型'}`}
              {typeof hosted.remainingForYou === 'number' ? ` · 今日剩余 ${hosted.remainingForYou} 次` : ''}
            </span>
          ) : (
            <span className="pill">Key 只存在你的浏览器里</span>
          )}
        </div>
        <h1>写下需求，产出一份能直接运行的单文件应用</h1>
        <p className="hero-sub">
          Forge 先把核心交互跑通，再按你的追加描述继续迭代。产出是真实的单文件 HTML，
          数据真的会保存；每一版都会存档，可以回滚、导出源码，或者打包成一条链接发出去。
        </p>

        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => start(draft)}
          placeholder="例如：做一个记账本，能按分类汇总并显示占比图"
          submitLabel="生成应用"
          under={
            <div className="showcase">
              <span className="showcase-label"><IconRefresh size={13} />示例需求：</span>
              {DEMO_SHOWCASE.map((s) => (
                <button key={s.label} className="chip" onClick={() => setDraft(s.prompt)} type="button">
                  {s.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="feature-row">
          <div className="feature">
            <strong>产出是源码文件</strong>
            <em>单文件 HTML + CSS + JS，浏览器直接打开就能用</em>
          </div>
          <div className="feature">
            <strong>按描述迭代</strong>
            <em>「再加个暗色主题」就能改，每次改动自动存档，随时回退</em>
          </div>
          <div className="feature">
            <strong>分享不用服务器</strong>
            <em>整份产物打包进一条链接，对方打开就能用</em>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>
            <IconLayers size={16} />
            我的应用
            <span className="count">{projects.length}</span>
          </h2>
          <div className="section-tools">
            <button className="btn btn-ghost" onClick={() => go('/settings')} type="button">
              <IconSettings size={14} />
              模型设置
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const p = createProject()
                go(`/p/${p.id}`)
              }}
              type="button"
            >
              <IconPlus size={14} />
              新建
            </button>
          </div>
        </div>

        {/* 一个应用都没有时不摆检索条：没有东西可筛，先让人去创建。 */}
        {projects.length > 0 ? (
          <ProjectFilters
            value={query}
            onChange={(patch) => setQuery((q) => ({ ...q, ...patch }))}
            shown={rows.length}
            total={projects.length}
            filtering={filtering}
          />
        ) : null}

        {projects.length === 0 ? (
          <div className="empty">
            <p>还没有应用。在上面写下需求，或者点一个示例需求开始。</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>没有匹配的应用。</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setQuery(DEFAULT_QUERY)} type="button">
              清除筛选（共 {projects.length} 个）
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {rows.map(({ project: p, hit }) => {
              const current = currentVersionOf(p)
              return (
                <article key={p.id} className="project-card" onClick={() => go(`/p/${p.id}`)}>
                  <div className="pc-top">
                    <h3>{p.name}</h3>
                    <button
                      className="icon-btn"
                      title={p.starred ? '取消收藏' : '收藏'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleStar(p.id)
                      }}
                      type="button"
                    >
                      <IconStar size={14} className={p.starred ? 'star-on' : ''} />
                    </button>
                  </div>
                  <p className="pc-desc">{current?.prompt ?? '还没有生成过内容'}</p>
                  {/* 命中的是卡片上已经看得见的那句就不提示；命中别处才说明它为什么被搜到。 */}
                  {hit ? (
                    <p className="pc-hit" title={hit.text}>
                      匹配{hit.versionIndex === null ? '你说过的话' : ` v${hit.versionIndex}`}：{hit.text}
                    </p>
                  ) : null}
                  <div className="pc-meta">
                    <span>{p.versions.length} 个版本</span>
                    <span>·</span>
                    <span>{timeAgo(p.updatedAt)}</span>
                    {current ? <span className="tag">{current.source === 'demo' ? '演示引擎' : current.model ?? '模型'}</span> : null}
                  </div>
                  <div className="pc-tools">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        const copy = duplicateProject(p.id)
                        if (copy) {
                          toast('已创建副本', 'success')
                          go(`/p/${copy.id}`)
                        }
                      }}
                      type="button"
                    >
                      创建副本
                    </button>
                    <button
                      className="btn btn-ghost btn-sm danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`删除「${p.name}」？此操作不可撤销。`)) {
                          deleteProject(p.id)
                          toast('已删除', 'info')
                        }
                      }}
                      type="button"
                    >
                      <IconTrash size={13} />
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

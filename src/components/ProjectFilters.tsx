import type { EngineFilter, ProjectQuery, ProjectSort } from '../lib/projects'
import { DEFAULT_QUERY } from '../lib/projects'
import { IconClose, IconSearch, IconStar } from './Icons'

interface ProjectFiltersProps {
  value: ProjectQuery
  onChange: (patch: Partial<ProjectQuery>) => void
  /** 筛选后剩下几个 / 一共有几个，用于如实说明"筛掉了多少" */
  shown: number
  total: number
  filtering: boolean
}

/**
 * 首页列表的检索条。
 *
 * 它不只是给大屏用的：`@media (max-width: 900px)` 里整个侧边栏是 `display:none`，
 * 所以窄屏上这里是**唯一**的搜索入口。侧边栏那个输入框则留给工作台页（那边没有这个网格）。
 */
export default function ProjectFilters({ value, onChange, shown, total, filtering }: ProjectFiltersProps) {
  return (
    <div className="project-filters">
      <label className="filter-search">
        <IconSearch size={13} />
        <input
          value={value.query}
          onChange={(e) => onChange({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange({ query: '' })
          }}
          placeholder="搜应用名，或搜你说过的话"
          aria-label="搜索我的应用"
          spellCheck={false}
        />
        {value.query ? (
          <button className="filter-clear" onClick={() => onChange({ query: '' })} title="清空搜索" type="button">
            <IconClose size={12} />
          </button>
        ) : null}
      </label>

      <div className="seg">
        <button
          className={value.starredOnly ? '' : 'on'}
          aria-pressed={!value.starredOnly}
          onClick={() => onChange({ starredOnly: false })}
          type="button"
        >
          全部
        </button>
        <button
          className={value.starredOnly ? 'on' : ''}
          aria-pressed={value.starredOnly}
          onClick={() => onChange({ starredOnly: true })}
          type="button"
        >
          <IconStar size={11} />
          收藏
        </button>
      </div>

      <label className="filter-select">
        引擎
        <select value={value.engine} onChange={(e) => onChange({ engine: e.target.value as EngineFilter })}>
          <option value="all">全部</option>
          <option value="demo">演示引擎</option>
          <option value="model">真模型</option>
          <option value="empty">还没生成</option>
        </select>
      </label>

      <label className="filter-select">
        排序
        <select value={value.sort} onChange={(e) => onChange({ sort: e.target.value as ProjectSort })}>
          <option value="recent">最近更新</option>
          <option value="created">创建时间</option>
          <option value="versions">版本数</option>
          <option value="name">名称</option>
        </select>
      </label>

      {filtering ? (
        <span className="filter-count">
          筛出 {shown} / 共 {total}
          <button className="filter-reset" onClick={() => onChange(DEFAULT_QUERY)} type="button">
            清除
          </button>
        </span>
      ) : null}
    </div>
  )
}

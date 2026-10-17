import type { AppVersion, Project } from '../types'

/**
 * 「我的应用」的检索层：首页卡片网格和左侧栏共用同一份判定。
 *
 * 为什么单独抽成纯函数：这两处原来各写了一套，于是同一个词在左边搜得到、在右边的
 * 网格里搜不到 —— 侧边栏扫的是**全部消息**（连模型的长篇总结也算），而卡片上显示的是
 * 当前版那句需求。搜到的东西和看得见的东西对不上，是这类功能唯一不能错的地方，
 * 所以判定只留一份，并且放进离线冒烟里钉死（scripts/smoke.ts）。
 *
 * 搜索的底稿是**用户自己说过的话**（`messages` 里的 user 消息），不是模型消息：
 * 否则「生成」「版本」这种词几乎会让每个项目都命中，搜了等于没搜。
 */

/** 引擎筛选。empty 是"还没生成过"这个真实状态，不并进"全部"。 */
export type EngineFilter = 'all' | 'demo' | 'model' | 'empty'
export type ProjectSort = 'recent' | 'created' | 'versions' | 'name'

export interface ProjectQuery {
  query: string
  starredOnly: boolean
  engine: EngineFilter
  sort: ProjectSort
}

export const DEFAULT_QUERY: ProjectQuery = {
  query: '',
  starredOnly: false,
  engine: 'all',
  sort: 'recent',
}

export interface SearchHit {
  /** 命中来自哪一版（那句话没有对应存档时为 null） */
  versionIndex: number | null
  /** 命中的那句原文 */
  text: string
}

export interface ProjectRow {
  project: Project
  /**
   * 命中的那句话**不在卡片上显示时**才给出来，用来如实说明"它为什么能被搜到"。
   * 名字命中、或者命中的就是卡片上正显示的那句需求 → 是 null：
   * 别去提示用户看已经看得见的东西。
   */
  hit: SearchHit | null
}

/** 卡片上的"当前版"：选中的那一版，否则最后一版。和 Workbench 的取值保持一致。 */
export function currentVersionOf(p: Project): AppVersion | undefined {
  return p.versions.find((v) => v.id === p.currentVersionId) ?? p.versions[p.versions.length - 1]
}

export function engineOf(p: Project): Exclude<EngineFilter, 'all'> {
  const v = currentVersionOf(p)
  if (!v) return 'empty'
  return v.source === 'llm' ? 'model' : 'demo'
}

export function isFiltering(q: ProjectQuery): boolean {
  return q.query.trim().length > 0 || q.starredOnly || q.engine !== 'all'
}

type HitLookup = { matched: false } | { matched: true; hit: SearchHit | null }

/**
 * 从"你说过的话"里找**最新**的那次命中。
 * 底稿用用户消息而不是版本 prompt，是为了覆盖"说了但没生成成功"的那句话；
 * 版本号再按 prompt 反查，好在卡片上如实说明命中在哪一版（反查不到就如实说没有版本）。
 */
function findHit(project: Project, needle: string, visiblePrompt: string): HitLookup {
  for (let i = project.messages.length - 1; i >= 0; i--) {
    const m = project.messages[i]!
    if (m.role !== 'user') continue
    if (!m.content.toLowerCase().includes(needle)) continue
    if (m.content === visiblePrompt) return { matched: true, hit: null }
    for (let j = project.versions.length - 1; j >= 0; j--) {
      const v = project.versions[j]!
      if (v.prompt === m.content) return { matched: true, hit: { versionIndex: v.index, text: m.content } }
    }
    return { matched: true, hit: { versionIndex: null, text: m.content } }
  }
  return { matched: false }
}

function sortRows(rows: ProjectRow[], sort: ProjectSort): ProjectRow[] {
  const out = [...rows]
  switch (sort) {
    case 'created':
      out.sort((a, b) => b.project.createdAt - a.project.createdAt)
      break
    case 'versions':
      out.sort(
        (a, b) => b.project.versions.length - a.project.versions.length || b.project.updatedAt - a.project.updatedAt,
      )
      break
    case 'name':
      out.sort((a, b) => a.project.name.localeCompare(b.project.name, 'zh-CN'))
      break
    default:
      /* 默认顺序 = 收藏置顶 + 最近更新，和这个列表一直以来的顺序一致。
         用户显式选了别的排序就不再让收藏插队 —— 那是他要的顺序，不是我们的。 */
      out.sort((a, b) => Number(b.project.starred) - Number(a.project.starred) || b.project.updatedAt - a.project.updatedAt)
  }
  return out
}

/** 搜索 + 筛选 + 排序，一次算完。空筛选等于"原样返回，但排好序"。 */
export function filterProjects(projects: Project[], q: ProjectQuery): ProjectRow[] {
  const needle = q.query.trim().toLowerCase()
  const rows: ProjectRow[] = []

  for (const project of projects) {
    if (q.starredOnly && !project.starred) continue
    if (q.engine !== 'all' && engineOf(project) !== q.engine) continue

    if (!needle) {
      rows.push({ project, hit: null })
      continue
    }

    if (project.name.toLowerCase().includes(needle)) {
      rows.push({ project, hit: null })
      continue
    }

    const found = findHit(project, needle, currentVersionOf(project)?.prompt ?? '')
    if (!found.matched) continue
    rows.push({ project, hit: found.hit })
  }

  return sortRows(rows, q.sort)
}

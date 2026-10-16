import type { GenStep } from '../types'
import { applyEnhancements, describeEnhancements } from './enhance'
import { deriveAccent, deriveTheme, deriveTitle } from './intent'
import { matchTemplate } from './templates'

export interface DemoResult {
  html: string
  note: string
  title: string
  templateId: string
  templateName: string
  hits: string[]
}

/**
 * 演示模式：不依赖任何外部服务，用内置模板库产出一个真实可运行的 app。
 * 这是"开箱即测"的兜底路径 —— 招聘方点开在线链接，不配 Key 也能立刻看到东西。
 */
export function generateDemo(prompt: string, revision = 0, previousHtml?: string): DemoResult {
  const match = matchTemplate(prompt)
  const title = deriveTitle(prompt)
  const accent = deriveAccent(prompt)
  const theme = deriveTheme(prompt)

  // 迭代时在上一版上做增量增强，而不是重新套一遍模板 —— 否则"改一版"会得到一模一样的产物
  const iterating = revision > 0 && !!previousHtml
  const built = match.template.build({ prompt, title, accent, theme })
  const enhanced = iterating ? applyEnhancements(previousHtml, prompt, revision) : null
  const html = enhanced?.html ?? built

  const hitNote =
    match.hits.length > 0 ? `命中关键词 ${match.hits.map((h) => `「${h}」`).join('')}` : '没有命中专用模板，退回通用工作台'

  return {
    html,
    title,
    templateId: match.template.id,
    templateName: match.template.name,
    hits: match.hits,
    note: (iterating
      ? [
          `演示引擎 · 在第 ${revision} 版产物上做增量增强`,
          describeEnhancements(enhanced!),
          '产物基于上一版，未重新套模板',
        ]
      : [
          `演示引擎 · 模板「${match.template.name}」`,
          hitNote,
          `主题 ${theme === 'dark' ? '暗色' : '亮色'} / 主色 ${accent}`,
          match.template.describes,
        ]
    ).join(' · '),
  }
}

/** 演示模式支持的场景，用于首页示例卡片。 */
export const DEMO_SHOWCASE = [
  { label: '贪吃蛇小游戏', prompt: '做一个可玩的贪吃蛇小游戏，方向键控制，要有最高分记录' },
  { label: '番茄钟 + 任务清单', prompt: '做一个番茄钟，25 分钟专注加 5 分钟休息，下面带今日任务清单' },
  { label: '带分类和图表的记账本', prompt: '做一个记账本，记录收支，按分类汇总并显示占比图' },
  { label: '待办清单', prompt: '做一个待办清单，能筛选未完成和已完成，统计完成率' },
  { label: '通用管理工作台', prompt: '做一个后台管理工作台，能增删改查条目并看分类统计' },
]

/** 目标形态：命中模板的示意图，用于生成中的步骤文案。 */
export function describeTarget(prompt: string): string {
  const match = matchTemplate(prompt)
  return match.hits.length > 0 ? match.template.name : '通用工作台'
}

export function planDemoSteps(prompt: string, iterating: boolean): GenStep[] {
  const match = matchTemplate(prompt)
  const title = deriveTitle(prompt)
  return [
    {
      title: '解析需求',
      detail: `从「${title}」中提取场景、交互与数据结构${
        match.hits.length > 0 ? `，命中模板：${match.template.name}` : '，未命中专用模板，走通用工作台'
      }`,
      weight: 1,
    },
    {
      title: '设计结构',
      detail: `确定页面分区、状态模型与持久化方案（${match.template.describes}）`,
      weight: 1.2,
    },
    {
      title: '生成代码',
      detail: `写出单文件 HTML / CSS / JS，零外部依赖，可直接在沙箱中运行`,
      weight: 2,
    },
    {
      title: '自检',
      detail: '检查 DOM 挂载点、事件绑定、存储降级与响应式布局',
      weight: 0.8,
    },
    {
      title: iterating ? '刷新预览' : '装载预览',
      detail: '把产物注入沙箱 iframe 并执行',
      weight: 0.6,
    },
  ]
}

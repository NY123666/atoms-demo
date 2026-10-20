import type { BuildCtx } from './shared'
import { buildTodo } from './todo'
import { buildSnake } from './snake'
import { buildBoard2048 } from './board2048'
import { buildLedger } from './ledger'
import { buildPomodoro } from './pomodoro'
import { buildDashboard } from './dashboard'

export interface TemplateDef {
  id: string
  name: string
  /** 命中关键词，分数越高越优先 */
  keywords: string[]
  build: (ctx: BuildCtx) => string
  /** 给用户看的落点说明 */
  describes: string
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'snake',
    name: '贪吃蛇小游戏',
    keywords: ['贪吃蛇', 'snake', '小游戏', '游戏', 'game', 'canvas', '街机'],
    build: buildSnake,
    describes: 'Canvas 渲染的游戏循环 + 键盘与触屏双输入 + 最高分持久化',
  },
  {
    id: 'board2048',
    name: '数字棋盘（2048 类）',
    /* 「方块」「棋盘」这类词要小心：宽泛到能抢走别的需求就得不偿失了，
       所以这里不放光秃秃的「数字」「合并」——"把两张表合并"必须还留给通用工作台。 */
    keywords: ['2048', '数字合并', '合并数字', '合并方块', '数字方块', '数字棋盘', '棋盘', '方块', '数字游戏', '益智'],
    build: buildBoard2048,
    describes: '背景格与数字块共用一套坐标 + 容器尺寸量出来后再算字号 + 合并/计分/最高分持久化',
  },
  {
    id: 'pomodoro',
    name: '番茄钟',
    keywords: ['番茄', 'pomodoro', '专注', '计时', '倒计时', 'timer', '时钟', '时间管理'],
    build: buildPomodoro,
    describes: 'SVG 环形进度计时器 + 三种时长模式 + 音效提醒 + 任务清单',
  },
  {
    id: 'ledger',
    name: '记账本',
    keywords: ['记账', '账本', '收支', '财务', '花销', '花费', '预算', '消费', '账单', 'money'],
    build: buildLedger,
    describes: '收支流水 + 分类聚合 + 占比图 + JSON 导出',
  },
  {
    id: 'todo',
    name: '待办清单',
    keywords: ['待办', 'todo', '清单', '任务', '打卡', 'checklist', '提醒', 'todolist'],
    build: buildTodo,
    describes: '增删改查 + 三态筛选 + 完成度进度条 + 本地持久化',
  },
  {
    id: 'dashboard',
    name: '通用管理工作台',
    keywords: ['管理', '后台', '看板', '仪表盘', 'dashboard', '表格', '系统', '数据', '统计', '列表'],
    build: buildDashboard,
    describes: 'KPI 概览 + 表格增删改查 + 状态流转 + 搜索筛选 + 分类分布图',
  },
]

const FALLBACK = TEMPLATES[TEMPLATES.length - 1]!

export interface MatchResult {
  template: TemplateDef
  /** 命中的关键词，空数组表示退到兜底模板 */
  hits: string[]
}

export function matchTemplate(prompt: string): MatchResult {
  const lower = prompt.toLowerCase()
  let best: MatchResult = { template: FALLBACK, hits: [] }
  let bestScore = 0

  for (const t of TEMPLATES) {
    const hits = t.keywords.filter((k) => lower.includes(k.toLowerCase()))
    if (hits.length === 0) continue
    // 关键词越长越具体，权重更高
    const score = hits.reduce((s, k) => s + k.length, 0) + hits.length * 2
    if (score > bestScore) {
      bestScore = score
      best = { template: t, hits }
    }
  }
  return best
}

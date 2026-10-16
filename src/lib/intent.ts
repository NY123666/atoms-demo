/** 从自然语言里抽取一点确定性的东西（标题、主色、明暗），让生成物看起来是"为这句话定制的"。 */

const ACCENTS: { hex: string; words: string[] }[] = [
  { hex: '#6d5cff', words: ['紫', 'violet', 'purple'] },
  { hex: '#3b82f6', words: ['蓝', 'blue'] },
  { hex: '#10b981', words: ['绿', 'green', '青草'] },
  { hex: '#ec4899', words: ['粉', 'pink', '红', 'red'] },
  { hex: '#f59e0b', words: ['橙', 'orange', '黄', 'yellow', '金'] },
  { hex: '#06b6d4', words: ['青', 'cyan', 'teal', '蓝绿'] },
]

export function deriveAccent(prompt: string): string {
  const lower = prompt.toLowerCase()
  for (const a of ACCENTS) {
    if (a.words.some((w) => lower.includes(w))) return a.hex
  }
  return '#6d5cff'
}

export function deriveTheme(prompt: string): 'dark' | 'light' {
  const lower = prompt.toLowerCase()
  if (/(浅色|亮色|白天|白色背景|light\s*theme|light mode)/.test(lower)) return 'light'
  if (/(暗色|深色|夜间|黑色背景|dark\s*theme|dark mode)/.test(lower)) return 'dark'
  return 'dark'
}

const FILLERS = [
  /^请\s*/,
  /^帮我\s*/,
  /^帮忙\s*/,
  /^我想\s*/,
  /^我要\s*/,
  /^给我\s*/,
  /^来个\s*/,
  /^做一个\s*/,
  /^做个\s*/,
  /^生成一个\s*/,
  /^生成\s*/,
  /^写一个\s*/,
  /^创建一个\s*/,
  /^设计一个\s*/,
  /^做\s*/,
]

/** 把"帮我做一个可玩的贪吃蛇小游戏"压成"可玩的贪吃蛇小游戏"。 */
export function deriveTitle(prompt: string): string {
  let t = prompt.trim().split(/[\n。；;！!]/)[0] ?? ''
  let changed = true
  while (changed) {
    changed = false
    for (const re of FILLERS) {
      const next = t.replace(re, '')
      if (next !== t) {
        t = next
        changed = true
      }
    }
  }
  t = t.replace(/[，,、\s]+$/, '').trim()
  if (!t) return '我的应用'
  return t.length > 18 ? `${t.slice(0, 18)}…` : t
}

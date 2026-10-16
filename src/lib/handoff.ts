/**
 * 首页 → 工作台的一次性交接：首页收集到的第一句需求，交给工作台自动开跑。
 * 用 sessionStorage 而不是 URL，是为了让地址栏保持干净可收藏。
 */
const KEY = 'forge:handoff'

interface Handoff {
  projectId: string
  prompt: string
}

export function setHandoff(projectId: string, prompt: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ projectId, prompt } satisfies Handoff))
  } catch {
    /* 隐私模式下不可用，工作台会退化为等待手动输入 */
  }
}

export function takeHandoff(projectId: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Handoff
    if (parsed.projectId !== projectId || !parsed.prompt) return null
    sessionStorage.removeItem(KEY)
    return parsed.prompt
  } catch {
    return null
  }
}

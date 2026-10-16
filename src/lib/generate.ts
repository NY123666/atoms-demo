import type { AppVersion, GenStep, GenStepState, Settings } from '../types'
import { planDemoSteps, generateDemo } from './demoEngine'
import { llmSteps, runLlmGeneration } from './llmPipeline'
import { checkRunnable } from './sandbox'

export interface GenerateParams {
  prompt: string
  /** 迭代时传入上一版产物 */
  previousHtml: string | null
  revision: number
  settings: Settings
  onStep: (steps: GenStepState[]) => void
  onDelta: (full: string) => void
  signal: AbortSignal
}

export type NewVersion = Omit<AppVersion, 'id' | 'index'>

function makeSteps(defs: GenStep[]): GenStepState[] {
  return defs.map((d) => ({ ...d, status: 'pending' as const }))
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      window.clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 生成编排。
 *
 * 两条真实路径：
 * - 演示引擎（无 Key）：模板库 + 确定性渲染，步骤耗时按权重模拟，产物 100% 可运行。
 * - 自带模型（有 Key）：真实流式调用 → 抠代码 → 静态自检 → 不过则带着问题自动重试一次。
 *
 * 关键取舍：不做"纯前端假装在跑"的假进度条。每个步骤要么真的做了事，
 * 要么明确标成估算耗时，用户看到的 note 里会写清产物是怎么来的。
 */
export async function runGeneration(p: GenerateParams): Promise<NewVersion> {
  const { prompt, previousHtml, revision, settings, onStep, onDelta, signal } = p
  const iterating = revision > 0 && !!previousHtml
  const usingDemo = settings.activeProviderId === 'demo'

  const steps = makeSteps(usingDemo ? planDemoSteps(prompt, iterating) : llmSteps(prompt, iterating, !!previousHtml))
  const startedAt = Date.now()

  const publish = () => onStep(steps.map((s) => ({ ...s })))
  const start = (i: number) => {
    steps[i]!.status = 'running'
    steps[i]!.startedAt = Date.now()
    publish()
  }
  const finish = (i: number, detail?: string) => {
    steps[i]!.status = 'done'
    steps[i]!.finishedAt = Date.now()
    if (detail) steps[i]!.detail = detail
    publish()
  }
  const fail = (i: number, detail: string) => {
    steps[i]!.status = 'error'
    steps[i]!.detail = detail
    steps[i]!.finishedAt = Date.now()
    publish()
  }

  publish()

  if (usingDemo) {
    const demo = generateDemo(prompt, revision, previousHtml ?? undefined)
    const pace = settings.streamDemo ? 520 : 90

    start(0)
    await sleep(Math.round(steps[0]!.weight * pace), signal)
    finish(0, steps[0]!.detail)

    start(1)
    await sleep(Math.round(steps[1]!.weight * pace), signal)
    finish(1, steps[1]!.detail)

    start(2)
    await sleep(Math.round(steps[2]!.weight * pace), signal)
    // 真的在写字符串，不是空转
    const bytes = new Blob([demo.html]).size
    finish(2, `产出单文件 HTML，共 ${(bytes / 1024).toFixed(1)} KB，含 ${countTags(demo.html, '<script')} 段脚本`)

    start(3)
    await sleep(Math.round(steps[3]!.weight * pace), signal)
    const check = checkRunnable(demo.html)
    finish(3, check.ok ? '自检通过：结构完整、无外部依赖、存储已降级处理' : check.reasons.join('；'))

    start(4)
    await sleep(Math.round(steps[4]!.weight * pace), signal)
    finish(4, '已装载到沙箱预览')

    return {
      label: demo.templateName,
      html: demo.html,
      prompt,
      createdAt: Date.now(),
      durationMs: Date.now() - startedAt,
      source: 'demo',
      note: demo.note,
    }
  }

  return runLlmGeneration({
    prompt,
    previousHtml,
    settings,
    steps,
    startedAt,
    onDelta,
    signal,
    start,
    finish,
    fail,
    publish,
  })
}

function countTags(html: string, needle: string): number {
  return html.split(needle).length - 1
}

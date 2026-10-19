import type { GenStep, GenStepState } from '../types'
import { getHostedStatus } from './hosted'
import { deriveTitle } from './intent'
import { streamChat } from './llm'
import { buildGeneratePrompt, buildIteratePrompt, SYSTEM_PROMPT } from './prompt'
import { HOSTED_PROVIDER_ID, STATION_PROVIDER_ID, findProvider } from './providers'
import { checkRunnable, extractHtml } from './sandbox'
import { stationApiKey, stationBaseUrl, stationModel } from './station'
import type { NewVersion, GenerateParams } from './generate'

export function llmSteps(prompt: string, iterating: boolean, hasPrev: boolean): GenStep[] {
  return [
    {
      title: '解析需求',
      detail: `提取「${deriveTitle(prompt)}」的场景、交互与数据要求`,
      weight: 0.6,
    },
    {
      title: '组装上下文',
      detail: hasPrev
        ? `载入上一版产物作为基线，拼装改造指令与系统约束`
        : `拼装系统约束（单文件、零外部依赖、必须可交互、存储需降级）`,
      weight: 0.6,
    },
    {
      title: iterating ? '调用模型改造' : '调用模型生成',
      detail: '流式接收模型输出',
      weight: 3,
    },
    {
      title: '抽取产物',
      detail: '从回复中定位完整的 HTML 文档，过滤解释性文字',
      weight: 0.6,
    },
    {
      title: '静态自检',
      detail: '检查文档结构、外部依赖与标签闭合',
      weight: 0.7,
    },
    {
      title: '装载预览',
      detail: '注入沙箱探针并执行',
      weight: 0.5,
    },
  ]
}

export interface LlmPipelineParams extends Omit<GenerateParams, 'revision' | 'onStep'> {
  steps: GenStepState[]
  startedAt: number
  start: (i: number) => void
  finish: (i: number, detail?: string) => void
  fail: (i: number, detail: string) => void
  publish: () => void
}

export async function runLlmGeneration(p: LlmPipelineParams): Promise<NewVersion> {
  const { start, finish, fail, prompt, previousHtml, settings, onDelta, signal } = p

  const providerId = settings.activeProviderId
  const provider = findProvider(providerId)
  const stored = settings.providers[providerId]
  const isHosted = providerId === HOSTED_PROVIDER_ID
  const isStation = providerId === STATION_PROVIDER_ID
  const hosted = getHostedStatus()

  /*
   * 三种"非自带 Key"模式的区别都收在这三行里：
   *   - 托管代理：baseUrl 指向代理，apiKey 空（Key 在服务端），model 以服务端回报为准；
   *   - 本站内置：baseUrl/apiKey/model 全部来自**构建期**变量（Key 在包里，见 lib/station.ts）；
   *   - 自带 Key：三者都来自访客自己的设置。
   * 下面的抽取 / 自检 / 自动修复整条流水线完全复用 —— 这也是当初全部走 OpenAI 兼容协议换来的。
   */
  const apiKey = isHosted
    ? ''
    : isStation
      ? stationApiKey()
      : (stored?.apiKey?.trim() ?? '')
  const baseUrl = isHosted
    ? hosted.chatBase
    : isStation
      ? stationBaseUrl()
      : (stored?.baseUrl?.trim() || provider.baseUrl).trim()
  // 托管模式下模型名由服务端决定（前端传什么都可能被代理改写），所以以探测结果为唯一来源
  const model = (
    isHosted
      ? (hosted.model ?? '')
      : isStation
        ? stationModel()
        : stored?.model?.trim() || provider.models[0] || ''
  ).trim()

  if (isHosted) {
    /*
     * 探测结论已经明确说"这场用不了"（额度用完 / 站长没配上游 Key）时，直接把这句人话抛出去，
     * 不先把请求打到代理上换一个 429 回来。理由有两个：
     *   1) 那一次往返是白花的 —— 而且如果只是"全站额度被用光"，它本来就不会成功；
     *   2) 429 的错误体要再绕一层（llm.ts 的 `模型服务返回 429：…`）才有人话，文案比这里差。
     * 注意只拦这两种**已知的**降级：unknown/checking 是"还没探完"，那时放行更安全 ——
     * 用户可能在开机探测结束前就点了生成，凭一个"还没探"把它拦下来会变成莫名其妙的失败。
     */
    if (hosted.state === 'exhausted' || hosted.state === 'unconfigured') {
      throw new Error(
        `${hosted.message} 可以在右上角「模型设置」里切换到内置演示引擎或自带 Key 的模型，也可以过一会儿再试。`,
      )
    }
    if (!baseUrl) {
      throw new Error('托管代理当前不可用。请在右上角「模型设置」里重新检测，或切回内置演示引擎。')
    }
  } else if (isStation && !apiKey) {
    /*
     * 必须有这一支，不能让它掉进下面那句通用报错里。
     * 通用的那句是"请在设置里填写 API Key"—— 可这张卡片上没有输入框，访客填不了。
     * 出现这种情况只有一种原因：界面还留在"有内置模型"的版本，而这次构建没注入 Key
     * （多半是站长撤了）。App 的开机策略会在下次刷新时把他送回去，这里给出同样的指引。
     */
    throw new Error('这一版没有内置本站的模型 Key。请在右上角「模型设置」里切回内置演示引擎，或配置自己的 API Key。')
  } else if (!apiKey) {
    throw new Error(`还没配置「${provider.name}」的 API Key。请在右上角「模型设置」里填写，或切回内置演示引擎。`)
  }

  // 步骤 0：解析需求
  start(0)
  const title = deriveTitle(prompt)
  const intent = inferIntent(prompt)
  finish(0, `识别为「${intent.kind}」类需求，关键交互：${intent.signals.join('、') || '通用增删改查'}`)

  // 步骤 1：组装上下文
  start(1)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: previousHtml ? buildIteratePrompt(prompt, previousHtml) : buildGeneratePrompt(prompt),
    },
  ]
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0)
  finish(
   1,
    `${provider.name} / ${model} · 上下文 ${promptChars} 字符${
      previousHtml ? ` · 基线产物 ${(previousHtml.length / 1024).toFixed(1)} KB` : ''
    }`,
  )

  // 步骤 2：调用模型（真实流式）
  start(2)
  const callStarted = Date.now()
  let result = await streamChat({ baseUrl, apiKey, model, messages, signal, onDelta: (_c, full) => onDelta(full) })
  const firstLatency = Date.now() - callStarted
  finish(2, `耗时 ${(firstLatency / 1000).toFixed(1)}s · 输出 ${result.text.length} 字符${result.tokens ? ` · ${result.tokens} tokens` : ''}`)

  // 步骤 3：抽取产物
  start(3)
  let extracted = extractHtml(result.text)
  if (!extracted.html) {
    fail(3, '没能从模型回复里找到 HTML 文档')
    throw new Error('模型这次没有返回可用的 HTML。可以重试一次，或换一个更擅长写代码的模型。')
  }
  finish(3, `抽取策略：${strategyLabel(extracted.strategy)} · ${(extracted.html.length / 1024).toFixed(1)} KB`)

  // 步骤 4：静态自检（不过则带着问题自动重试一次）
  start(4)
  let check = checkRunnable(extracted.html)
  let autoFixed = false
  let tokens = result.tokens
  let repairMs = 0

  if (!check.ok && settings.autoFix) {
    fail(4, `自检发现问题：${check.reasons.join('；')} —— 正在自动修复`)
    const repairMessages = [
      ...messages,
      { role: 'assistant' as const, content: result.text },
      {
        role: 'user' as const,
        content: `这份产物没有通过自检，问题如下：\n${check.reasons
          .map((r) => `- ${r}`)
          .join('\n')}\n\n请修正这些问题，重新输出完整的单文件 HTML（放在 \`\`\`html 代码块里），不要解释。`,
      },
    ]
    const repairStarted = Date.now()
    result = await streamChat({
      baseUrl,
      apiKey,
      model,
      messages: repairMessages,
      signal,
      onDelta: (_c, full) => onDelta(full),
    })
    repairMs = Date.now() - repairStarted
    tokens = result.tokens ?? tokens
    const second = extractHtml(result.text)
    if (second.html) {
      extracted = second
      autoFixed = true
      check = checkRunnable(second.html)
    }
  }

  if (check.ok) {
    finish(
      4,
      autoFixed
        ? `自检通过（第 2 次尝试修复成功，额外耗时 ${(repairMs / 1000).toFixed(1)}s）`
        : '自检通过：结构完整、无外部依赖',
    )
  } else {
    finish(4, `自检仍有提示（产物已装载，可能部分功能异常）：${check.reasons.join('；')}`)
  }

  // 步骤 5：装载预览
  start(5)
  finish(5, '已装载到沙箱预览')

  const finalHtml = extracted.html
  if (!finalHtml) {
    throw new Error('模型返回的内容里没能定位到可用的 HTML 文档。')
  }

  const note = [
    `${provider.name} · ${model}`,
    `全程 ${((Date.now() - p.startedAt) / 1000).toFixed(1)}s`,
    autoFixed ? '触发了 1 次自动修复' : '一次通过自检',
    check.ok ? '' : '自检有告警',
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    label: title || '模型生成',
    html: finalHtml,
    prompt,
    createdAt: Date.now(),
    durationMs: Date.now() - p.startedAt,
    source: 'llm',
    providerId,
    model,
    tokens,
    note,
    autoFixed,
  }
}

function strategyLabel(s: 'fenced' | 'document' | 'fragment' | 'raw' | 'none'): string {
  switch (s) {
    case 'fenced':
      return '代码块'
    case 'document':
      return '完整文档'
    case 'fragment':
      return '片段补全为文档'
    default:
      return s
  }
}

const INTENT_RULES: { kind: string; words: string[]; signals: string[] }[] = [
  { kind: '游戏 / 实时渲染', words: ['游戏', 'game', '贪吃蛇', 'canvas', '玩'], signals: ['键盘输入', '游戏循环', '分数持久化'] },
  { kind: '计时 / 专注工具', words: ['番茄', '计时', '倒计时', 'timer', '专注'], signals: ['定时器', '环形进度', '提醒'] },
  { kind: '记账 / 财务', words: ['记账', '账本', '收支', '财务', '预算'], signals: ['金额录入', '分类聚合', '图表'] },
  { kind: '清单 / 任务管理', words: ['待办', 'todo', '清单', '任务', '打卡'], signals: ['增删改查', '状态筛选', '完成度统计'] },
  { kind: '数据 / 后台管理', words: ['管理', '后台', '看板', '仪表盘', '表格', '统计'], signals: ['表格', '筛选搜索', '指标概览'] },
]

function inferIntent(prompt: string): { kind: string; signals: string[] } {
  const lower = prompt.toLowerCase()
  for (const rule of INTENT_RULES) {
    if (rule.words.some((w) => lower.includes(w.toLowerCase()))) {
      return { kind: rule.kind, signals: rule.signals }
    }
  }
  return { kind: '通用网页应用', signals: [] }
}

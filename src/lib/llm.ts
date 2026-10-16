import type { LlmResult } from '../types'

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessagePayload[]
  signal?: AbortSignal
  /** 每收到一段增量内容就回调一次，用于打字机效果 */
  onDelta?: (chunk: string, full: string) => void
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

async function readError(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
      detail = json.error?.message ?? json.message ?? text
    } catch {
      detail = text
    }
  } catch {
    /* 读取失败就用状态码兜底 */
  }
  return detail.slice(0, 400) || `HTTP ${res.status}`
}

/**
 * OpenAI 兼容的流式对话。所有服务商共用这一条路径 —— 这是选型带来的收益：
 * 接入第 8 家服务商只需要在 providers.ts 加一行配置。
 */
export async function streamChat(opts: StreamOptions): Promise<LlmResult> {
  const url = `${normalizeBase(opts.baseUrl)}/chat/completions`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: 0.6,
      }),
      signal: opts.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error(
      `无法连接 ${url}。常见原因：网络不通、Base URL 写错、或浏览器跨域（CORS）被拦。可在服务商后台确认域名是否需要走代理。`,
    )
  }

  if (!res.ok) {
    throw new Error(`模型服务返回 ${res.status}：${await readError(res)}`)
  }
  if (!res.body) {
    throw new Error('模型服务没有返回流式响应体。')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let tokens: number | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 事件以空行分隔
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''

    for (const rawLine of parts) {
      const line = rawLine.trim()
      if (!line || line.startsWith(':')) continue
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue

      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[]
          usage?: { total_tokens?: number }
        }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          opts.onDelta?.(delta, full)
        }
        if (json.usage?.total_tokens) tokens = json.usage.total_tokens
      } catch {
        // 有些服务商会插入非 JSON 的心跳行，忽略即可
      }
    }
  }

  if (!full.trim()) {
    throw new Error('模型返回了空内容。可以换个模型，或把需求描述得更具体一些。')
  }
  return { text: full, tokens }
}

export interface TestResult {
  ok: boolean
  message: string
  latencyMs: number
}

/** 设置面板里的「测试连接」：一次极小的非流式请求，验证 Key / Base URL / 模型名三件套。 */
export async function testConnection(input: {
  baseUrl: string
  apiKey: string
  model: string
}): Promise<TestResult> {
  const started = performance.now()
  const url = `${normalizeBase(input.baseUrl)}/chat/completions`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
      }),
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) {
      return { ok: false, message: `连接失败（${res.status}）：${await readError(res)}`, latencyMs }
    }
    await res.json()
    return { ok: true, message: `连接成功，配置可用（${latencyMs}ms）`, latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started)
    const hint =
      err instanceof TypeError
        ? '请求被拦截：可能是网络不可达或 CORS。浏览器直连模型服务时，部分服务商不允许跨域。'
        : String(err)
    return { ok: false, message: `连接失败：${hint}`, latencyMs }
  }
}

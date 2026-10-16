/**
 * Forge 托管代理（hosted proxy）—— 让 C 端访客"零配置就能用到真模型"。
 *
 * 为什么必须有服务端：浏览器里跑的前端包，任何塞进去的 Key 都是公开的
 * （打开 DevTools 就看得到，抓包也能直接抄走）。所以"产品方出钱"这件事
 * 在纯前端架构里做不到，只能由一个代理进程拿着服务端的 Key 转发。
 *
 * 这个文件是**平台无关**的核心：只用 Web 标准（Request / Response / fetch / ReadableStream），
 * 因此同一份逻辑能直接挂在 Vercel Edge、Cloudflare Workers、Deno、Bun，
 * 或者任何一个实现了 fetch API 的 Node 20+ 进程上。各平台的入口只是薄薄一层 adapter：
 *   - Vercel Edge   → ./api/health.js、./api/chat/completions.js
 *   - Cloudflare    → ./server/worker.mjs
 *
 * 三条硬约束（部署时请照着检查）：
 *   1. UPSTREAM_API_KEY 只存在于服务端环境变量里，永远不进浏览器、不进日志。
 *   2. 模型名和 max_tokens 由服务端强制，前端说什么都不算 —— 否则一次请求就能烧掉整天的预算。
 *   3. 有配额上限（按 IP + 全局每日），超了返回 429 并明确告诉用户可以退回内置演示引擎。
 */
import { createMemoryStore } from './memory-store.mjs'

/** 默认值就是"便宜、且写 HTML 写得好"的那一家。换供应商只改环境变量，不改代码。 */
export const HOSTED_DEFAULTS = {
  upstreamBase: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  /** 单 IP 每天能白嫖几次 */
  dailyPerIp: 20,
  /** 全体访客每天总共能白嫖几次（这就是每天的账单上限） */
  dailyGlobal: 200,
  /** 单次请求允许的最大"提示词+上文"字符数 */
  maxPromptChars: 60000,
  /** 单次响应允许的最大 token 数 */
  maxTokens: 8000,
  /** 默认放开跨域：这个代理本来就是给公开的静态站用的 */
  allowedOrigins: '*',
  /** 等上游**响应头**的超时（不是总时长上限，理由见 chat 里的注释） */
  timeoutMs: 120000,
}

const ROLES = new Set(['system', 'user', 'assistant'])

/** 环境变量读成配置。字符串→数字的转换集中在一处，免得每个 adapter 各写一遍。 */
export function readConfig(env = {}) {
  const num = (raw, fallback) => {
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
  }
  return {
    upstreamBase: (env.UPSTREAM_BASE_URL || HOSTED_DEFAULTS.upstreamBase).replace(/\/+$/, ''),
    upstreamKey: (env.UPSTREAM_API_KEY || '').trim(),
    model: (env.UPSTREAM_MODEL || HOSTED_DEFAULTS.model).trim(),
    dailyPerIp: num(env.HOSTED_DAILY_PER_IP, HOSTED_DEFAULTS.dailyPerIp),
    dailyGlobal: num(env.HOSTED_DAILY_GLOBAL, HOSTED_DEFAULTS.dailyGlobal),
    maxPromptChars: num(env.HOSTED_MAX_PROMPT_CHARS, HOSTED_DEFAULTS.maxPromptChars),
    maxTokens: num(env.HOSTED_MAX_TOKENS, HOSTED_DEFAULTS.maxTokens),
    allowedOrigins: (env.HOSTED_ALLOWED_ORIGINS || HOSTED_DEFAULTS.allowedOrigins).trim(),
    timeoutMs: num(env.HOSTED_TIMEOUT_MS, HOSTED_DEFAULTS.timeoutMs),
  }
}

/** OpenAI 形状的错误体，前端 llm.ts 里那套解析能直接认出来。 */
function apiError(status, message, code, extra = {}) {
  return json({ error: { message, type: 'hosted_proxy_error', code, ...extra } }, status)
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

/** 走代理的请求都要带这几个头，包括错误响应（不然浏览器只报一句看不懂的 CORS）。 */
function corsHeaders(origin, allowed) {
  if (allowed === '*') return { 'access-control-allow-origin': '*' }
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean)
  if (origin && list.includes(origin)) {
    return { 'access-control-allow-origin': origin, vary: 'origin' }
  }
  // 白名单模式下一个都不匹配：不回 ACAO，浏览器自己会拦下来 —— 这正是白名单的语义。
  return { vary: 'origin' }
}

function preflight(origin, allowed) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allowed),
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  })
}

/**
 * 访客 IP：各平台的取值头不一样，按可靠性从高到低试。
 * 拿不到就归到 'unknown' —— 宁可把这些人算成同一个 IP（会更快撞到配额上限），
 * 也不要因为"没有 IP 就放行"而把限流变成摆设。
 */
function clientIp(request) {
  const header = (name) => (request.headers.get(name) || '').trim()
  const cf = header('cf-connecting-ip')
  if (cf) return cf
  const real = header('x-real-ip')
  if (real) return real
  const fwd = header('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return 'unknown'
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 校验请求体。
 * 顺带把客户端可能塞进来的 `model`、`stream` 之外的字段全部丢掉 —— 白名单比黑名单安全：
 * 上游新增什么危险参数（比如某些网关的 `provider` / `logprobs`）也不会被这次转发捎带过去。
 */
function validateIncoming(raw, config) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '请求体必须是一个 JSON 对象' }
  }
  const messages = raw.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages 必须是非空数组' }
  }
  if (messages.length > 64) return { error: '对话轮数太多（上限 64 条）' }
  let chars = 0
  const cleaned = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') return { error: 'messages 里的每一项都必须是对象' }
    const role = String(m.role || '')
    if (!ROLES.has(role)) return { error: `不支持的角色：${role || '(空)'}` }
    if (typeof m.content !== 'string') return { error: 'messages 里每一项的 content 必须是字符串' }
    chars += m.content.length
    cleaned.push({ role, content: m.content })
  }
  if (chars > config.maxPromptChars) {
    return {
      error: `提示词太长了（${chars} 字，上限 ${config.maxPromptChars} 字）。请把需求描述精简一些再试。`,
      code: 'prompt_too_long',
    }
  }
  const temperature =
    typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)
      ? Math.min(Math.max(raw.temperature, 0), 1.5)
      : 0.6
  return {
    value: {
      messages: cleaned,
      chars,
      temperature,
      // 只有客户端**明确**要流式才流式：设置页的「测试连接」是不带 stream 发过来的，
      // 它期待一个 JSON 体。这里顺着客户端的意图走，比无条件强推流式更不容易出意外。
      stream: raw.stream === true,
      // max_tokens 取小不取大：客户端要大值也没用，预算是产品方的。
      maxTokens: Math.min(
        typeof raw.max_tokens === 'number' && Number.isFinite(raw.max_tokens) && raw.max_tokens > 0
          ? Math.floor(raw.max_tokens)
          : config.maxTokens,
        config.maxTokens,
      ),
    },
  }
}

/** 日志永远不带 Key。这里再兜一层：万一上游把 Key 回显在报错里，也别原样打出来。 */
function makeLogger(config, out) {
  const redact = (text) =>
    config.upstreamKey ? String(text).split(config.upstreamKey).join('[redacted]') : String(text)
  return (...parts) => {
    if (!out) return
    out('[forge-hosted]', ...parts.map(redact))
  }
}

/**
 * 建一个 handler。所有外部依赖都是注入的，所以测试里可以塞假的上游 fetch、假时钟、假存储。
 *
 * @param {object}  opts
 * @param {object} [opts.env]        环境变量（Vercel 是 process.env，Workers 是入参 env）
 * @param {object} [opts.store]      限流计数存储，需实现 {@link createMemoryStore} 的接口
 * @param {() => number} [opts.now]  时钟，测试里可以随便拨
 * @param {Function} [opts.fetchImpl] fetch 实现
 * @param {Function} [opts.log]      日志输出（默认 console.error）
 */
export function createHostedHandler(opts = {}) {
  const config = readConfig(opts.env || {})
  const store = opts.store || createMemoryStore()
  const now = opts.now || (() => Date.now())
  const fetchImpl = opts.fetchImpl || ((...args) => fetch(...args))
  const log = makeLogger(config, opts.log === undefined ? console.error : opts.log)

  /** 每天开局先算一次"今天"，跨天自动换 key，不需要任何定时任务。 */
  const today = () => dayKey(now())

  function quotaSnapshot(ip) {
    const day = today()
    const usedGlobal = store.peek(day, 'global')
    return {
      day,
      usedGlobal,
      remainingGlobal: Math.max(0, config.dailyGlobal - usedGlobal),
      usedToday: store.peek(day, `ip:${ip}`),
      remainingForYou: Math.max(0, config.dailyPerIp - store.peek(day, `ip:${ip}`)),
    }
  }

  async function health(request, cors) {
    const ip = clientIp(request)
    const q = quotaSnapshot(ip)
    return json(
      {
        ok: true,
        hosted: true,
        // 上游没配 Key 时 health 依然 ok（代理本身活着），但要明确告诉前端"别选我"。
        ready: Boolean(config.upstreamKey),
        model: config.model,
        dailyPerIp: config.dailyPerIp,
        dailyGlobal: config.dailyGlobal,
        usedGlobal: q.usedGlobal,
        remainingGlobal: q.remainingGlobal,
        usedToday: q.usedToday,
        remainingForYou: q.remainingForYou,
        /** 限流存在进程内存里，多实例部署时不共享 —— 这是"尽力而为"的限额，不是硬保证。 */
        sharedLimits: false,
      },
      200,
      cors,
    )
  }

  async function chat(request, cors, url) {
    const ip = clientIp(request)

    if (!config.upstreamKey) {
      return apiError(
        503,
        '这台托管代理还没有配置上游模型 Key（服务端环境变量 UPSTREAM_API_KEY）。请切回「内置演示引擎」，或到「模型设置」里填自己的 API Key。',
        'upstream_not_configured',
      )
    }

    let raw
    try {
      raw = await request.json()
    } catch {
      return apiError(400, '请求体不是合法 JSON', 'bad_json')
    }

    const checked = validateIncoming(raw, config)
    if (checked.error) {
      return apiError(checked.code === 'prompt_too_long' ? 413 : 400, checked.error, checked.code || 'bad_request')
    }

    /*
     * 先扣配额再转发：宁可"请求失败了但已经扣掉一次"，
     * 也不要"转发成功了但计数没加上" —— 后者的账单是会累积的。
     */
    const day = today()
    const before = quotaSnapshot(ip)
    if (before.usedGlobal >= config.dailyGlobal) {
      return apiError(
        429,
        `今天这台代理的免费额度已经用完了（全体访客每天 ${config.dailyGlobal} 次）。可以切回「内置演示引擎」继续体验完整流程，或到「模型设置」里填自己的 API Key。`,
        'global_daily_limit',
        { quota: { ...before, scope: 'global' } },
      )
    }
    if (before.usedToday >= config.dailyPerIp) {
      return apiError(
        429,
        `你今天的免费额度用完了（每人每天 ${config.dailyPerIp} 次）。可以切回「内置演示引擎」继续体验完整流程，或到「模型设置」里填自己的 API Key。`,
        'per_ip_daily_limit',
        { quota: { ...before, scope: 'ip' } },
      )
    }
    store.hit(day, 'global')
    store.hit(day, `ip:${ip}`)

    const body = {
      model: config.model, // 强制服务端模型：客户端指定的 model 一律忽略
      messages: checked.value.messages,
      stream: checked.value.stream,
      temperature: checked.value.temperature,
      max_tokens: checked.value.maxTokens,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    let upstream
    try {
      upstream = await fetchImpl(`${config.upstreamBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.upstreamKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      const aborted = err && err.name === 'AbortError'
      log('上游请求失败', url.pathname, aborted ? 'timeout' : `${err && err.name}`)
      return apiError(
        aborted ? 504 : 502,
        aborted ? '上游模型响应超时，请重试或切回内置演示引擎。' : '连不上上游模型服务，请稍后重试或切回内置演示引擎。',
        aborted ? 'upstream_timeout' : 'upstream_unreachable',
      )
    } finally {
      clearTimeout(timer)
    }

    /*
     * 一拿到响应头就把定时器停掉 —— 这个超时是"多久没**开始**回"的超时，不是总时长上限。
     * 理由：abort 信号在响应头到达之后依然有效，会直接掐断 body 流；而生成一个完整的
     * HTML 应用，正文流上花两三分钟是正常的。如果按总时长算，表现就是"明明模型还在写，
     * 却在中途被截断成半张页面"，而且日志里只会留一句超时，非常难查。
     */
    const upstreamType = upstream.headers.get('content-type') || ''
    if (!upstream.ok) {
      // 上游的错误体可能带诊断信息，也可能带 Key 相关提示 —— 只记日志、只回一句人话给前端。
      const detail = await upstream.text().catch(() => '')
      log('上游返回', upstream.status, detail.slice(0, 500))
      const hint =
        upstream.status === 401 || upstream.status === 403
          ? '托管代理的上游 Key 被拒绝了（多半是配置问题，请联系站长）。'
          : upstream.status === 402
            ? '托管代理的上游账户余额不足，请联系站长。'
            : upstream.status === 429
              ? '上游模型服务正在限流，请稍后重试或切回内置演示引擎。'
              : '上游模型服务返回了错误，请稍后重试或切回内置演示引擎。'
      /* 一律回 502：上游的具体状态码（401/402/500…）是站长该看的信息，不是访客该看的。
         真实状态码留在 upstreamStatus 里，浏览器控制台能看到，排查够用了。 */
      return apiError(502, hint, 'upstream_error', { upstreamStatus: upstream.status })
    }

    if (checked.value.stream) {
      if (!upstream.body) {
        return apiError(502, '上游没有返回数据流，请重试。', 'upstream_no_body')
      }
      // 原样透传 SSE：前端那套逐行解析逻辑（llm.ts）完全不用改。
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...cors,
          'content-type': upstreamType || 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        },
      })
    }

    // 非流式（设置页的「测试连接」走这里）：读完整段 JSON 再返回，同样只透传内容。
    let text
    try {
      text = await upstream.text()
    } catch (err) {
      log('读取上游响应失败', err && err.name)
      return apiError(502, '读取上游响应失败，请重试。', 'upstream_read_failed')
    }
    if (upstreamType && !/json/i.test(upstreamType)) {
      log('上游返回了非 JSON 内容', upstreamType)
      return apiError(502, '上游返回了非预期的内容类型，请重试。', 'upstream_bad_content_type')
    }
    return new Response(text, {
      status: 200,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  /**
   * 唯一的入口。adapter 只管把平台的 request/env 交进来。
   *
   * 这里不做任何"来源白名单"判断 —— CORS 是浏览器侧的保护，不是服务端鉴权，
   * 拿 curl 就能绕过。真正的保护是"每天多少次"这个配额。
   */
  async function handle(request) {
    const url = new URL(request.url)
    const origin = request.headers.get('origin') || ''
    const cors = corsHeaders(origin, config.allowedOrigins)

    if (request.method === 'OPTIONS') return preflight(origin, config.allowedOrigins)

    if (url.pathname === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      return health(request, cors)
    }

    if (url.pathname === '/api/chat/completions' && request.method === 'POST') {
      return chat(request, cors, url)
    }

    return apiError(404, `没有这个接口：${request.method} ${url.pathname}`, 'not_found')
  }

  return { handle, config, store, quotaSnapshot }
}

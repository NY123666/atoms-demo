import { useSyncExternalStore } from 'react'
import { DEMO_PROVIDER_ID, HOSTED_PROVIDER_ID } from './providers'

/**
 * 托管代理的探测与状态。
 *
 * 背景：这是个 C 端应用，上一版只有两条路 —— 内置演示引擎（零配置）和访客自带 Key。
 * 自带 Key 对普通访客来说是一道硬门槛（要注册、要充值、要会填 Base URL），
 * 所以补了第三条：**产品方出钱**的托管代理，访客零配置就能用到真模型。
 *
 * 浏览器里的 Key 一定是公开的（任何访客都能在 DevTools 里读到），
 * 所以托管模式不可能在前端包里实现，必须有一个服务端代理（见 server/hosted-core.mjs）。
 * 这个文件负责"前端怎么知道那个代理在不在、还剩多少次、该往哪发请求"。
 *
 * 探测原则：**宁可判定成不可用，也不能把访客送到一个会报错的选项上**。
 * 因此 /api/health 必须同时满足：HTTP 200、content-type 是 JSON、`ok === true`。
 * 少了 content-type 这一条，静态站自己的 404/SPA 兜底页（返回一张 HTML，状态码 200）
 * 会被当成"代理活着"，访客选完才发现每次生成都失败 —— 这是最典型的假阳性。
 */

export type HostedState =
  /** 还没探测过（首屏之前） */
  | 'unknown'
  /** 正在探测 */
  | 'checking'
  /** 代理活着、上游有 Key、今天还有额度 —— 可以放心用 */
  | 'ready'
  /** 代理活着，但今天的额度用完了 */
  | 'exhausted'
  /** 代理活着，但服务端没配上游 Key（站长的问题，不是访客的） */
  | 'unconfigured'
  /** 没有找到任何可用的代理 */
  | 'offline'

export interface HostedStatus {
  state: HostedState
  /** 代理站点根地址，例如 https://forge-hosted.vercel.app；'' 表示没有可用地址 */
  base: string
  /** 真正用来发对话请求的地址：`${base}/api`（形状和 OpenAI 一致，llm.ts 不用改） */
  chatBase: string
  model?: string
  dailyPerIp?: number
  dailyGlobal?: number
  usedGlobal?: number
  remainingGlobal?: number
  remainingForYou?: number
  /** 服务端的限流是否跨实例共享（内存实现是 false，属于尽力而为的限额） */
  sharedLimits?: boolean
  /** 一句话人话状态，直接给界面用 */
  message: string
  checkedAt: number
}

const UNKNOWN: HostedStatus = {
  state: 'unknown',
  base: '',
  chatBase: '',
  message: '还没检测托管代理。',
  checkedAt: 0,
}

let status: HostedStatus = UNKNOWN
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function setStatus(next: HostedStatus): void {
  status = next
  emit()
}

export function subscribeHosted(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getHostedStatus(): HostedStatus {
  return status
}

/** 组件里这样用：`const hosted = useHosted()` */
export function useHosted(): HostedStatus {
  return useSyncExternalStore(subscribeHosted, getHostedStatus, getHostedStatus)
}

/** 托管模式是否"现在就能用"（会自动切换与否的判断都靠它）。 */
export function hostedUsable(s: HostedStatus = status): boolean {
  return s.state === 'ready' && Boolean(s.chatBase)
}

/**
 * 界面该不该把「托管模型」这个选项列出来。
 * ready 当然要列；exhausted / unconfigured 也要列 —— 昨天用过的人今天看不到它，
 * 只会以为功能被删了，列出来才能讲清"为什么现在不能用、接下来怎么办"。
 * offline / unknown（压根没探到代理）不列：在那种站点上它就是一个点了必然失败的选项。
 */
export function hostedOfferable(s: HostedStatus = status): boolean {
  return s.state === 'ready' || s.state === 'exhausted' || s.state === 'unconfigured'
}

export type HostedDecisionKind =
  /** 什么都不做 */
  | 'none'
  /** 代理可用了，替访客把引擎从演示引擎换成真模型 */
  | 'adopt'
  /** 当前选的托管模型不可用了，退回演示引擎，别让访客卡在必败的选项上 */
  | 'fallback'

export interface HostedDecision {
  kind: HostedDecisionKind
  /** 要切换到的引擎 id；kind === 'none' 时为空 */
  providerId?: string
  /** 切换后给访客看的一句话 */
  message?: string
}

const NO_DECISION: HostedDecision = { kind: 'none' }

/**
 * 「开机探测之后要不要自动换引擎」的全部策略，写成纯函数。
 *
 * 抽出来单独放，是因为这是整个托管模式里唯一**替访客做决定**的地方 ——
 * 它留在组件的 useEffect 里就只能靠手点，抽出来才能被断言覆盖（见 scripts/hosted-client-check.ts）。
 *
 * 两条规则：
 *  1. 代理可用 + 访客从没手动选过引擎 + 当前是演示引擎 → 换成托管模型（这就是 C 端"零配置"）。
 *  2. 当前是托管模型但代理现在不可用（额度用完 / 站长撤了代理）→ 退回演示引擎。
 *
 * `providerChosen` 是红线：访客一旦自己点过「设为当前引擎」，规则 1 就永久失效。
 * 规则 2 不看这条红线 —— 因为它是修错，不是偏好：用户选的东西已经坏了，留在那里只会让他更困惑。
 */
export function decideHostedSwitch(
  found: HostedStatus,
  now: { activeProviderId: string; providerChosen: boolean },
): HostedDecision {
  if (now.activeProviderId === HOSTED_PROVIDER_ID && !hostedUsable(found)) {
    return {
      kind: 'fallback',
      providerId: DEMO_PROVIDER_ID,
      message: `${found.message} 已自动切回内置演示引擎。`,
    }
  }

  if (hostedUsable(found) && now.activeProviderId === DEMO_PROVIDER_ID && !now.providerChosen) {
    return {
      kind: 'adopt',
      providerId: HOSTED_PROVIDER_ID,
      message: `已启用托管模型（${found.model ?? '真模型'}）：由本站付费，你不需要 API Key。`,
    }
  }

  return NO_DECISION
}

/**
 * 把用户/站长填的地址收拾干净。
 * 容忍三种常见粘贴方式：带结尾斜杠、直接粘了 `/api`、甚至粘了完整的 `/api/health`。
 * 与其报错让人猜，不如猜对他想表达的那个站点根地址。
 */
export function normalizeHostedBase(raw: string): string {
  let s = (raw || '').trim().replace(/\s+/g, '')
  if (!s) return ''
  s = s.replace(/\/+$/, '')
  s = s.replace(/\/api\/health$/i, '').replace(/\/api$/i, '')
  return s.replace(/\/+$/, '')
}

/**
 * 候选地址，按可信度排序：
 *   1. 站长在设置里手填的（最高优先，填了就以他为准）
 *   2. 构建期的 VITE_HOSTED_BASE_URL（部署静态站时指定，例如 GitHub Pages + 独立代理）
 *   3. 同源 /api（静态站和代理部署在同一个项目里时的零配置情况）
 *
 * `file://` 打开的**单文件版**没有同源一说（协议不是 http/https），
 * 所以那里只剩前两条；都没有就完全不发请求 —— 双击打开时不该有失败的网络请求。
 */
export function hostedCandidates(input: {
  override?: string
  envBase?: string
  origin?: string
  protocol?: string
}): string[] {
  const out: string[] = []
  const push = (v: string) => {
    const n = normalizeHostedBase(v)
    if (n && !out.includes(n)) out.push(n)
  }
  push(input.override || '')
  push(input.envBase || '')
  const protocol = input.protocol || ''
  if ((protocol === 'http:' || protocol === 'https:') && input.origin) {
    push(`${input.origin}/api`)
  }
  return out
}

/**
 * 构建期注入的代理地址（`VITE_HOSTED_BASE_URL`）。
 * 只在构建时被 Vite 静态替换，所以这里包一层 try —— 同一份代码在 node 里跑测试时读不到，
 * 读不到就当作"没配"，而不是抛异常。地址本身不是秘密（它就是公开的接口地址）。
 */
export function hostedEnvBase(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
    const v = env?.VITE_HOSTED_BASE_URL
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

interface HealthBody {
  ok?: unknown
  ready?: unknown
  model?: unknown
  dailyPerIp?: unknown
  dailyGlobal?: unknown
  usedGlobal?: unknown
  remainingGlobal?: unknown
  remainingForYou?: unknown
  sharedLimits?: unknown
}

export interface ProbeDeps {
  override?: string
  envBase?: string
  origin?: string
  protocol?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export const HOSTED_PROBE_TIMEOUT_MS = 3500

/**
 * 探一次。不抛异常 —— 探测失败是常态（没部署代理），必须变成一个**状态**回给界面，
 * 而不是一个没人接的 rejected promise。
 */
export async function probeHosted(deps: ProbeDeps = {}): Promise<HostedStatus> {
  const candidates = hostedCandidates({
    override: deps.override ?? '',
    envBase: deps.envBase ?? '',
    origin: deps.origin ?? (typeof location === 'undefined' ? '' : location.origin),
    protocol: deps.protocol ?? (typeof location === 'undefined' ? '' : location.protocol),
  })
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? HOSTED_PROBE_TIMEOUT_MS

  if (candidates.length === 0) {
    return {
      ...UNKNOWN,
      state: 'offline',
      message: '当前页面没有可探测的托管代理（单文件版离线打开时属于正常情况）。',
      checkedAt: Date.now(),
    }
  }

  /** 探测到"代理活着但用不了"（没配 Key / 额度用完）时先记下来：
      如果没有任何候选是 ready，就把这条如实告诉用户，而不是笼统地说一句"不可用"。 */
  let sawDegraded: HostedStatus | null = null

  for (const base of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${base}/api/health`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!res.ok) continue

      // 这一条是防"HTML 假阳性"的关键：静态站/SPA 对未知路径会回一张 200 的 HTML。
      const type = res.headers.get('content-type') || ''
      if (!/json/i.test(type)) continue

      const body = (await res.json()) as HealthBody
      if (body?.ok !== true) continue

      const base_ = {
        base,
        chatBase: `${base}/api`,
        model: typeof body.model === 'string' ? body.model : undefined,
        dailyPerIp: numOrUndef(body.dailyPerIp),
        dailyGlobal: numOrUndef(body.dailyGlobal),
        usedGlobal: numOrUndef(body.usedGlobal),
        remainingGlobal: numOrUndef(body.remainingGlobal),
        remainingForYou: numOrUndef(body.remainingForYou),
        sharedLimits: typeof body.sharedLimits === 'boolean' ? body.sharedLimits : undefined,
        checkedAt: Date.now(),
      }

      if (body.ready !== true) {
        // 代理在，但站长还没把上游 Key 配好。继续看后面的候选（比如同源那个是好的）。
        if (!sawDegraded) {
          sawDegraded = {
            ...base_,
            state: 'unconfigured',
            message: '托管代理已部署，但服务端还没配置上游模型的 Key（UPSTREAM_API_KEY）。',
          }
        }
        continue
      }

      const exhausted = body.remainingForYou === 0 || body.remainingGlobal === 0
      if (exhausted) {
        if (!sawDegraded) {
          sawDegraded = {
            ...base_,
            state: 'exhausted',
            message:
              body.remainingGlobal === 0
                ? `今天的公开额度已经用完了（全体访客每天 ${numOrUndef(body.dailyGlobal) ?? '?'} 次）。可以切回内置演示引擎，或填自己的 API Key。`
                : `你今天的免费额度用完了（每人每天 ${numOrUndef(body.dailyPerIp) ?? '?'} 次）。可以切回内置演示引擎，或填自己的 API Key。`,
          }
        }
        continue
      }

      return {
        ...base_,
        state: 'ready',
        message: `托管模型可用（${base_.model ?? '未知模型'}）${
          typeof base_.remainingForYou === 'number' ? `，你今天还剩 ${base_.remainingForYou} 次` : ''
        }`,
      }
    } catch {
      // 超时 / 连不上 / 不是 JSON —— 一律当作这个候选不可用，继续试下一个。
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  return (
    sawDegraded ?? {
      ...UNKNOWN,
      state: 'offline',
      message: '没检测到可用的托管代理，已继续使用内置演示引擎与自带 Key 两条路。',
      checkedAt: Date.now(),
    }
  )
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 探测并把结果写进模块状态。组件用 useHosted() 拿最新的。 */
export async function refreshHosted(deps: ProbeDeps = {}): Promise<HostedStatus> {
  setStatus({ ...status, state: 'checking', message: '正在检测托管代理…' })
  const next = await probeHosted(deps)
  setStatus(next)
  return next
}

/** 站长在设置里改地址时调它。 */
export function resetHostedStatus(): void {
  setStatus(UNKNOWN)
}

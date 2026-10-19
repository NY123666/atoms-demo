import { DEMO_PROVIDER_ID, STATION_PROVIDER_ID } from './providers'

/**
 * 「本站内置模型」—— 把站点自己的 Key 在**构建期**打进前端包，访客点开就能用真模型。
 *
 * 这是一个**有意做出的取舍**，不是疏忽，所以先把账算清楚：
 *
 * 代价：浏览器里的东西一定是公开的。Key 会出现在部署产物里，任何人下载 JS、搜一下
 * `sk-` 就能找到，找到之后就能拿走、无限用，而且**收不回来**。
 * 收益：零账号、零部署、零配置 —— 静态站发上去就生效，不需要任何服务端进程。
 *
 * 与之相对的另一条路是 server/hosted-core.mjs 那个托管代理：Key 留在服务端进程里，
 * 浏览器拿不到，而且有按 IP / 全站的每日上限兜住账单；代价是需要一个能跑进程的地方
 * （Vercel / Workers），GitHub Pages 这种纯静态托管覆盖不了。
 *
 * 既然选了前者，就在实现上尽量把损失控制住：
 *   1. Key 只从**构建期**变量进来（VITE_STATION_API_KEY），源码和 git 历史里都不出现；
 *   2. 不写进 localStorage、不渲染进任何输入框 —— 它不属于访客的设置，只属于这一次构建。
 *      访客在设置页看到的是一张"不需要你填任何东西"的卡片，而不是一个可以复制走的密码框；
 *   3. 想撤，只要构建环境里不给这个变量、重新构建一次即可，不用改任何代码
 *      （见 decideStationSwitch 的 fallback 分支：已经切过来的访客会被自动送回演示引擎）。
 *
 * 读环境变量的写法刻意和 hosted.ts 里的 hostedEnvBase() 保持一致：包一层 try，
 * 因为同一份代码还要在 node 里被冒烟测试直接 import，那里没有 import.meta.env。
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'

/** 只在构建期被 Vite 静态替换；node 里跑测试时读不到，读不到就当作"没配"。 */
function readEnv(name: string): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
    const v = env?.[name]
    return typeof v === 'string' ? v.trim() : ''
  } catch {
    return ''
  }
}

/** 本站预置的 Key。空字符串表示"这一次构建没有内置模型"，整条路径就不该出现。 */
export function stationApiKey(): string {
  return readEnv('VITE_STATION_API_KEY')
}

/** 模型名。默认 DeepSeek，换供应商只改构建期变量。 */
export function stationModel(): string {
  return readEnv('VITE_STATION_MODEL') || DEFAULT_MODEL
}

/** 上游地址。末尾斜杠在这里就去掉，免得和 llm.ts 的 `${base}/chat/completions` 拼出双斜杠。 */
export function stationBaseUrl(): string {
  return (readEnv('VITE_STATION_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/** 这一次构建到底有没有内置模型。界面据此决定列不列这张卡片。 */
export function stationAvailable(): boolean {
  return Boolean(stationApiKey())
}

export type StationDecisionKind =
  /** 什么都不做 */
  | 'none'
  /** 构建里内置了模型，替访客从演示引擎切过去 */
  | 'adopt'
  /** 访客当前用的内置模型在这个版本里没了，退回演示引擎 */
  | 'fallback'

export interface StationDecision {
  kind: StationDecisionKind
  providerId?: string
  message?: string
}

/**
 * 「开机要不要替访客切到本站内置模型」的全部策略，写成纯函数。
 * 和 hosted.ts 的 decideHostedSwitch 是同构的，两条规则也一样：
 *
 *  1. 这次构建内置了 Key + 访客从没手动选过引擎 + 当前是演示引擎 → 切过去（这就是"点开就能用"）。
 *  2. 当前用的是内置模型但这个版本没内置（站长撤了 Key）→ 退回演示引擎，别让访客卡在必败的选项上。
 *
 * `providerChosen` 同样是红线：访客一旦自己点过「设为当前引擎」，规则 1 永久失效。
 * 规则 2 不看这条红线 —— 它修的是"你选的东西已经坏了"，不是偏好。
 *
 * `available` 作为参数而不是直接调 stationAvailable()，是为了让冒烟测试能两个方向都断言
 * （内置 / 没内置），而不用去伪造 import.meta.env。
 */
export function decideStationSwitch(
  now: { activeProviderId: string; providerChosen: boolean },
  available: boolean = stationAvailable(),
): StationDecision {
  if (now.activeProviderId === STATION_PROVIDER_ID && !available) {
    return {
      kind: 'fallback',
      providerId: DEMO_PROVIDER_ID,
      message: '这一版没有内置本站的模型 Key，已自动切回内置演示引擎。',
    }
  }

  if (available && now.activeProviderId === DEMO_PROVIDER_ID && !now.providerChosen) {
    return {
      kind: 'adopt',
      providerId: STATION_PROVIDER_ID,
      message: `已启用本站内置模型（${stationModel()}）：由本站付费，你不需要 API Key。`,
    }
  }

  return { kind: 'none' }
}

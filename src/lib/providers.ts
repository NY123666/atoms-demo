import type { ProviderDef } from '../types'

/**
 * 全部走 OpenAI 兼容协议，所以只需要换 baseUrl / model。
 * 选型理由：一套请求逻辑覆盖所有服务商，用户自带 Key，平台不托管任何密钥。
 */
export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: '通用能力均衡，兼容性最好。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '中文理解与代码生成性价比高，适合日常生成。',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    hint: '长上下文友好，适合贴长需求。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '国内直连，开源模型选择多。',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
    keyUrl: 'https://openrouter.ai/keys',
    hint: '一个 Key 打通多家模型，方便横向对比。',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-coder-plus', 'qwen-max'],
    keyUrl: 'https://bailian.console.aliyun.com/',
    hint: '通义千问系列，国内合规直连。',
  },
  {
    id: 'bigmodel',
    name: '智谱 BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash'],
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    hint: 'GLM 系列，flash 版本响应快。',
  },
]

export const DEMO_PROVIDER_ID = 'demo'

export const DEMO_PROVIDER: ProviderDef = {
  id: DEMO_PROVIDER_ID,
  name: '内置演示引擎',
  baseUrl: '',
  models: ['forge-template-v1'],
  keyUrl: '',
  hint: '不需要任何 API Key，用内置模板库生成可直接运行的真实应用，复制走就能用。',
}

/** 托管模式：产品方出钱、访客零配置。没有 keyUrl —— 因为访客根本不需要填 Key。 */
export const HOSTED_PROVIDER_ID = 'hosted'

export const HOSTED_PROVIDER: ProviderDef = {
  id: HOSTED_PROVIDER_ID,
  name: '托管模型',
  baseUrl: '', // 真实地址由探测结果决定（见 lib/hosted.ts），不是写死的
  models: [], // 模型名以服务端为准，前端只负责显示
  keyUrl: '',
  hint: '由本站付费调用真模型，访客不需要任何 API Key，也不需要注册。每天有公开额度上限。',
}

/**
 * 本站内置模型：站长把自己的 Key 在**构建期**打进前端包，访客点开就能用。
 *
 * 为什么不复用 HOSTED_PROVIDER：那张卡片上写着"上游密钥只存在服务端，浏览器里拿不到"，
 * 而这条路径恰恰相反 —— Key 就在页面 JS 里。硬塞进同一个卡片，等于对访客说假话。
 * 两者的账单模型也不同（托管代理有服务端每日上限兜底，内置 Key 没有），
 * 所以宁可多一个引擎、多一句实话。
 *
 * 细节与取舍见 lib/station.ts。
 */
export const STATION_PROVIDER_ID = 'station'

export const STATION_PROVIDER: ProviderDef = {
  id: STATION_PROVIDER_ID,
  name: '本站内置模型',
  baseUrl: '', // 真实地址来自构建期变量，见 lib/station.ts
  models: [], // 同上：模型名以构建期变量为准
  keyUrl: '',
  hint: '由本站预置的 Key 直接调用真模型，访客不需要任何 API Key，也不需要注册。',
}

export function findProvider(id: string): ProviderDef {
  if (id === DEMO_PROVIDER_ID) return DEMO_PROVIDER
  if (id === HOSTED_PROVIDER_ID) return HOSTED_PROVIDER
  if (id === STATION_PROVIDER_ID) return STATION_PROVIDER
  return PROVIDERS.find((p) => p.id === id) ?? DEMO_PROVIDER
}

/**
 * 只列"永远存在"的引擎：内置演示引擎 + 7 家可自带 Key 的服务商。
 * 托管模型/内置模型都不在这里 —— 它们可能存在也可能不存在（取决于有没有部署代理、
 * 这一次构建有没有注入 Key），由界面按实际情况**条件插入**（见 SettingsDialog）。
 * 把不确定存在的东西放进这个列表，就会在没部署代理的站上给访客一个点了必然失败的选项。
 */
export function allProviders(): ProviderDef[] {
  return [DEMO_PROVIDER, ...PROVIDERS]
}

/**
 * 设置窗口要显示的引擎列表。
 * 两个"零配置"选项（内置模型、托管模型）排在内置演示引擎后面、自带 Key 的家前面，
 * 因为对绝大多数访客来说，这两个才是他真正要点的东西。
 */
export function providerChoices(includeHosted: boolean, includeStation = false): ProviderDef[] {
  return [
    DEMO_PROVIDER,
    ...(includeStation ? [STATION_PROVIDER] : []),
    ...(includeHosted ? [HOSTED_PROVIDER] : []),
    ...PROVIDERS,
  ]
}

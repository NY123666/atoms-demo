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
  hint: '不需要任何 API Key。用内置模板库直接生成可运行的真实应用，开箱即测。',
}

export function findProvider(id: string): ProviderDef {
  if (id === DEMO_PROVIDER_ID) return DEMO_PROVIDER
  return PROVIDERS.find((p) => p.id === id) ?? DEMO_PROVIDER
}

export function allProviders(): ProviderDef[] {
  return [DEMO_PROVIDER, ...PROVIDERS]
}

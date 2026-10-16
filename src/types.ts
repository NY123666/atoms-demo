/** 全局数据模型。持久化 schema 的版本号在 store 里，改结构时同步 +1。 */

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  /** 助手消息可以关联到某一版产物 */
  versionId?: string
}

/** 生成来源：demo = 内置模板引擎（无需 Key），llm = 用户自带的模型服务 */
export type GenSource = 'demo' | 'llm'

export interface AppVersion {
  id: string
  /** 从 1 开始的展示序号 */
  index: number
  label: string
  /** 完整可运行的单文件 HTML */
  html: string
  /** 触发本次生成的用户输入 */
  prompt: string
  createdAt: number
  durationMs: number
  source: GenSource
  providerId?: string
  model?: string
  /** 模型返回的 token 用量（只有 llm 模式有） */
  tokens?: number
  /** 生成时的落点说明，比如命中了哪个模板、做了什么替换 */
  note?: string
  /** 由自动修复产生 */
  autoFixed?: boolean
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  versions: AppVersion[]
  currentVersionId: string | null
  starred: boolean
}

export interface ProviderSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface Settings {
  /** 当前使用的服务商 id，'demo' 表示内置演示引擎 */
  activeProviderId: string
  providers: Record<string, ProviderSettings>
  theme: 'dark' | 'light'
  autoFix: boolean
  /** 生成时是否打字机式流式输出 */
  streamDemo: boolean
}

export interface ProviderDef {
  id: string
  name: string
  baseUrl: string
  models: string[]
  keyUrl: string
  hint: string
}

/** 生成过程中的步骤日志，用于把「智能体在干活」真实地展示出来 */
export interface GenStep {
  title: string
  detail: string
  /** 相对耗时权重，用来模拟进度节奏 */
  weight: number
}

export interface GenStepState extends GenStep {
  status: 'pending' | 'running' | 'done' | 'error'
  startedAt?: number
  finishedAt?: number
}

export interface LlmResult {
  text: string
  tokens?: number
}

export interface SharePayload {
  v: 1
  name: string
  html: string
  createdAt: number
  source: GenSource
  model?: string
}

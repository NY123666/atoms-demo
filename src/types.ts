/** 全局数据模型。持久化 schema 的版本号在 store 里，改结构时同步 +1。 */

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  /** 助手消息可以关联到某一版产物 */
  versionId?: string
  /** 这次生成/修改的执行记录（失败或停止时挂在消息上，成功时同时挂在版本上） */
  run?: GenRun
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
  /** 这版产物的完整执行记录（生成时留存，见 run.ts） */
  run?: GenRun
}

/**
 * 一次生成/修改的完整执行记录，随产物版本一起存档。
 * 刷新或重新打开项目后，聊天里仍能展开回看每一步做了什么、花了多久。
 */
export interface GenRun {
  source: GenSource
  /** done = 成功出存档；error = 失败；stopped = 手动停止 */
  status: 'done' | 'error' | 'stopped'
  /** 触发本次生成的用户输入 */
  prompt: string
  startedAt: number
  finishedAt: number
  /** 全程耗时（毫秒） */
  durationMs: number
  /** 各步骤的终态；未跑到的步骤如实标为 pending */
  steps: GenStepState[]
  /** 失败/停止原因（status 非 done 时给到） */
  error?: string
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
  /** 当前使用的服务商 id，'demo' 表示内置演示引擎，'hosted' 表示本站托管的模型 */
  activeProviderId: string
  providers: Record<string, ProviderSettings>
  theme: 'dark' | 'light'
  autoFix: boolean
  /** 生成时是否打字机式流式输出 */
  streamDemo: boolean
  /**
   * 托管代理的地址覆盖（''=自动探测）。
   * 只在"自己部署代理"或"代理和静态站不同源"时需要填；普通访客永远用不到这一项。
   */
  hostedBase: string
  /**
   * 用户有没有**亲手**选过引擎。
   * 只有 false 时才会在探测到托管代理可用后自动切过去 —— 一旦用户自己点过「设为当前引擎」，
   * 就再也不能替他改，否则"我刚选的演示引擎怎么又被换回去了"。
   */
  providerChosen: boolean
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

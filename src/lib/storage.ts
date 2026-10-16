import type { Project, Settings } from '../types'

/**
 * 持久化策略：localStorage（单机、零后端、刷新即恢复）。
 * 取舍说明写在 README：如果要多端同步，只需把这一层换成远程 API，
 * 上层 store 的调用方式不用改。
 *
 * 每份数据都带 schema 版本号，便于以后做迁移而不是直接丢数据。
 */
export const SCHEMA_VERSION = 1

const PROJECTS_KEY = 'forge:projects'
const SETTINGS_KEY = 'forge:settings'

interface Envelope<T> {
  v: number
  data: T
}

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: 'demo',
  providers: {},
  theme: 'dark',
  autoFix: true,
  streamDemo: true,
}

function readEnvelope<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Envelope<T> | T
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'data' in parsed) {
      const env = parsed as Envelope<T>
      if (env.v !== SCHEMA_VERSION) return migrate<T>(key, env)
      return env.data
    }
    // 老格式（无信封），直接当数据用
    return parsed as T
  } catch {
    return null
  }
}

function migrate<T>(key: string, env: Envelope<T>): T | null {
  // 目前只有 v1。未来版本在这里按 v 分支升级，而不是丢弃用户数据。
  try {
    localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, data: env.data }))
    return env.data
  } catch {
    return null
  }
}

function writeEnvelope<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, data }))
    return true
  } catch {
    // 大多是容量超限。调用方会收到 false 并给出提示。
    return false
  }
}

export function loadProjects(): Project[] {
  const data = readEnvelope<Project[]>(PROJECTS_KEY)
  if (!Array.isArray(data)) return []
  return data.filter((p) => p && typeof p.id === 'string')
}

export function saveProjects(projects: Project[]): boolean {
  return writeEnvelope(PROJECTS_KEY, projects)
}

export function loadSettings(): Settings {
  const data = readEnvelope<Partial<Settings>>(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) }
}

export function saveSettings(settings: Settings): boolean {
  return writeEnvelope(SETTINGS_KEY, settings)
}

export function clearAll(): void {
  try {
    localStorage.removeItem(PROJECTS_KEY)
    localStorage.removeItem(SETTINGS_KEY)
  } catch {
    /* 忽略：隐私模式下会抛错 */
  }
}

export function storageAvailable(): boolean {
  try {
    const probe = '__forge_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

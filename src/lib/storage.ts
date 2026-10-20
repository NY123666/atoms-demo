import type { Project, Settings } from '../types'

/**
 * 持久化策略：localStorage（单机、零后端、刷新即恢复）。
 * 取舍说明写在 README：如果要多端同步，只需把这一层换成远程 API，
 * 上层 store 的调用方式不用改。
 *
 * 每份数据都带 schema 版本号，便于以后做迁移而不是直接丢数据。
 */
export const SCHEMA_VERSION = 1

/*
 * 加了本机账号之后，应用数据和设置都按 owner 分区：
 *   - 访客（未登录）**继续用下面这两个老 key**。这样既有数据不会因为升级而"消失"，
 *     也符合直觉 —— 升级前那些应用本来就没有主人，归给访客最自然。
 *   - 登录用户用 `${key}:${ownerId}`。
 * 数据结构没变，只是多了几把 key，所以 SCHEMA_VERSION 不动（没有需要迁移的形状）。
 */
const PROJECTS_KEY = 'forge:projects'
const SETTINGS_KEY = 'forge:settings'

/**
 * 访客分区的 ownerId。放这里而不是 accounts.ts：决定"哪个 owner 用哪把 key"的是本模块，
 * 反过来让 storage 去 import accounts 会绕出一个循环依赖。
 */
export const GUEST_OWNER_ID = 'guest'

/** 账号表与登录会话。它们不属于任何 owner —— 没登录时也得能读到账号表。 */
export const ACCOUNTS_KEY = 'forge:accounts'
export const SESSION_KEY = 'forge:session'

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
  hostedBase: '',
  providerChosen: false,
}

function scopedKey(base: string, ownerId: string): string {
  return ownerId === GUEST_OWNER_ID ? base : `${base}:${ownerId}`
}

export function readEnvelope<T>(key: string): T | null {
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

export function writeEnvelope<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, data }))
    return true
  } catch {
    // 大多是容量超限。调用方会收到 false 并给出提示。
    return false
  }
}

export function loadProjects(ownerId: string = GUEST_OWNER_ID): Project[] {
  const data = readEnvelope<Project[]>(scopedKey(PROJECTS_KEY, ownerId))
  if (!Array.isArray(data)) return []
  return data.filter((p) => p && typeof p.id === 'string')
}

export function saveProjects(projects: Project[], ownerId: string = GUEST_OWNER_ID): boolean {
  return writeEnvelope(scopedKey(PROJECTS_KEY, ownerId), projects)
}

export function loadSettings(ownerId: string = GUEST_OWNER_ID): Settings {
  const data = readEnvelope<Partial<Settings>>(scopedKey(SETTINGS_KEY, ownerId))
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) }
}

export function saveSettings(settings: Settings, ownerId: string = GUEST_OWNER_ID): boolean {
  return writeEnvelope(scopedKey(SETTINGS_KEY, ownerId), settings)
}

/** 清掉某一个 owner 的应用与设置（删账号时用）。访客的 ownerId 会命中的正是那两个老 key。 */
export function clearOwner(ownerId: string): void {
  try {
    localStorage.removeItem(scopedKey(PROJECTS_KEY, ownerId))
    localStorage.removeItem(scopedKey(SETTINGS_KEY, ownerId))
  } catch {
    /* 忽略：隐私模式下会抛错 */
  }
}

/**
 * 清空本机所有 Forge 数据：应用、设置、账号表、会话，以及任何 `forge:` 开头的残留 key。
 * 逐个 key 删（而不是 localStorage.clear()），这样不会误伤同一个域名下的其它站点数据。
 */
export function clearAll(): void {
  try {
    const own: string[] = []
    // 先按已知 key 删。内存替身（测试里用的）没有实现 length/key()，所以不能只靠遍历。
    own.push(PROJECTS_KEY, SETTINGS_KEY, ACCOUNTS_KEY, SESSION_KEY)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('forge:')) own.push(k)
    }
    for (const k of own) localStorage.removeItem(k)
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

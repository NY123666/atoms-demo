import { useSyncExternalStore } from 'react'
import type { AppVersion, ChatMessage, Project, ProviderSettings, Settings } from '../types'
import {
  DEFAULT_SETTINGS,
  GUEST_OWNER_ID,
  clearAll,
  clearOwner,
  loadProjects,
  loadSettings,
  saveProjects,
  saveSettings,
} from './storage'
import {
  type Account,
  clearSession,
  deleteAccount as deleteAccountRecord,
  findAccountById,
  listAccounts,
  login as loginAccount,
  readSession,
  register as registerAccount,
  writeSession,
} from './accounts'
import { uid } from './id'

export interface StoreState {
  /**
   * 当前数据属于谁：GUEST_OWNER_ID 表示访客，否则是账号 id。
   * projects / settings 都是**这个 owner 那一份**，切换 owner 时整体换掉。
   */
  ownerId: string
  /** 当前登录的账号；访客为 null */
  account: Account | null
  /** 本机注册过的账号，用来在界面上列出来（含"本机账号，不跨设备"的说明） */
  accounts: Account[]
  projects: Project[]
  settings: Settings
  /** 写入 localStorage 失败时的提示（多为容量超限） */
  persistError: string | null
}

/**
 * 开机恢复：先看有没有登录会话，再看那个账号还在不在（可能被删过），
 * 会话指向一个不存在的账号时就当访客，顺手把这条死会话清掉。
 */
function bootOwner(): { ownerId: string; account: Account | null } {
  const session = readSession()
  const account = session ? findAccountById(session.ownerId) : null
  if (!account) {
    if (session) clearSession()
    return { ownerId: GUEST_OWNER_ID, account: null }
  }
  return { ownerId: account.id, account }
}

const boot = bootOwner()

let state: StoreState = {
  ownerId: boot.ownerId,
  account: boot.account,
  accounts: listAccounts(),
  projects: loadProjects(boot.ownerId),
  settings: loadSettings(boot.ownerId),
  persistError: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getState(): StoreState {
  return state
}

/** React 组件统一从这拿状态。规模很小，整棵 state 订阅足够，也避免了 selector 撕裂。 */
export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState, getState)
}

let persistTimer: number | null = null

/**
 * 内存里有没有"比磁盘更新"的改动。
 *
 * 加这个标记是为了修一类很隐蔽的错：切分区前会先 flushNow()，但如果这次 flush 发生在
 * 数据已经被搬走/删掉之后（注册时搬访客数据、删账号时清分区），它会把内存里那份数据
 * 重新写回刚刚清空的分区 —— 搬走的应用在访客分区"复活"，删掉的账号数据又回来了。
 * 有了 dirty 标记，flush 就成了"只在真的脏了才写"，清完分区再 flush 是空转，不会复活任何东西。
 */
let dirty = false

/** 取消还没落盘的延时写入，并把当前数据立刻写给**当前的 owner**。切 owner 前必须先做这一步。 */
function flushNow() {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  flush()
}

function schedulePersist(delay = 250) {
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    flush()
  }, delay)
}

export function flush() {
  if (!dirty) return
  const ok = saveProjects(state.projects, state.ownerId)
  if (ok) dirty = false
  if (!ok && !state.persistError) {
    state = { ...state, persistError: '本地存储写入失败（可能已超出浏览器容量），最近的改动可能没有落盘。' }
    emit()
  }
}

function commit(next: Partial<StoreState>) {
  state = { ...state, ...next }
  dirty = true
  emit()
}

/* --------------------------------- 账号分区 -------------------------------- */

/**
 * 换一个数据分区（登录 / 退出 / 注册后切过去）。
 *
 * 关键一步是先 flushNow()：项目改动是延时 250ms 落盘的，如果直接切，
 * 那些还在队列里的改动会写进**新 owner** 的分区 —— 旧账号少了最后几步操作，
 * 新账号多出一条不属于它的项目。这个错非常隐蔽，所以顺序不能动。
 */
function switchOwner(ownerId: string, account: Account | null): void {
  flushNow()
  state = {
    ...state,
    ownerId,
    account,
    accounts: listAccounts(),
    projects: loadProjects(ownerId),
    settings: loadSettings(ownerId),
    persistError: null,
  }
  // 刚读上来的就是磁盘上的样子，没有"待写"这回事。
  dirty = false
  emit()
}

export interface AuthOutcome {
  ok: boolean
  error?: string
  /** 只有注册时可能有值：从访客分区搬过来的应用数（界面用它说清"搬了几个"）。 */
  movedProjects?: number
}

export async function register(
  username: string,
  password: string,
  opts: { importGuest?: boolean } = {},
): Promise<AuthOutcome> {
  const res = await registerAccount(username, password)
  if (!res.ok) return { ok: false, error: res.error }

  /*
   * 搬运之前必须先 flushNow()：carryOverGuestData 读的是**磁盘上**的访客分区，
   * 而访客刚改完的东西可能还在 250ms 的延时队列里 —— 不先落盘就会漏掉最后几步操作
   * （用户那边的感受是"刚做的改动没搬过去"）。落盘之后 dirty 清零，
   * 下面的 switchOwner 再 flush 就是空转，不会把搬走的数据又写回访客分区。
   */
  if (opts.importGuest) flushNow()
  // 先搬数据再切分区：carryOverGuestData 读的是访客那份，切过去之后就找不到了。
  const movedProjects = opts.importGuest ? carryOverGuestData(res.account.id) : 0
  writeSession(res.account)
  switchOwner(res.account.id, res.account)
  return { ok: true, movedProjects }
}

export async function login(username: string, password: string): Promise<AuthOutcome> {
  const res = await loginAccount(username, password)
  if (!res.ok) return { ok: false, error: res.error }
  writeSession(res.account)
  switchOwner(res.account.id, res.account)
  return { ok: true }
}

export function logout(): void {
  clearSession()
  switchOwner(GUEST_OWNER_ID, null)
}

/** 把访客分区里的应用和引擎设置搬给某个账号，搬完把访客那份清掉（是"搬"不是"复制"）。 */
function carryOverGuestData(ownerId: string): number {
  const projects = loadProjects(GUEST_OWNER_ID)
  if (projects.length === 0 && !stateHasGuestSettings()) return 0
  const settings = loadSettings(GUEST_OWNER_ID)
  saveProjects(projects, ownerId)
  saveSettings(settings, ownerId)
  clearOwner(GUEST_OWNER_ID)
  return projects.length
}

/** 访客有没有存过设置。只有 DEFAULT_SETTINGS 时不必多搬一份。 */
function stateHasGuestSettings(): boolean {
  const s = loadSettings(GUEST_OWNER_ID)
  return JSON.stringify(s) !== JSON.stringify(DEFAULT_SETTINGS)
}

/** 访客分区里现在有几个应用（注册对话框上要如实显示"N 个应用会被搬走"）。 */
export function guestProjectCount(): number {
  return loadProjects(GUEST_OWNER_ID).length
}

/**
 * 删除账号：账号记录、它名下的应用与设置一起删。
 * 删的是当前账号时就退回访客态；删的是别人的账号则原地不动。
 */
export function removeAccount(accountId: string): void {
  const isCurrent = state.ownerId === accountId
  // 先 flushNow() 只为把挂起的定时器取消掉（数据随后就删了，写它没有意义）；
  // 清完分区再切 owner 时 flush 已经是空转，不会把刚删掉的应用写回来。
  if (isCurrent) flushNow()
  deleteAccountRecord(accountId)
  clearOwner(accountId)
  if (isCurrent) {
    clearSession()
    switchOwner(GUEST_OWNER_ID, null)
  } else {
    commit({ accounts: listAccounts() })
  }
}

/* ---------------------------------- 项目 ---------------------------------- */

export function createProject(name = '未命名应用'): Project {
  const now = Date.now()
  const project: Project = {
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    messages: [],
    versions: [],
    currentVersionId: null,
    starred: false,
  }
  commit({ projects: [project, ...state.projects] })
  flush()
  return project
}

export function getProject(id: string): Project | undefined {
  return state.projects.find((p) => p.id === id)
}

export function updateProject(id: string, patch: Partial<Project>, touch = true): void {
  commit({
    projects: state.projects.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: touch ? Date.now() : p.updatedAt } : p,
    ),
  })
  schedulePersist()
}

export function renameProject(id: string, name: string): void {
  updateProject(id, { name: name.trim() || '未命名应用' })
}

export function toggleStar(id: string): void {
  const p = getProject(id)
  if (!p) return
  updateProject(id, { starred: !p.starred })
}

export function deleteProject(id: string): void {
  commit({ projects: state.projects.filter((p) => p.id !== id) })
  flush()
}

export function duplicateProject(id: string): Project | null {
  const p = getProject(id)
  if (!p) return null
  const now = Date.now()
  const copy: Project = {
    ...p,
    id: uid('p'),
    name: `${p.name} 副本`,
    createdAt: now,
    updatedAt: now,
    starred: false,
    messages: p.messages.map((m) => ({ ...m, id: uid('m') })),
    versions: p.versions.map((v) => ({ ...v, id: uid('v') })),
  }
  if (copy.versions.length > 0) {
    copy.currentVersionId = copy.versions[copy.versions.length - 1]!.id
  }
  commit({ projects: [copy, ...state.projects] })
  flush()
  return copy
}

/* ---------------------------------- 消息 ---------------------------------- */

export function addMessage(projectId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  const full: ChatMessage = { ...message, id: uid('m'), createdAt: Date.now() }
  const p = getProject(projectId)
  if (!p) return full
  updateProject(projectId, { messages: [...p.messages, full] })
  return full
}

export function updateMessage(projectId: string, messageId: string, patch: Partial<ChatMessage>): void {
  const p = getProject(projectId)
  if (!p) return
  updateProject(projectId, {
    messages: p.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  })
}

export function removeMessage(projectId: string, messageId: string): void {
  const p = getProject(projectId)
  if (!p) return
  updateProject(projectId, { messages: p.messages.filter((m) => m.id !== messageId) })
}

/* --------------------------------- 版本存档 -------------------------------- */

export function nextVersionIndex(p: Project): number {
  return p.versions.reduce((max, v) => Math.max(max, v.index), 0) + 1
}

export function addVersion(projectId: string, version: Omit<AppVersion, 'id' | 'index'>): AppVersion | null {
  const p = getProject(projectId)
  if (!p) return null
  const full: AppVersion = { ...version, id: uid('v'), index: nextVersionIndex(p) }
  updateProject(projectId, {
    versions: [...p.versions, full],
    currentVersionId: full.id,
  })
  return full
}

export function setCurrentVersion(projectId: string, versionId: string): void {
  updateProject(projectId, { currentVersionId: versionId })
}

export function deleteVersion(projectId: string, versionId: string): void {
  const p = getProject(projectId)
  if (!p) return
  const versions = p.versions.filter((v) => v.id !== versionId)
  const currentVersionId =
    p.currentVersionId === versionId ? (versions.length > 0 ? versions[versions.length - 1]!.id : null) : p.currentVersionId
  updateProject(projectId, { versions, currentVersionId })
}

/* ---------------------------------- 设置 ---------------------------------- */

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch }
  // 设置是立刻落盘的（不像项目那样攒 250ms），所以这里必须带上 owner，
  // 否则登录用户改引擎/填 Key 会写进访客分区。
  saveSettings(settings, state.ownerId)
  commit({ settings })
}

export function updateProviderSettings(providerId: string, patch: Partial<ProviderSettings>): void {
  const prev = state.settings.providers[providerId] ?? { apiKey: '', baseUrl: '', model: '' }
  updateSettings({
    providers: { ...state.settings.providers, [providerId]: { ...prev, ...patch } },
  })
}

/**
 * 清空本机一切：所有账号、所有分区的应用与设置、登录会话。
 * 注意它是**全清**而不是只清当前账号 —— 按钮写的是"清空本地数据"，
 * 就得连账号一起清掉，否则用户以为清干净了、其实别人的数据还在。文案里也说清了这一点。
 */
export function resetEverything(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  clearAll()
  state = {
    ownerId: GUEST_OWNER_ID,
    account: null,
    accounts: [],
    projects: [],
    settings: { ...DEFAULT_SETTINGS },
    persistError: null,
  }
  dirty = false
  emit()
}

export function dismissPersistError(): void {
  commit({ persistError: null })
}

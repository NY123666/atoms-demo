import { useSyncExternalStore } from 'react'
import type { AppVersion, ChatMessage, Project, ProviderSettings, Settings } from '../types'
import {
  DEFAULT_SETTINGS,
  clearAll,
  loadProjects,
  loadSettings,
  saveProjects,
  saveSettings,
} from './storage'
import { uid } from './id'

export interface StoreState {
  projects: Project[]
  settings: Settings
  /** 写入 localStorage 失败时的提示（多为容量超限） */
  persistError: string | null
}

let state: StoreState = {
  projects: loadProjects(),
  settings: loadSettings(),
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

function schedulePersist(delay = 250) {
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    flush()
  }, delay)
}

export function flush() {
  const ok = saveProjects(state.projects)
  if (!ok && !state.persistError) {
    state = { ...state, persistError: '本地存储写入失败（可能已超出浏览器容量），最近的改动可能没有落盘。' }
    emit()
  }
}

function commit(next: Partial<StoreState>) {
  state = { ...state, ...next }
  emit()
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
  saveSettings(settings)
  commit({ settings })
}

export function updateProviderSettings(providerId: string, patch: Partial<ProviderSettings>): void {
  const prev = state.settings.providers[providerId] ?? { apiKey: '', baseUrl: '', model: '' }
  updateSettings({
    providers: { ...state.settings.providers, [providerId]: { ...prev, ...patch } },
  })
}

export function resetEverything(): void {
  clearAll()
  state = { projects: [], settings: { ...DEFAULT_SETTINGS }, persistError: null }
  emit()
}

export function dismissPersistError(): void {
  commit({ persistError: null })
}

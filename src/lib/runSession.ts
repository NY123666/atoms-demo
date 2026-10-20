import { useSyncExternalStore } from 'react'
import type { GenRun, GenStepState } from '../types'
import { addMessage, addVersion, getProject, getState, updateMessage } from './store'
import { runGeneration } from './generate'
import type { NewVersion } from './generate'
import { deriveTitle } from './intent'
import { checkRunnable } from './sandbox'
import { buildRun } from './run'
import { formatBytes, formatDuration } from './format'
import { toast } from './toast'

/**
 * 每个项目的生成会话，放在组件外面。
 *
 * 之前生成状态全住在 Workbench 里，切走项目时组件卸载、卸载清理把 AbortController 一掐，
 * 后台的生成当场死掉 —— 「无法多个项目同时制作」就是这么来的。
 * 现在会话在模块层按 projectId 各占一份：切走项目只是卸载了界面，会话继续在后台跑，
 * 跑完照样存档；回来时组件从快照里恢复现场，还能看到这次生成一直在走。
 */
export interface RunSnapshot {
  running: boolean
  steps: GenStepState[]
  streamText: string
  /** 本次生成的开始时间；0 表示这个项目还从没跑过 */
  startedAt: number
}

interface RunSession {
  projectId: string
  /** useSyncExternalStore 要求快照引用稳定：同一份状态就返回同一个对象，变化时原地改。 */
  snap: RunSnapshot
  controller: AbortController | null
  listeners: Set<() => void>
}

const sessions = new Map<string, RunSession>()

function getOrCreate(projectId: string): RunSession {
  let s = sessions.get(projectId)
  if (!s) {
    s = {
      projectId,
      snap: { running: false, steps: [], streamText: '', startedAt: 0 },
      controller: null,
      listeners: new Set(),
    }
    sessions.set(projectId, s)
  }
  return s
}

function emit(s: RunSession): void {
  for (const l of s.listeners) l()
}

export function subscribeRun(projectId: string, listener: () => void): () => void {
  const s = getOrCreate(projectId)
  s.listeners.add(listener)
  return () => {
    s.listeners.delete(listener)
  }
}

export function getRunSnapshot(projectId: string): RunSnapshot {
  return getOrCreate(projectId).snap
}

/** 组件用：订阅自己项目的会话。快照引用稳定，执行中只发生原地更新。 */
export function useRun(projectId: string): RunSnapshot {
  return useSyncExternalStore(
    (cb) => subscribeRun(projectId, cb),
    () => getRunSnapshot(projectId),
    () => getRunSnapshot(projectId),
  )
}

/** 停掉某一个项目的生成；其它项目不受影响。 */
export function abortRun(projectId: string): void {
  getOrCreate(projectId).controller?.abort()
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function buildSummary(version: NewVersion, index: number): string {
  const check = checkRunnable(version.html)
  const bits = [
    `已生成 v${index}「${version.label}」，耗时 ${formatDuration(version.durationMs)}。`,
    `产物是 ${formatBytes(version.html.length)} 的单文件 HTML，含 ${version.html.split('<script').length - 1} 段脚本${
      check.ok ? '，静态自检通过' : `，自检有 ${check.reasons.length} 条提醒`
    }。`,
    version.note ? `\n${version.note}` : '',
    version.autoFixed ? '\n首次产物没通过自检，已自动重试并修复一次。' : '',
    '\n右侧可以直接操作它，也可以在「代码」里看完整源码。想改哪里直接说。',
  ]
  return bits.filter(Boolean).join('')
}

/**
 * 发起一次生成。同一项目只允许一条在跑；不同项目互不干扰、各自有独立的终止开关。
 * 消息、版本存档都按 projectId 写回 store —— 调用方切到别的项目，后台这条照样落盘。
 */
export async function runProject(projectId: string, text: string): Promise<void> {
  const promptText = text.trim()
  if (!promptText) return
  const s = getOrCreate(projectId)
  if (s.snap.running) return
  const p = getProject(projectId)
  if (!p) return

  const previous = p.versions.find((v) => v.id === p.currentVersionId) ?? p.versions[p.versions.length - 1]
  const previousHtml = previous?.html ?? null
  const revision = p.versions.length
  // 快照一份设置：跑的过程中用户去改设置，不影响这条已经在跑的链路
  const settings = { ...getState().settings }

  addMessage(projectId, { role: 'user', content: promptText })
  const assistant = addMessage(projectId, { role: 'assistant', content: '正在生成，请稍候…' })

  const controller = new AbortController()
  s.controller = controller
  s.snap.running = true
  s.snap.steps = []
  s.snap.streamText = ''
  s.snap.startedAt = Date.now()
  emit(s)

  // 生成前定下这次走的是哪条链路，结束存档时好如实标注来源
  const runSource: GenRun['source'] = settings.activeProviderId === 'demo' ? 'demo' : 'llm'
  const startedAt = s.snap.startedAt

  try {
    const version = await runGeneration({
      prompt: promptText,
      previousHtml,
      revision,
      settings,
      onStep: (steps) => {
        s.snap.steps = steps
        emit(s)
      },
      onDelta: (full) => {
        s.snap.streamText = full
        emit(s)
      },
      signal: controller.signal,
    })

    const run = buildRun({
      source: version.source,
      status: 'done',
      prompt: promptText,
      startedAt,
      finishedAt: Date.now(),
      steps: s.snap.steps,
      autoFixed: version.autoFixed,
    })
    const saved = addVersion(projectId, { ...version, label: version.label || deriveTitle(promptText), run })
    const index = saved?.index ?? revision + 1
    updateMessage(projectId, assistant.id, {
      content: buildSummary(version, index),
      versionId: saved?.id,
      run,
    })
    toast(`已生成 v${index}`, 'success')
  } catch (err) {
    if (isAbort(err)) {
      updateMessage(projectId, assistant.id, {
        content: '已手动停止本次生成。这一版没有存档，可以重新发起。',
        run: buildRun({
          source: runSource,
          status: 'stopped',
          prompt: promptText,
          startedAt,
          steps: s.snap.steps,
          error: '手动停止',
        }),
      })
    } else {
      const msg = errorText(err)
      updateMessage(projectId, assistant.id, {
        content: `生成失败：${msg}`,
        run: buildRun({
          source: runSource,
          status: 'error',
          prompt: promptText,
          startedAt,
          steps: s.snap.steps,
          error: msg,
        }),
      })
      toast('生成失败，详情见对话', 'error', { duration: 6000 })
    }
  } finally {
    s.controller = null
    s.snap.running = false
    s.snap.streamText = ''
    emit(s)
  }
}

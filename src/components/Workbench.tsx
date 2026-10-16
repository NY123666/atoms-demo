import { useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import PreviewPane from './PreviewPane'
import CodePane from './CodePane'
import VersionTimeline from './VersionTimeline'
import { addMessage, addVersion, deleteVersion, getProject, renameProject, setCurrentVersion, updateMessage, useStore } from '../lib/store'
import { runGeneration } from '../lib/generate'
import type { NewVersion } from '../lib/generate'
import { deriveTitle } from '../lib/intent'
import { findProvider } from '../lib/providers'
import { takeHandoff } from '../lib/handoff'
import { go } from '../lib/router'
import { copyText, formatBytes, formatDuration } from '../lib/format'
import { buildShareUrl, encodeShare, downloadHtml, SHARE_WARN_LENGTH } from '../lib/share'
import { toast } from '../lib/toast'
import { checkRunnable } from '../lib/sandbox'
import { analyzeEnhancements } from '../lib/enhance'
import type { GenStepState, SharePayload } from '../types'
import { IconBack, IconCode, IconDownload, IconHistory, IconPlay, IconShare, IconSpark } from './Icons'

type Tab = 'preview' | 'code'

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

export default function Workbench({ projectId }: { projectId: string }) {
  const state = useStore()
  const project = state.projects.find((p) => p.id === projectId)

  const [draft, setDraft] = useState('')
  const [steps, setSteps] = useState<GenStepState[]>([])
  const [running, setRunning] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [totalMs, setTotalMs] = useState(0)
  const [tab, setTab] = useState<Tab>('preview')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef(false)
  const autoRunRef = useRef(false)
  const projectRef = useRef(project)
  projectRef.current = project
  const settingsRef = useRef(state.settings)
  settingsRef.current = state.settings
  const draftRef = useRef(draft)
  draftRef.current = draft

  const versions = project?.versions ?? []
  const currentVersion =
    versions.find((v) => v.id === project?.currentVersionId) ?? versions[versions.length - 1] ?? null

  const provider = findProvider(state.settings.activeProviderId)

  /* 当前这一版已经有了哪些通用能力、下一步还能加什么（跟着回滚/切版本一起变）。 */
  const enhanceOverview = useMemo(() => analyzeEnhancements(currentVersion?.html), [currentVersion?.html])

  /* ------------------------------ 沙箱消息桥 ------------------------------ */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { __forge?: string; message?: string } | null
      if (!data || typeof data !== 'object' || typeof data.__forge !== 'string') return
      if (data.__forge === 'ready') {
        setReady(true)
        setRuntimeError(null)
      } else if (data.__forge === 'runtime-error') {
        setRuntimeError(data.message ? String(data.message).slice(0, 300) : '未知运行时错误')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    setReady(false)
    setRuntimeError(null)
  }, [currentVersion?.id])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  /* -------------------------------- 生成 -------------------------------- */
  async function run(text: string) {
    const promptText = text.trim()
    if (!promptText || runningRef.current) return
    const p = getProject(projectId)
    if (!p) return

    const previous = p.versions.find((v) => v.id === p.currentVersionId) ?? p.versions[p.versions.length - 1]
    const previousHtml = previous?.html ?? null

    addMessage(projectId, { role: 'user', content: promptText })
    const assistant = addMessage(projectId, { role: 'assistant', content: '正在生成，请稍候…' })

    setDraft('')
    setSteps([])
    setStreamText('')
    setRuntimeError(null)
    setTotalMs(0)
    setTab('preview')

    const controller = new AbortController()
    abortRef.current = controller
    runningRef.current = true
    setRunning(true)

    const startedAt = Date.now()
    const timer = window.setInterval(() => setTotalMs(Date.now() - startedAt), 200)

    try {
      const version = await runGeneration({
        prompt: promptText,
        previousHtml,
        revision: p.versions.length,
        settings: settingsRef.current,
        onStep: setSteps,
        onDelta: setStreamText,
        signal: controller.signal,
      })

      const saved = addVersion(projectId, { ...version, label: version.label || deriveTitle(promptText) })
      const index = saved?.index ?? p.versions.length + 1
      updateMessage(projectId, assistant.id, {
        content: buildSummary(version, index),
        versionId: saved?.id,
      })
      toast(`已生成 v${index}`, 'success')
    } catch (err) {
      if (isAbort(err)) {
        updateMessage(projectId, assistant.id, { content: '已手动停止本次生成。这一版没有存档，可以重新发起。' })
      } else {
        const msg = errorText(err)
        updateMessage(projectId, assistant.id, { content: `生成失败：${msg}` })
        toast('生成失败，详情见对话', 'error', { duration: 6000 })
      }
    } finally {
      window.clearInterval(timer)
      setTotalMs(Date.now() - startedAt)
      setStreamText('')
      setRunning(false)
      runningRef.current = false
      abortRef.current = null
    }
  }

  /* --------------------- 首页交接过来的第一句需求 --------------------- */
  useEffect(() => {
    if (autoRunRef.current) return
    const p = projectRef.current
    if (!p || p.messages.length > 0 || p.versions.length > 0) return
    const prompt = takeHandoff(projectId)
    if (!prompt) return
    autoRunRef.current = true
    void run(prompt)
  }, [projectId, project])

  function stop() {
    abortRef.current?.abort()
  }

  async function onShare() {
    if (!currentVersion || !project) {
      toast('先生成一版再分享', 'info')
      return
    }
    const payload: SharePayload = {
      v: 1,
      name: project.name,
      html: currentVersion.html,
      createdAt: Date.now(),
      source: currentVersion.source,
      model: currentVersion.model,
    }
    const code = await encodeShare(payload)
    const url = buildShareUrl(code)
    const ok = await copyText(url)
    toast(ok ? '分享链接已复制，发给别人即可打开试玩' : '链接已生成，请手动复制', ok ? 'success' : 'info', {
      actionLabel: '预览',
      onAction: () => window.open(url, '_blank', 'noopener'),
      duration: ok ? 5000 : 9000,
    })
    if (url.length > SHARE_WARN_LENGTH) {
      toast(`链接较长（${formatBytes(url.length)}），部分聊天工具会截断，建议改用「导出 HTML」`, 'info', { duration: 8000 })
    }
  }

  if (!project) {
    return (
      <div className="page">
        <div className="empty">
          <p>这个应用不存在或已被删除。</p>
          <button className="btn btn-primary" onClick={() => go('/')} type="button">
            <IconBack size={14} />
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-work">
      <header className="work-head">
        <button className="icon-btn" onClick={() => go('/')} title="返回首页" type="button">
          <IconBack size={16} />
        </button>
        <input
          className="title-input"
          value={project.name}
          onChange={(e) => renameProject(project.id, e.target.value)}
          aria-label="应用名称"
        />
        <span className="pill pill-soft">
          <IconSpark size={12} />
          {provider.name}
        </span>
        {currentVersion ? <span className="tag">v{currentVersion.index}</span> : null}

        <div className="work-head-right">
          <div className="seg seg-tab">
            <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')} type="button">
              <IconPlay size={12} />
              预览
            </button>
            <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')} type="button">
              <IconCode size={12} />
              代码
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTimeline((v) => !v)} type="button">
            <IconHistory size={13} />
            版本 {versions.length}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!currentVersion) return
              downloadHtml(project.name || 'app', currentVersion.html)
              toast('已导出单文件 HTML', 'success')
            }}
            type="button"
          >
            <IconDownload size={13} />
            导出
          </button>
          <button className="btn btn-primary btn-sm" onClick={onShare} type="button">
            <IconShare size={13} />
            分享
          </button>
        </div>
      </header>

      <div className={`work-body ${showTimeline ? 'with-timeline' : ''}`}>
        <section className="col col-chat">
          <ChatPanel
            project={project}
            draft={draft}
            onDraft={setDraft}
            onSubmit={() => void run(draftRef.current)}
            running={running}
            onStop={stop}
            steps={steps}
            streamText={streamText}
            totalMs={totalMs}
            onJumpVersion={(id) => {
              setCurrentVersion(project.id, id)
              setTab('preview')
            }}
            overview={enhanceOverview}
          />
        </section>

        <section className="col col-stage">
          {tab === 'preview' ? (
            <PreviewPane
              html={currentVersion?.html ?? null}
              versionKey={currentVersion?.id ?? null}
              ready={ready}
              runtimeError={runtimeError}
              busy={running}
              onRepair={() => {
                const detail = runtimeError ?? ''
                setRuntimeError(null)
                void run(
                  `上一版页面运行时报错：${detail}。请定位原因并修复，保持现有功能不变，仍然只输出完整的单文件 HTML。`,
                )
              }}
              onDismissError={() => setRuntimeError(null)}
            />
          ) : (
            <CodePane version={currentVersion} />
          )}
        </section>

        <aside className={`col col-timeline ${showTimeline ? 'open' : ''}`}>
          <VersionTimeline
            versions={versions}
            currentVersionId={project.currentVersionId}
            onSelect={(id) => {
              setCurrentVersion(project.id, id)
              setTab('preview')
            }}
            onDelete={(id) => deleteVersion(project.id, id)}
          />
        </aside>
      </div>
    </div>
  )
}

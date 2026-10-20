import { useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import PreviewPane from './PreviewPane'
import CodePane from './CodePane'
import VersionTimeline from './VersionTimeline'
import { deleteVersion, renameProject, setCurrentVersion, useStore } from '../lib/store'
import { abortRun, runProject, useRun } from '../lib/runSession'
import { findProvider } from '../lib/providers'
import { takeHandoff } from '../lib/handoff'
import { go } from '../lib/router'
import { copyText, formatBytes } from '../lib/format'
import { buildShareUrl, encodeShare, downloadHtml, SHARE_WARN_LENGTH } from '../lib/share'
import { toast } from '../lib/toast'
import { analyzeEnhancements } from '../lib/enhance'
import type { SharePayload } from '../types'
import { IconBack, IconCode, IconDownload, IconHistory, IconPlay, IconShare } from './Icons'

type Tab = 'preview' | 'code'

export default function Workbench({ projectId }: { projectId: string }) {
  const state = useStore()
  const project = state.projects.find((p) => p.id === projectId)

  const [draft, setDraft] = useState('')
  const [totalMs, setTotalMs] = useState(0)
  const [tab, setTab] = useState<Tab>('preview')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // ready 是布尔值，切设备重挂 iframe 时它可能一直是 true，光靠它触发不了重渲染，
  // 于是「装载中…」会永远不再出现。用计数代替：每次产物报到都 +1。
  const [readyPing, setReadyPing] = useState(0)
  const [showTimeline, setShowTimeline] = useState(false)

  // 生成会话住在组件外（runSession.ts）：切去别的项目时生成不中断，
  // 回来时从快照恢复现场 —— 还在跑就显示进度，已经跑完就显示执行记录。
  const run = useRun(projectId)
  const { running, steps, streamText, startedAt } = run

  const autoRunRef = useRef(false)
  const projectRef = useRef(project)
  projectRef.current = project
  const draftRef = useRef(draft)
  draftRef.current = draft

  /* 计时器只管展示：会话记下 startedAt，这里跟着它把耗时推出来 */
  useEffect(() => {
    if (!running) {
      setTotalMs(startedAt > 0 ? Date.now() - startedAt : 0)
      return
    }
    const timer = window.setInterval(() => setTotalMs(Date.now() - startedAt), 200)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

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
        setReadyPing((n) => n + 1)
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

  /* -------------------------------- 生成 -------------------------------- */
  /* 状态和编排都交给 runSession.ts，这里只负责发起 + 收起输入现场 */
  function launch(text: string) {
    setDraft('')
    setRuntimeError(null)
    setTab('preview')
    void runProject(projectId, text)
  }

  /* --------------------- 首页交接过来的第一句需求 --------------------- */
  useEffect(() => {
    if (autoRunRef.current) return
    const p = projectRef.current
    if (!p || p.messages.length > 0 || p.versions.length > 0) return
    const prompt = takeHandoff(projectId)
    if (!prompt) return
    autoRunRef.current = true
    launch(prompt)
  }, [projectId, project])

  function stop() {
    abortRun(projectId)
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
        <span className="pill pill-soft">{provider.name}</span>
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
            onSubmit={() => launch(draftRef.current)}
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
              readyPing={readyPing}
              runtimeError={runtimeError}
              busy={running}
              onRepair={() => {
                const detail = runtimeError ?? ''
                launch(
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

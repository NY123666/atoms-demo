import { useEffect, useState } from 'react'
import type { SharePayload } from '../types'
import { decodeShare, downloadHtml } from '../lib/share'
import { SANDBOX_ATTRS, instrument } from '../lib/sandbox'
import { addMessage, addVersion, createProject } from '../lib/store'
import { formatDateTime } from '../lib/format'
import { go } from '../lib/router'
import { toast } from '../lib/toast'
import { IconDownload, IconExternal, IconLayers, IconShare } from './Icons'

export default function ShareView({ code }: { code: string }) {
  const [payload, setPayload] = useState<SharePayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void decodeShare(code).then((p) => {
      if (!alive) return
      if (p) setPayload(p)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [code])

  function openStandalone() {
    if (!payload) return
    const blob = new Blob([instrument(payload.html)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function fork() {
    if (!payload) return
    const project = createProject(payload.name || '分享的应用')
    addVersion(project.id, {
      label: '从分享链接导入',
      html: payload.html,
      prompt: `通过分享链接导入「${payload.name}」`,
      createdAt: Date.now(),
      durationMs: 0,
      source: payload.source,
      model: payload.model,
      note: payload.model ? `来源模型：${payload.model}` : '来源：内置演示引擎',
    })
    addMessage(project.id, {
      role: 'assistant',
      content: `已把分享给你的「${payload.name}」导入到你的工作区，可以直接在对话里继续迭代它。`,
    })
    toast('已导入到你的工作区', 'success')
    go(`/p/${project.id}`)
  }

  if (failed) {
    return (
      <div className="page share-page">
        <div className="empty">
          <h3>这个分享链接打不开</h3>
          <p>链接可能被聊天工具截断了，或者本身不完整。请让分享者重新发一次，或改用导出的 HTML 文件。</p>
          <button className="btn btn-primary" onClick={() => go('/')} type="button">
            <IconLayers size={14} />
            回到 Forge 首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="share-page">
      <header className="share-head">
        <div className="share-title">
          <span className="brand-mark sm">F</span>
          <div>
            <strong>{payload?.name ?? '正在解析分享内容…'}</strong>
            <em>
              {payload
                ? `由 Forge 生成 · ${payload.source === 'demo' ? '演示引擎' : payload.model ?? '模型'} · ${formatDateTime(payload.createdAt)}`
                : '整份应用就压缩在这个链接里，不需要服务器'}
            </em>
          </div>
        </div>
        <div className="share-actions">
          {payload ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={fork} type="button">
                导入到我的工作区
              </button>
              <button className="btn btn-ghost btn-sm" onClick={openStandalone} type="button">
                <IconExternal size={13} />
                新窗口
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  downloadHtml(payload.name, payload.html)
                  toast('已导出单文件 HTML', 'success')
                }}
                type="button"
              >
                <IconDownload size={13} />
                下载
              </button>
            </>
          ) : null}
          <button className="btn btn-primary btn-sm" onClick={() => go('/')} type="button">
            <IconShare size={13} />
            我也要做一个
          </button>
        </div>
      </header>

      {payload ? (
        <iframe className="share-frame" title={payload.name} sandbox={SANDBOX_ATTRS} srcDoc={instrument(payload.html)} />
      ) : (
        <div className="share-loading">正在解压分享内容…</div>
      )}
    </div>
  )
}

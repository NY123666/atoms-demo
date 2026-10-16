import { useMemo, useState } from 'react'
import { SANDBOX_ATTRS, instrument } from '../lib/sandbox'
import { IconBolt, IconClose, IconExternal, IconRefresh, IconSpark } from './Icons'

interface PreviewPaneProps {
  html: string | null
  versionKey: string | null
  ready: boolean
  runtimeError: string | null
  busy: boolean
  onRepair: () => void
  onDismissError: () => void
}

type Device = 'desktop' | 'tablet' | 'phone'

export default function PreviewPane({
  html,
  versionKey,
  ready,
  runtimeError,
  busy,
  onRepair,
  onDismissError,
}: PreviewPaneProps) {
  const [device, setDevice] = useState<Device>('desktop')
  const [nonce, setNonce] = useState(0)

  const doc = useMemo(() => (html ? instrument(html) : ''), [html])

  function openStandalone() {
    if (!html) return
    const blob = new Blob([instrument(html)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  if (!html) {
    return <div className="pane-empty">生成完成后，这里会直接跑起你的应用。</div>
  }

  return (
    <div className="preview">
      <div className="pane-bar">
        <div className="pane-bar-left">
          <span className="pill pill-live">
            <span className="dot pulse" />
            真实运行在沙箱里
          </span>
          {!ready ? <span className="pane-meta">装载中…</span> : null}
        </div>
        <div className="pane-bar-right">
          <div className="seg">
            {(['desktop', 'tablet', 'phone'] as Device[]).map((d) => (
              <button key={d} className={device === d ? 'on' : ''} onClick={() => setDevice(d)} type="button">
                {d === 'desktop' ? '桌面' : d === 'tablet' ? '平板' : '手机'}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setNonce((n) => n + 1)} type="button" title="重新加载">
            <IconRefresh size={13} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={openStandalone} type="button">
            <IconExternal size={13} />
            新窗口打开
          </button>
        </div>
      </div>

      {runtimeError ? (
        <div className="runtime-error">
          <span className="re-icon">
            <IconBolt size={13} />
          </span>
          <div className="re-body">
            <strong>运行时报错</strong>
            <p>{runtimeError}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onRepair} disabled={busy} type="button">
            <IconSpark size={13} />
            {busy ? '修复中…' : '让智能体修一下'}
          </button>
          <button className="icon-btn" onClick={onDismissError} type="button" title="忽略">
            <IconClose size={13} />
          </button>
        </div>
      ) : null}

      <div className={`frame-wrap frame-${device}`}>
        <iframe
          key={`${versionKey ?? 'none'}-${nonce}`}
          className="frame"
          title="应用预览"
          sandbox={SANDBOX_ATTRS}
          srcDoc={doc}
        />
      </div>
    </div>
  )
}

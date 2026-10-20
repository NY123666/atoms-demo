import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SANDBOX_ATTRS, instrument } from '../lib/sandbox'
import { IconBolt, IconClose, IconExternal, IconRefresh, IconSpark } from './Icons'

interface PreviewPaneProps {
  html: string | null
  versionKey: string | null
  ready: boolean
  /** 每次收到产物的 {__forge:'ready'} 都会 +1。切设备会重挂 iframe，靠它判断新的一帧是否已经跑起来。 */
  readyPing: number
  runtimeError: string | null
  busy: boolean
  onRepair: () => void
  onDismissError: () => void
}

type Device = 'desktop' | 'tablet' | 'phone'

/** 等预览区尺寸的上限帧数（约 2 秒）。超时后交给 ResizeObserver / resize，不再空转。 */
const MAX_MEASURE_TRIES = 120

export default function PreviewPane({
  html,
  versionKey,
  ready,
  readyPing,
  runtimeError,
  busy,
  onRepair,
  onDismissError,
}: PreviewPaneProps) {
  const [device, setDevice] = useState<Device>('desktop')
  const [nonce, setNonce] = useState(0)
  // 预览区量到非 0 尺寸之前不挂 iframe：产物里凡是按容器宽度算布局的代码
  // （棋盘、图表、canvas）在 0 宽度下会算出一个退化的布局，之后再也不重算。
  const [staged, setStaged] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const doc = useMemo(() => (html ? instrument(html) : ''), [html])

  // 切设备要让产物重新加载一次：媒体查询、innerWidth、一次性读取的容器尺寸
  // 都只有在新的一帧里才会按新视口重算。
  const frameKey = `${versionKey ?? 'none'}-${device}-${nonce}`

  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const keyRef = useRef(frameKey)
  keyRef.current = frameKey

  useEffect(() => {
    setLoadedKey(null)
  }, [frameKey])

  useEffect(() => {
    if (readyPing > 0) setLoadedKey(keyRef.current)
  }, [readyPing])

  // 布局完成时先量一次；量不到就在接下来几帧里继续量（首屏、折叠布局、动画中）。
  useLayoutEffect(() => {
    if (!html) return
    const el = wrapRef.current
    if (!el) return
    let raf = 0
    let tries = 0
    const measure = (): boolean => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setStaged(true)
        return true
      }
      return false
    }
    const step = () => {
      if (measure() || ++tries > MAX_MEASURE_TRIES) return
      raf = requestAnimationFrame(step)
    }
    step()
    // 之后尺寸再变化（拖窗口、开合时间线、从隐藏变可见）不需要重挂 iframe，
    // 只要保证「已就绪」这个判断不会因为一次 0 高度就回退。
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [html])

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

  const loading = !ready || loadedKey !== frameKey

  return (
    <div className="preview">
      <div className="pane-bar">
        <div className="pane-bar-left">
          <span className="pill pill-live">
            <span className="dot pulse" />
            真实运行在沙箱里
          </span>
          {loading ? <span className="pane-meta">装载中…</span> : null}
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

      <div className={`frame-wrap frame-${device}`} ref={wrapRef}>
        {staged ? (
          <iframe
            key={frameKey}
            className="frame"
            title="应用预览"
            sandbox={SANDBOX_ATTRS}
            srcDoc={doc}
          />
        ) : (
          <div className="frame-pending">正在准备预览区…</div>
        )}
      </div>
    </div>
  )
}

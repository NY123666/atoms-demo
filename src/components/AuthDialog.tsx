import { useState } from 'react'
import type { FormEvent } from 'react'
import { PASSWORD_MIN, USERNAME_RULE, cryptoReady } from '../lib/accounts'
import { guestProjectCount, login, logout, register, removeAccount, useStore } from '../lib/store'
import { toast } from '../lib/toast'
import { IconCheck, IconClose, IconLock, IconTrash, IconUser } from './Icons'

/**
 * 本机账号对话框：注册 / 登录 / 退出 / 删账号。
 *
 * 这一屏最重要的是**别撒谎**：账号只存在这台浏览器里，不是安全边界，也没有"找回密码"。
 * 与其把它做得像个真的登录页，不如把边界写在脸上 —— 用户按这个前提决定要不要用。
 */
export default function AuthDialog({ onClose }: { onClose: () => void }) {
  const { account, accounts, projects, ownerId } = useStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [carryOver, setCarryOver] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canUseCrypto = cryptoReady()
  // 访客名下的应用数：注册时要如实告诉用户"这几个会被搬走"。
  const guestCount = account ? 0 : guestProjectCount()
  const others = accounts.filter((a) => a.id !== ownerId)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')

    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一样')
      return
    }

    setBusy(true)
    try {
      if (mode === 'register') {
        const res = await register(username, password, { importGuest: carryOver })
        if (!res.ok) {
          setError(res.error ?? '注册失败')
          return
        }
        const moved = res.movedProjects ?? 0
        toast(moved > 0 ? `账号已创建，搬过来 ${moved} 个应用` : '账号已创建', 'success')
      } else {
        const res = await login(username, password)
        if (!res.ok) {
          setError(res.error ?? '登录失败')
          return
        }
        toast(`已登录：${username.trim()}`, 'success')
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  function switchTo(next: 'login' | 'register', prefill = '') {
    setMode(next)
    setError('')
    setPassword('')
    setConfirm('')
    if (prefill) setUsername(prefill)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <IconUser size={16} />
            账号
          </h2>
          <button className="icon-btn" onClick={onClose} type="button" title="关闭">
            <IconClose size={16} />
          </button>
        </header>

        <div className="modal-body auth">
          {/*
            这段说明不是免责声明，而是这个功能的前提：
            用户得先知道"账号不跨设备、就是本机的一个分区"，接下来那些行为才不奇怪。
          */}
          <p className="auth-note">
            <IconLock size={13} />
            <span>
              账号只存在<strong>这台浏览器</strong>里（localStorage），换设备或换浏览器都不会同步，
              密码也没法找回。它做的是把应用、聊天、版本和 Key 按账号分开，
              <strong>不是</strong>安全边界 —— 能打开这台浏览器的人都能看到这些数据。
            </span>
          </p>

          {!canUseCrypto ? (
            <p className="auth-warn">
              当前环境不支持浏览器加密接口（crypto.subtle），没法安全地保存密码，因此这里不接受注册和登录。
              常见原因是页面通过 http 的非本机地址打开 —— 请改用 https 或 localhost 访问。
            </p>
          ) : null}

          {account ? (
            <>
              <div className="auth-me">
                <span className="auth-avatar">{account.displayName.slice(0, 1)}</span>
                <div className="auth-me-info">
                  <strong>{account.displayName}</strong>
                  <em>
                    {new Date(account.createdAt).toLocaleDateString('zh-CN')} 注册 · 名下 {projects.length} 个应用
                  </em>
                </div>
                <IconCheck size={16} />
              </div>

              <div className="auth-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    logout()
                    toast('已退出登录，回到访客模式', 'info')
                    onClose()
                  }}
                  type="button"
                >
                  退出登录
                </button>
                <button
                  className="btn btn-ghost danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除账号「${account.displayName}」？它名下的 ${projects.length} 个应用和设置会一起删掉，此操作不可撤销。`,
                      )
                    ) {
                      const name = account.displayName
                      removeAccount(account.id)
                      toast(`账号「${name}」已删除`, 'info')
                      onClose()
                    }
                  }}
                  type="button"
                >
                  <IconTrash size={14} />
                  删除账号
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="seg seg-tab auth-tabs">
                <button
                  className={mode === 'login' ? 'on' : ''}
                  onClick={() => switchTo('login')}
                  type="button"
                >
                  登录
                </button>
                <button
                  className={mode === 'register' ? 'on' : ''}
                  onClick={() => switchTo('register')}
                  type="button"
                >
                  注册
                </button>
              </div>

              <form className="auth-form" onSubmit={onSubmit}>
                <label className="field">
                  <span className="field-label">用户名</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                    placeholder={mode === 'register' ? '比如 小明' : '你的用户名'}
                    aria-label="用户名"
                  />
                  {mode === 'register' ? <em className="field-note">{USERNAME_RULE}</em> : null}
                </label>

                <label className="field">
                  <span className="field-label">
                    密码
                    <button
                      className="chip-toggle auth-eye"
                      onClick={(e) => {
                        e.preventDefault()
                        setShowPw((v) => !v)
                      }}
                      type="button"
                      title={showPw ? '隐藏密码' : '显示密码'}
                    >
                      {showPw ? '隐藏' : '显示'}
                    </button>
                  </span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'register' ? `至少 ${PASSWORD_MIN} 位` : '你的密码'}
                    aria-label="密码"
                  />
                </label>

                {mode === 'register' ? (
                  <label className="field">
                    <span className="field-label">再输一次密码</span>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      placeholder="两次要一样"
                      aria-label="确认密码"
                    />
                    <em className="field-note">
                      这里没有找回密码的渠道：本机账号没有邮箱、没有服务器，密码忘了这个账号就再也进不去了
                      （数据还在浏览器里，但取不出来）。所以多输一遍。
                    </em>
                  </label>
                ) : null}

                {mode === 'register' && guestCount > 0 ? (
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={carryOver}
                      onChange={(e) => setCarryOver(e.target.checked)}
                    />
                    <span>
                      把访客模式下的 {guestCount} 个应用和引擎设置搬到这个账号下（搬走，不保留访客副本）
                    </span>
                  </label>
                ) : null}

                {error ? <p className="auth-error">{error}</p> : null}

                <div className="auth-actions">
                  <button className="btn btn-primary" type="submit" disabled={busy || !canUseCrypto}>
                    {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
                  </button>
                  {mode === 'login' ? (
                    <button
                      className="btn btn-ghost"
                      onClick={() => switchTo('register', username)}
                      type="button"
                    >
                      没有账号？注册
                    </button>
                  ) : null}
                </div>
              </form>

              {others.length > 0 ? (
                <div className="auth-others">
                  <span className="auth-others-label">这台浏览器上还注册过：</span>
                  {others.map((a) => (
                    <button
                      key={a.id}
                      className="auth-other"
                      onClick={() => switchTo('login', a.displayName)}
                      type="button"
                    >
                      {a.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

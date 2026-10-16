import { useState } from 'react'
import { allProviders, findProvider } from '../lib/providers'
import { updateProviderSettings, updateSettings, useStore, resetEverything } from '../lib/store'
import { testConnection } from '../lib/llm'
import type { TestResult } from '../lib/llm'
import { toast } from '../lib/toast'
import { IconBolt, IconCheck, IconClose, IconExternal, IconSettings, IconSpark } from './Icons'

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useStore()
  const [selected, setSelected] = useState(settings.activeProviderId)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const def = findProvider(selected)
  const stored = settings.providers[selected] ?? { apiKey: '', baseUrl: '', model: '' }
  const isDemo = selected === 'demo'
  const isActive = settings.activeProviderId === selected

  const effectiveBaseUrl = stored.baseUrl.trim() || def.baseUrl
  const models = def.models
  const effectiveModel = stored.model.trim() || models[0] || ''

  async function onTest() {
    setTesting(true)
    setResult(null)
    const res = await testConnection({ baseUrl: effectiveBaseUrl, apiKey: stored.apiKey, model: effectiveModel })
    setResult(res)
    setTesting(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <IconSettings size={16} />
            模型设置
          </h2>
          <button className="icon-btn" onClick={onClose} type="button" title="关闭">
            <IconClose size={16} />
          </button>
        </header>

        <div className="modal-body settings">
          <div className="provider-list">
            {allProviders().map((p) => {
              const s = settings.providers[p.id]
              const configured = p.id === 'demo' ? true : Boolean(s?.apiKey?.trim())
              return (
                <button
                  key={p.id}
                  className={`provider-item ${selected === p.id ? 'on' : ''}`}
                  onClick={() => {
                    setSelected(p.id)
                    setResult(null)
                  }}
                  type="button"
                >
                  <span className={`dot ${configured ? 'ok' : 'idle'}`} />
                  <span className="pi-name">{p.name}</span>
                  {settings.activeProviderId === p.id ? <span className="pi-badge">使用中</span> : null}
                </button>
              )
            })}
          </div>

          <div className="provider-form">
            <p className="pf-hint">
              <IconBolt size={13} />
              {def.hint}
            </p>

            {isDemo ? (
              <div className="pf-demo">
                <h3>内置演示引擎</h3>
                <p>
                  不需要任何 API Key。它用内置模板库把需求落到一个真实可运行的应用上（含状态管理与本地持久化），
                  用来演示端到端链路、以及在没有密钥的环境里立刻试跑。
                </p>
                <p>想要任意形态的页面，把引擎切到下面任意一家模型服务即可 —— 全部走 OpenAI 兼容协议。</p>
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">
                    API Key
                    <a href={def.keyUrl} target="_blank" rel="noreferrer">
                      去申请
                      <IconExternal size={11} />
                    </a>
                  </span>
                  <div className="field-row">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={stored.apiKey}
                      onChange={(e) => updateProviderSettings(selected, { apiKey: e.target.value })}
                      placeholder="sk-..."
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowKey((v) => !v)} type="button">
                      {showKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <em className="field-note">只保存在这台设备的浏览器里，请求由浏览器直接发往服务商，不经过任何中间服务器。</em>
                </label>

                <label className="field">
                  <span className="field-label">Base URL</span>
                  <input
                    value={stored.baseUrl}
                    onChange={(e) => updateProviderSettings(selected, { baseUrl: e.target.value })}
                    placeholder={def.baseUrl}
                    spellCheck={false}
                  />
                  <em className="field-note">留空使用默认：{def.baseUrl}（可用于自建代理或中转）</em>
                </label>

                <label className="field">
                  <span className="field-label">模型</span>
                  <input
                    value={stored.model}
                    onChange={(e) => updateProviderSettings(selected, { model: e.target.value })}
                    placeholder={models[0] ?? ''}
                    list={`models-${def.id}`}
                    spellCheck={false}
                  />
                  <datalist id={`models-${def.id}`}>
                    {models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <em className="field-note">可填任意该服务商支持的模型名，建议选擅长写代码的。</em>
                </label>

                <div className="pf-actions">
                  <button className="btn btn-ghost" onClick={() => void onTest()} disabled={testing || !stored.apiKey.trim()} type="button">
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  <button
                    className={`btn ${isActive ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => {
                      updateSettings({ activeProviderId: selected })
                      toast(`已切换到 ${def.name}`, 'success')
                    }}
                    disabled={isActive}
                    type="button"
                  >
                    {isActive ? '当前引擎' : '设为当前引擎'}
                  </button>
                </div>

                {result ? (
                  <p className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
                    {result.ok ? <IconCheck size={13} /> : <IconClose size={13} />}
                    {result.message}
                  </p>
                ) : null}
              </>
            )}

            {isDemo && !isActive ? (
              <div className="pf-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    updateSettings({ activeProviderId: selected })
                    toast('已切换到内置演示引擎', 'success')
                  }}
                  type="button"
                >
                  <IconSpark size={14} />
                  设为当前引擎
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="modal-foot">
          <div className="switch-row">
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.autoFix}
                onChange={(e) => updateSettings({ autoFix: e.target.checked })}
              />
              <span>自检失败时自动重试修复</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.streamDemo}
                onChange={(e) => updateSettings({ streamDemo: e.target.checked })}
              />
              <span>演示引擎按真人节奏逐步执行</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.theme === 'dark'}
                onChange={(e) => updateSettings({ theme: e.target.checked ? 'dark' : 'light' })}
              />
              <span>暗色主题</span>
            </label>
          </div>
          <button
            className="btn btn-ghost btn-sm danger"
            onClick={() => {
              if (window.confirm('清空全部本地数据（所有应用、版本与 Key）？此操作不可撤销。')) {
                resetEverything()
                toast('已清空本地数据', 'info')
                onClose()
              }
            }}
            type="button"
          >
            清空本地数据
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { HOSTED_PROVIDER_ID, STATION_PROVIDER_ID, findProvider, providerChoices } from '../lib/providers'
import { hostedEnvBase, hostedOfferable, hostedUsable, refreshHosted, resetHostedStatus, useHosted } from '../lib/hosted'
import { stationApiKey, stationAvailable, stationBaseUrl, stationModel } from '../lib/station'
import { updateProviderSettings, updateSettings, useStore, resetEverything } from '../lib/store'
import { testConnection } from '../lib/llm'
import type { TestResult } from '../lib/llm'
import { toast } from '../lib/toast'
import { IconCheck, IconClose, IconExternal, IconSettings } from './Icons'

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useStore()
  const hosted = useHosted()
  const [selected, setSelected] = useState(settings.activeProviderId)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const def = findProvider(selected)
  const stored = settings.providers[selected] ?? { apiKey: '', baseUrl: '', model: '' }
  const isDemo = selected === 'demo'
  const isHosted = selected === HOSTED_PROVIDER_ID
  const isStation = selected === STATION_PROVIDER_ID
  const isActive = settings.activeProviderId === selected

  const effectiveBaseUrl = stored.baseUrl.trim() || def.baseUrl
  const models = def.models
  const effectiveModel = stored.model.trim() || models[0] || ''

  /*
   * 托管模型是一个**可能不存在**的选项（取决于有没有部署代理），所以它不进 allProviders()，
   * 而是按探测结果条件插入：
   *   - ready：能用，正常列出
   *   - exhausted / unconfigured：也列出，但点进去会明确说清"为什么现在不能用"，
   *     比直接把它藏起来好 —— 藏起来的话，昨天用过的人今天会以为功能被删了
   *   - 站长在设置里手填过地址：一律列出，否则他连自己填的地址都看不到
   */
  const showHosted = hostedOfferable(hosted) || Boolean(settings.hostedBase.trim())

  /*
   * 内置模型判起来比托管模型简单得多：它要么在这一次构建里（Key 打进了包），要么就整个不存在。
   * 没有"探测中""额度用完""站长没配上游"这些中间态 —— 所以只有 available 一个布尔值，
   * 不可用时就干脆不列出来（列出来也修不好：访客手上没有能填的东西）。
   */
  const showStation = stationAvailable()

  const list = providerChoices(showHosted, showStation)

  /** 列表左边那个小圆点：绿＝现在就能用。三类的"能用"定义不同，所以分开判断。 */
  function providerReady(p: { id: string }): boolean {
    if (p.id === 'demo') return true
    if (p.id === HOSTED_PROVIDER_ID) return hostedUsable(hosted)
    if (p.id === STATION_PROVIDER_ID) return stationAvailable()
    return Boolean(settings.providers[p.id]?.apiKey?.trim())
  }

  async function onTest() {
    setTesting(true)
    setResult(null)
    const res = isHosted
      ? await testHosted()
      : isStation
        ? // 真发一次请求到上游：这就是验证"内置的 Key 到底还能不能用"的唯一办法。
          // 会花掉一点点额度，但换来的是真话 —— 不然这张卡片上只能写"应该能用"。
          await testConnection({ baseUrl: stationBaseUrl(), apiKey: stationApiKey(), model: stationModel() })
        : await testConnection({ baseUrl: effectiveBaseUrl, apiKey: stored.apiKey, model: effectiveModel })
    setResult(res)
    setTesting(false)
  }

  /** 托管模式的「测试连接」：等价于重新探一次 /api/health，不花上游一分钱。 */
  async function testHosted(): Promise<TestResult> {
    const started = performance.now()
    const found = await refreshHosted({ override: settings.hostedBase, envBase: hostedEnvBase() })
    const latencyMs = Math.round(performance.now() - started)
    return {
      ok: hostedUsable(found),
      message: found.message,
      latencyMs,
    }
  }

  function useProvider(id: string, name: string) {
    // providerChosen 一旦置位，App 的开机自动切换就再也不碰这个用户的选择了。
    updateSettings({ activeProviderId: id, providerChosen: true })
    toast(`已切换到 ${name}`, 'success')
  }

  /** 三段面板共用同一份结果行，避免三处各写一遍图标与配色。 */
  const resultNode = result ? (
    <p className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
      {result.ok ? <IconCheck size={13} /> : <IconClose size={13} />}
      {result.message}
    </p>
  ) : null

  const quotaText = (() => {
    if (hosted.state === 'unknown' || hosted.state === 'checking') return '检测中…'
    if (hosted.state === 'offline') return '没有可用代理'
    const parts: string[] = []
    if (typeof hosted.remainingForYou === 'number') parts.push(`你今天还剩 ${hosted.remainingForYou} 次`)
    if (typeof hosted.dailyGlobal === 'number') {
      parts.push(`全站今日 ${hosted.usedGlobal ?? '?'} / ${hosted.dailyGlobal}`)
    }
    return parts.join(' · ') || '额度未知'
  })()

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
            {list.map((p) => (
              <button
                key={p.id}
                className={`provider-item ${selected === p.id ? 'on' : ''}`}
                onClick={() => {
                  setSelected(p.id)
                  setResult(null)
                }}
                type="button"
              >
                <span className={`dot ${providerReady(p) ? 'ok' : 'idle'}`} />
                <span className="pi-name">{p.name}</span>
                {settings.activeProviderId === p.id ? <span className="pi-badge">使用中</span> : null}
              </button>
            ))}
          </div>

          <div className="provider-form">
            <p className="pf-hint">{def.hint}</p>

            {isDemo ? (
              <div className="pf-demo">
                <h3>内置演示引擎</h3>
                <p>
                  不需要任何 API Key。它用内置模板库把需求落到一个真实可运行的应用上（含状态管理与本地持久化），
                  用来演示端到端链路、以及在没有密钥的环境里立刻试跑。
                </p>
                <p>想要任意形态的页面，把引擎切到下面任意一家模型服务即可 —— 全部走 OpenAI 兼容协议。</p>
              </div>
            ) : isStation ? (
              <div className="pf-demo">
                <h3>本站内置模型</h3>
                <p>
                  由本站预置的 Key 直接调用真模型，你不需要 API Key、不需要注册、不需要填写任何地址 ——
                  打开就能用。
                </p>

                <ul className="pf-facts">
                  <li>
                    <span>调用的模型</span>
                    <b>{stationModel()}</b>
                  </li>
                  <li>
                    <span>请求发往</span>
                    <b>{stationBaseUrl().replace(/^https?:\/\//, '')}</b>
                  </li>
                </ul>

                {/*
                  这段是这个面板存在的理由，不是为了合规而写的一句套话：
                  内置 Key 和「托管模型」在技术上完全是两回事（那个跑在服务端、浏览器拿不到），
                  这里的 Key 就明明白白在页面 JS 里。不写清楚，访客会以为两者一样安全。
                  写清楚了，懂的人自然知道该切到下面自带 Key 的方案。
                */}
                <p className="pf-warn">
                  注意：这个 Key 是打包进网页的，懂技术的人查看页面源码就能找到它 —— 零配置的代价就是藏不住。
                  请不要用它处理机密或敏感数据。介意的话，用下面任意一家「自带 Key」的服务商 ——
                  那种方式下 Key 只存在你自己的浏览器里。
                </p>

                <div className="pf-actions">
                  <button className="btn btn-ghost" onClick={() => void onTest()} disabled={testing} type="button">
                    {testing ? '检测中…' : '测试连接'}
                  </button>
                  <button
                    className={`btn ${isActive ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => useProvider(STATION_PROVIDER_ID, def.name)}
                    disabled={isActive}
                    type="button"
                  >
                    {isActive ? '当前引擎' : '设为当前引擎'}
                  </button>
                </div>

                {resultNode}
              </div>
            ) : isHosted ? (
              <div className="pf-demo">
                <h3>托管模型</h3>
                <p>
                  由本站付费调用真模型，你不需要 API Key、不需要注册、不需要填写任何地址。
                  请求发往本站的代理，上游密钥只存在服务端，浏览器里拿不到。
                </p>

                <ul className="pf-facts">
                  <li>
                    <span>服务端调用的模型</span>
                    <b>{hosted.model ?? '—'}</b>
                  </li>
                  <li>
                    <span>当前额度</span>
                    <b>{quotaText}</b>
                  </li>
                </ul>

                <p className="pf-warn">{hosted.message}</p>

                <label className="field">
                  <span className="field-label">自建代理地址（可选）</span>
                  <input
                    value={settings.hostedBase}
                    onChange={(e) => {
                      updateSettings({ hostedBase: e.target.value })
                      // 地址变了，旧结论立刻作废：宁可短暂地显示"检测中"，也不要显示一个错的状态。
                      resetHostedStatus()
                    }}
                    placeholder="https://your-proxy.vercel.app"
                    spellCheck={false}
                  />
                  <em className="field-note">
                    留空则用本站自带的代理（同源 /api 或构建时指定的地址）。填了就以你填的为准，
                    可用于自建代理或换一个上游。地址不是密钥，公开无妨。
                  </em>
                </label>

                <div className="pf-actions">
                  <button className="btn btn-ghost" onClick={() => void onTest()} disabled={testing} type="button">
                    {testing ? '检测中…' : '重新检测'}
                  </button>
                  <button
                    className={`btn ${isActive ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => useProvider(HOSTED_PROVIDER_ID, def.name)}
                    disabled={isActive || !hostedUsable(hosted)}
                    type="button"
                  >
                    {isActive ? '当前引擎' : '设为当前引擎'}
                  </button>
                </div>

                {resultNode}
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
                    onClick={() => useProvider(selected, def.name)}
                    disabled={isActive}
                    type="button"
                  >
                    {isActive ? '当前引擎' : '设为当前引擎'}
                  </button>
                </div>

                {resultNode}
              </>
            )}

            {isDemo && !isActive ? (
              <div className="pf-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => useProvider(selected, def.name)}
                  type="button"
                >
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
              if (
                window.confirm(
                  '清空全部本地数据（这台浏览器上的所有账号、应用、版本与 Key）？此操作不可撤销。',
                )
              ) {
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

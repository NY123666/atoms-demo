import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Workbench from './components/Workbench'
import SettingsDialog from './components/SettingsDialog'
import ShareView from './components/ShareView'
import Toaster from './components/Toaster'
import { go, useRoute } from './lib/router'
import { dismissPersistError, getState, updateSettings, useStore } from './lib/store'
import { decideHostedSwitch, hostedEnvBase, refreshHosted } from './lib/hosted'
import { toast } from './lib/toast'
import { IconClose } from './components/Icons'

export default function App() {
  const route = useRoute()
  const { settings, persistError } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(route.name === 'settings')

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    if (route.name === 'settings') setSettingsOpen(true)
  }, [route.name])

  /*
   * 开机探测一次托管代理，然后按 decideHostedSwitch 的结论决定要不要替访客换引擎。
   * 策略本身是纯函数（src/lib/hosted.ts），这里只负责"探、应用、通知"三件事。
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      const found = await refreshHosted({
        override: getState().settings.hostedBase,
        envBase: hostedEnvBase(),
      })
      // 探测是异步的，期间组件可能已经卸载（路由切走、页面关闭），这时不要再改全局状态。
      if (!alive) return

      const { settings: now } = getState()
      const decision = decideHostedSwitch(found, now)
      if (decision.kind === 'none' || !decision.providerId) return

      updateSettings({ activeProviderId: decision.providerId })
      toast(decision.message ?? '', decision.kind === 'adopt' ? 'success' : 'info', {
        actionLabel: '引擎设置',
        onAction: () => go('/settings'),
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  function closeSettings() {
    setSettingsOpen(false)
    if (route.name === 'settings') go('/')
  }

  if (route.name === 'share') {
    return (
      <>
        <ShareView code={route.code} />
        <Toaster />
      </>
    )
  }

  const activeProjectId = route.name === 'project' ? route.id : null

  return (
    <div className="shell">
      <Sidebar activeProjectId={activeProjectId} />

      <main className="main">
        {persistError ? (
          <div className="banner">
            <span>{persistError}</span>
            <button className="icon-btn" onClick={dismissPersistError} type="button" title="知道了">
              <IconClose size={13} />
            </button>
          </div>
        ) : null}

        {route.name === 'project' ? (
          <Workbench key={route.id} projectId={route.id} />
        ) : (
          <Dashboard />
        )}
      </main>

      {settingsOpen ? <SettingsDialog onClose={closeSettings} /> : null}
      <Toaster />
    </div>
  )
}

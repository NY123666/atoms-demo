import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Workbench from './components/Workbench'
import SettingsDialog from './components/SettingsDialog'
import AuthDialog from './components/AuthDialog'
import ShareView from './components/ShareView'
import Toaster from './components/Toaster'
import { go, useRoute } from './lib/router'
import { dismissPersistError, getState, updateSettings, useStore } from './lib/store'
import { decideHostedSwitch, hostedEnvBase, refreshHosted } from './lib/hosted'
import { decideStationSwitch } from './lib/station'
import { toast } from './lib/toast'
import { IconClose, IconUser } from './components/Icons'

export default function App() {
  const route = useRoute()
  const { settings, persistError, account, ownerId, projects } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(route.name === 'settings')
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    if (route.name === 'settings') setSettingsOpen(true)
  }, [route.name])

  /*
   * 路由指向的应用在当前分区里不存在就回首页。
   *
   * 这一条是给"切账号"兜底的：退出登录会把分区换成访客那份，地址栏里却还留着上一个账号的
   * #/p/xxx —— 那个应用在新分区里根本不存在。不处理的话用户看到的是「这个应用不存在或已被
   * 删除。」配一条属于别人的旧地址，既像出了故障，又把这串 id 留在了他的浏览记录里。
   * 顺带把"删掉正在看的应用"也收成同一个结果：回到首页，而不是停在一张空页上。
   */
  useEffect(() => {
    if (route.name === 'project' && !projects.some((p) => p.id === route.id)) go('/')
  }, [route, projects])

  /*
   * 开机替访客选一次引擎，让他"点开就能用"。两条策略都是纯函数，这里只负责"探、应用、通知"。
   *
   * 顺序是有讲究的，而且顺序本身就是优先级：
   *   1) 托管代理（src/lib/hosted.ts）—— 它跑在服务端，Key 浏览器拿不到，而且有按 IP / 全站的
   *      每日上限兜住账单，是**首选**；探到能用就切过去。
   *   2) 本站内置模型（src/lib/station.ts）—— Key 打在页面里，没有任何上限，属于保底手段。
   *      所以它排在后面，而且只在"当前还是演示引擎"时才生效。
   *
   * 于是三种情况都落得干净：代理能用 → 用代理；代理没部署但构建里内置了 Key → 用内置；
   * 两者都没有 → 留在演示引擎，什么都不切。
   * 顺带一个好处：代理哪天挂了，第 1 步会把人退回演示引擎，第 2 步紧接着把他接到内置模型上 ——
   * 对访客来说就是"真模型一直在线"，而不是悄悄降级成模板。
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

      const { settings: afterHosted } = getState()
      const hostedDecision = decideHostedSwitch(found, afterHosted)
      if (hostedDecision.kind !== 'none' && hostedDecision.providerId) {
        updateSettings({ activeProviderId: hostedDecision.providerId })
        toast(hostedDecision.message ?? '', hostedDecision.kind === 'adopt' ? 'success' : 'info', {
          actionLabel: '引擎设置',
          onAction: () => go('/settings'),
        })
        // 代理刚被采用时不通知内置模型那条路径（它只认演示引擎起步），直接收工。
        if (hostedDecision.kind === 'adopt') return
      }

      // 重新读一次状态：上面可能刚改过 activeProviderId，不能用 afterHosted 那个旧快照。
      const { settings: now } = getState()
      const stationDecision = decideStationSwitch(now)
      if (stationDecision.kind === 'none' || !stationDecision.providerId) return

      updateSettings({ activeProviderId: stationDecision.providerId })
      /*
       * 两条通知都弹会叠成一摞，所以代理刚把人退回演示引擎时就不再弹第二条
       * （那种情况下第 2 条其实更值得说，但两条一起说反而像出了两个问题）。
       */
      if (hostedDecision.kind !== 'none') return
      toast(stationDecision.message ?? '', stationDecision.kind === 'adopt' ? 'success' : 'info', {
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
      <Sidebar activeProjectId={activeProjectId} onOpenAuth={() => setAuthOpen(true)} />

      {/*
        窄屏（≤900px）侧边栏整个隐藏，账号入口会跟着一起消失，所以这里另给一条顶栏。
        桌面端它是 display:none —— 账号入口始终只出现在一个地方，不会重复。
      */}
      <div className="topbar">
        <button className="brand brand-sm" onClick={() => go('/')} type="button">
          <span className="brand-mark sm">F</span>
          <strong>Forge</strong>
        </button>
        <button
          className={`account-chip ${account ? 'on' : ''}`}
          onClick={() => setAuthOpen(true)}
          type="button"
        >
          <IconUser size={13} />
          {account ? account.displayName : '访客模式'}
        </button>
      </div>

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
          /*
           * key 里带上 ownerId：只写 route.id 的话，换账号时 id 没变，React 会复用同一个
           * Workbench 实例，于是上一个账号的草稿、步骤列表、正在流式输出的文本都跟着留在
           * 界面上 —— 分区换了，内存里的界面状态没换。加上 ownerId 就变成"换账号 = 重挂组件"，
           * 局部状态跟着一起清掉，不需要在 Workbench 里手写一堆 reset。
           */
          <Workbench key={`${ownerId}:${route.id}`} projectId={route.id} />
        ) : (
          <Dashboard />
        )}
      </main>

      {settingsOpen ? <SettingsDialog onClose={closeSettings} /> : null}
      {authOpen ? <AuthDialog onClose={() => setAuthOpen(false)} /> : null}
      <Toaster />
    </div>
  )
}

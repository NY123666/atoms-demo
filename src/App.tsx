import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Workbench from './components/Workbench'
import SettingsDialog from './components/SettingsDialog'
import ShareView from './components/ShareView'
import Toaster from './components/Toaster'
import { go, useRoute } from './lib/router'
import { useStore, dismissPersistError } from './lib/store'
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

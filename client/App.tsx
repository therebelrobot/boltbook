import { useCallback, useEffect, useState } from 'react'
import { getStatus } from './api'
import { AppShell } from './components/AppShell'
import { ToastProvider } from './components/Toast'
import { AccessScreen } from './screens/AccessScreen'
import { PatternsScreen } from './screens/PatternsScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StashScreen } from './screens/StashScreen'
import { navigate, tabNames, useRoute, type TabName } from './router'
import { UnitProvider } from './unitPreference'
import type { AuthStatus } from '../shared/model'

const TITLES: Record<TabName, { title: string; subtitle?: string }> = {
  stash: { title: 'boltbook', subtitle: 'the stash' },
  patterns: { title: 'Patterns' },
  projects: { title: 'Projects' },
  search: { title: 'Search' },
}

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const route = useRoute()

  const refresh = useCallback(async () => {
    try {
      setStatus(await getStatus())
      setUnreachable(false)
    } catch {
      setUnreachable(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeTab: TabName = (tabNames as readonly string[]).includes(route.name) ? (route.name as TabName) : 'stash'

  if (unreachable) {
    return (
      <div className="center">
        <p className="error">Cannot reach the server.</p>
      </div>
    )
  }
  if (!status) return <p className="empty">Loading…</p>
  if (!status.claimed || !status.signedIn) return <AccessScreen status={status} onSignedIn={() => void refresh()} />

  return (
    <UnitProvider>
      <ToastProvider>
        <AppShell
          title={TITLES[activeTab].title}
          subtitle={TITLES[activeTab].subtitle}
          activeTab={activeTab}
          onOpenSettings={() => setSettingsOpen(true)}
        >
          {activeTab === 'stash' && <StashScreen />}
          {activeTab === 'patterns' && <PatternsScreen />}
          {activeTab === 'projects' && <ProjectsScreen />}
          {activeTab === 'search' && <SearchScreen onOpenTab={(tab) => navigate(tab)} />}
        </AppShell>

        {settingsOpen && (
          <SettingsScreen
            onClose={() => setSettingsOpen(false)}
            onSignedOut={() => {
              setSettingsOpen(false)
              void refresh()
            }}
          />
        )}
      </ToastProvider>
    </UnitProvider>
  )
}

import type { ReactNode } from 'react'
import { navigate, tabNames, type TabName } from '../router'

const GLYPHS: Record<TabName, string> = {
  stash: '🧵',
  patterns: '📐',
  projects: '🪡',
  search: '🔍',
}

const LABELS: Record<TabName, string> = {
  stash: 'Stash',
  patterns: 'Patterns',
  projects: 'Projects',
  search: 'Search',
}

interface AppShellProps {
  title: string
  subtitle?: string
  activeTab: TabName
  onOpenSettings: () => void
  children: ReactNode
}

/** Header, one scroll container, bottom tabs. The phone shape (design brief §3). */
export function AppShell({ title, subtitle, activeTab, onOpenSettings, children }: AppShellProps) {
  return (
    <div className="shell">
      <header className="header">
        <h1>
          {title}
          {subtitle && <span className="sub">{subtitle}</span>}
        </h1>
        <button type="button" className="button plain" onClick={onOpenSettings} aria-label="Settings">
          Settings
        </button>
      </header>
      <main className="main">{children}</main>
      <nav className="tabs" aria-label="Sections">
        {tabNames.map((tab) => (
          <button
            type="button"
            key={tab}
            className="tab"
            aria-current={tab === activeTab}
            onClick={() => navigate(tab)}
          >
            <span className="glyph" aria-hidden="true">
              {GLYPHS[tab]}
            </span>
            {LABELS[tab]}
          </button>
        ))}
      </nav>
    </div>
  )
}

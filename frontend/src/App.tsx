import { Boxes, History, ListChecks, Settings as SettingsIcon, Swords } from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ModelsPage } from './pages/ModelsPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { RunsPage } from './pages/RunsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { cx } from './components/ui'
import { useSelection } from './state/selection'

const NAV = [
  { to: '/models', label: 'Modelle', icon: Boxes },
  { to: '/tasks', label: 'Aufgaben', icon: ListChecks },
  { to: '/runs', label: 'Runs', icon: History },
  { to: '/settings', label: 'Einstellungen', icon: SettingsIcon },
]

export default function App() {
  const selection = useSelection()

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-accent-500" />
            <span className="text-sm font-semibold tracking-tight">Agent Arena</span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition',
                    isActive
                      ? 'bg-ink-800 text-ink-100'
                      : 'text-ink-400 hover:bg-ink-850 hover:text-ink-100',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
                {to === '/models' && selection.selected.length > 0 && (
                  <span className="ml-0.5 rounded bg-accent-600 px-1.5 py-px text-[10px] font-semibold text-white">
                    {selection.selected.length}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/models" replace />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/models" replace />} />
        </Routes>
      </main>
    </div>
  )
}

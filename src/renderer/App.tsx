import { useEffect, useState, useCallback } from 'react'
import type { MetricsDelta, HudMetrics, AlertEvent, DataFreshnessStatus } from '@shared/types'
import DashboardPage from './pages/DashboardPage'
import HudPage from './pages/HudPage'
import SettingsPage from './pages/SettingsPage'
import CommandPalette from './components/CommandPalette'
import { useBalanceStore } from './stores/useBalanceStore'
import { usePlatformStore } from './stores/usePlatformStore'
import './i18n'

type WindowType = 'dashboard' | 'hud' | 'metric-card' | 'settings'

function App(): React.ReactElement {
  const [windowType, setWindowType] = useState<WindowType>('dashboard')
  const [ready, setReady] = useState(false)
  const [activeRoute, setActiveRoute] = useState('/')
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)

  const applyDelta = useBalanceStore(s => s.applyDelta)
  const applyHudMetrics = useBalanceStore(s => s.applyHudMetrics)
  const fetchInstances = usePlatformStore(s => s.fetchInstances)
  const fetchDefinitions = usePlatformStore(s => s.fetchDefinitions)
  const fetchStatuses = useBalanceStore(s => s.fetchStatuses)

  useEffect(() => {
    if (window.electronAPI) {
      const type = window.electronAPI.getWindowType() as WindowType
      setWindowType(type)

      // Load platform data
      fetchDefinitions()
      fetchInstances()
      fetchStatuses()
    }
    setReady(true)
  }, [])

  // Subscribe to IPC events
  useEffect(() => {
    if (!window.electronAPI) return

    const unsubMetrics = window.electronAPI.onMetricsUpdate((delta: MetricsDelta) => {
      applyDelta(delta)
    })

    const unsubHud = window.electronAPI.onHudUpdate((metrics: HudMetrics) => {
      applyHudMetrics(metrics)
    })

    // Listen for navigation commands from main process (tray menu)
    const unsubNav = window.electronAPI.onNavigate((route: string) => {
      setActiveRoute(route)
    })

    return () => {
      unsubMetrics()
      unsubHud()
      unsubNav()
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Ctrl+Shift+P → Command Palette
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setCmdPaletteOpen(true)
      }
      // ? → Keyboard shortcuts overlay (only when not in input)
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setCmdPaletteOpen(true)
      }
      // Escape → close palette
      if (e.key === 'Escape' && cmdPaletteOpen) {
        setCmdPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cmdPaletteOpen])

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <span className="text-zinc-600 font-mono text-sm animate-pulse">dsmonitor</span>
      </div>
    )
  }

  return (
    <>
      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />

      {windowType === 'hud' && <HudPage />}
      {windowType === 'settings' && <SettingsPage />}
      {(windowType === 'dashboard' || windowType === 'metric-card') && (
        activeRoute === '/settings'
          ? <SettingsPage onBack={() => setActiveRoute('/')} />
          : <DashboardPage onNavigateSettings={() => setActiveRoute('/settings')} />
      )}
    </>
  )
}

export default App

import { useEffect, useState } from 'react'
import { useBalanceStore } from '../stores/useBalanceStore'
import { usePlatformStore } from '../stores/usePlatformStore'
import { PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } from '@shared/constants'
import { safeFixed, safeLocale } from '../components/ErrorBoundary'
import type { PlatformStatus } from '@shared/types'

// ============================================================
// Dashboard Page — Main analytics view
// ============================================================

interface Props {
  onNavigateSettings?: () => void
}

export default function DashboardPage({ onNavigateSettings }: Props): React.ReactElement {
  const statuses = useBalanceStore(s => s.statuses)
  const burnRate = useBalanceStore(s => s.burnRate)
  const hudMetrics = useBalanceStore(s => s.hudMetrics)
  const instances = usePlatformStore(s => s.instances)
  const fetchStatuses = useBalanceStore(s => s.fetchStatuses)
  const fetchInstances = usePlatformStore(s => s.fetchInstances)

  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'alerts'>('overview')

  useEffect(() => {
    fetchInstances()
    fetchStatuses()
  }, [])

  const configuredInstances = instances.filter(i => i.hasKey && i.status !== 'unconfigured')
  const statusValues = Object.values(statuses)

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Title Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold font-mono text-zinc-50 tracking-tight">dsmonitor</h1>
          <span className="text-xs text-zinc-600 font-mono">v0.1.0</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchStatuses()}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Refresh
          </button>
          {onNavigateSettings && (
            <button
              onClick={onNavigateSettings}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Settings
            </button>
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="flex gap-1 px-6 py-2 border-b border-zinc-800/50 shrink-0">
        {(['overview', 'usage', 'alerts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'usage' ? 'Usage' : 'Alerts'}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {/* Hero stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Today"
            labelCn="今天"
            value={hudMetrics !== null ? `¥${safeFixed(hudMetrics.todaySpend)}` : '—'}
            subtitle={burnRate ? `${burnRate.trend === 'increasing' ? '↑' : burnRate.trend === 'decreasing' ? '↓' : '→'} trend` : undefined}
          />
          <StatCard
            label="Burn Rate"
            labelCn="烧钱速率"
            value={burnRate ? `¥${safeFixed(burnRate.hourly)}/h` : '—'}
            subtitle={burnRate ? `~¥${safeFixed(burnRate.daily)}/day` : undefined}
          />
          <StatCard
            label="Month Projection"
            labelCn="本月预测"
            value={burnRate ? `¥${safeFixed(burnRate.monthlyProjection, 0)}` : '—'}
            subtitle={burnRate ? `${burnRate.pace.replace('_', ' ')}` : undefined}
            alert={burnRate?.pace === 'critical' || burnRate?.pace === 'over_budget'}
          />
          <StatCard
            label="Active Alerts"
            labelCn="活跃告警"
            value={hudMetrics ? `${hudMetrics.activeAlertCount}` : '0'}
            alert={(hudMetrics?.activeAlertCount ?? 0) > 0}
          />
        </div>

        {/* Platform Cards */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Platforms</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {configuredInstances.length === 0 && (
                <EmptyState onSettings={onNavigateSettings} />
              )}
              {configuredInstances.map(inst => {
                const status = statuses[inst.id]
                return (
                  <PlatformCard
                    key={inst.id}
                    instance={inst}
                    status={status}
                  />
                )
              })}
            </div>
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="text-center text-zinc-500 py-12">
            <p className="text-lg">Usage details coming soon</p>
            <p className="text-sm mt-2">Charts and model breakdown will appear here</p>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="text-center text-zinc-500 py-12">
            <p className="text-lg">Alert management coming soon</p>
            <p className="text-sm mt-2">Configure thresholds in Settings</p>
          </div>
        )}
      </main>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({ label, labelCn, value, subtitle, alert }: {
  label: string; labelCn: string; value: string; subtitle?: string; alert?: boolean
}): React.ReactElement {
  return (
    <div className={`glass-surface rounded-xl p-4 ${alert ? 'border-red-400/30' : ''}`}>
      <div className="text-xs text-zinc-500 mb-1">{labelCn} / {label}</div>
      <div className={`text-2xl font-bold tabular-nums-mono mb-1 ${alert ? 'text-red-400' : 'text-zinc-100'}`}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-zinc-500">{subtitle}</div>}
    </div>
  )
}

function PlatformCard({ instance, status }: {
  instance: { id: string; definitionId: string; label: string; status: string }
  status?: PlatformStatus
}): React.ReactElement {
  const color = PLATFORM_COLORS[instance.definitionId] || DEFAULT_PLATFORM_COLOR
  const freshness = status?.dataFreshness || 'unknown'

  return (
    <div
      className={`glass-surface rounded-xl p-4 transition-all hover:border-zinc-600/50 ${
        freshness === 'expired' ? 'opacity-50' :
        freshness === 'stale' ? 'opacity-75' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-zinc-300">{instance.label}</span>
        </div>
        <FreshnessDot status={freshness} />
      </div>

      {/* Metrics */}
      {status ? (
        <div className="space-y-1.5">
          {status.metrics.slice(0, 4).map(m => (
            <div key={m.key} className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">{m.label}</span>
              <span className={`text-sm tabular-nums-mono font-medium ${
                m.severity === 'critical' ? 'text-red-400' :
                m.severity === 'warning' ? 'text-amber-400' : 'text-zinc-200'
              }`}>
                {safeLocale(m.value)}{m.unit}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
        </div>
      )}

      {/* Stale indicator */}
      {freshness === 'stale' && (
        <div className="mt-3 text-xs text-amber-400/80">Data may be stale</div>
      )}
      {freshness === 'expired' && (
        <div className="mt-3 text-xs text-red-400/80">Data expired — retrying...</div>
      )}
    </div>
  )
}

function FreshnessDot({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    fresh: 'bg-emerald-400',
    stale: 'bg-amber-400',
    expired: 'bg-red-400',
    unknown: 'bg-zinc-600'
  }
  return (
    <div
      className={`w-2 h-2 rounded-full ${colors[status] || colors.unknown}`}
      title={`Data: ${status}`}
    />
  )
}

function EmptyState({ onSettings }: { onSettings?: () => void }): React.ReactElement {
  return (
    <div className="col-span-full glass-surface rounded-xl p-8 text-center">
      <div className="text-4xl mb-4">🔌</div>
      <h3 className="text-lg font-medium text-zinc-300 mb-2">No Platforms Configured</h3>
      <p className="text-sm text-zinc-500 mb-4">
        Add API keys for DeepSeek, GLM Coding Plan, OpenRouter, or other AI platforms to get started.
      </p>
      {onSettings && (
        <button
          onClick={onSettings}
          className="px-4 py-2 bg-violet-400/20 text-violet-400 rounded-lg text-sm hover:bg-violet-400/30 transition-colors"
        >
          Configure Platforms →
        </button>
      )}
    </div>
  )
}

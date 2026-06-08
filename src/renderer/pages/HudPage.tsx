import { useEffect, useState, useCallback } from 'react'
import { useBalanceStore } from '../stores/useBalanceStore'
import { usePlatformStore } from '../stores/usePlatformStore'
import { PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } from '@shared/constants'
import type { PlatformStatus } from '@shared/types'

// ============================================================
// HUD Page — Mini floating bar, always-on-top
// 2-number design: today's spend + progress bar
// ============================================================

export default function HudPage(): React.ReactElement {
  const hudMetrics = useBalanceStore(s => s.hudMetrics)
  const statuses = useBalanceStore(s => s.statuses)
  const instances = usePlatformStore(s => s.instances)
  const fetchStatuses = useBalanceStore(s => s.fetchStatuses)
  const fetchInstances = usePlatformStore(s => s.fetchInstances)

  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchInstances()
    fetchStatuses()
  }, [])


  const configuredInstances = instances.filter(i => i.hasKey && i.status !== 'unconfigured')
  const todaySpend = hudMetrics?.todaySpend ?? 0
  const monthSpend = hudMetrics?.monthSpend ?? 0
  const budgetPercent = hudMetrics?.dailyBudgetPercent ?? 0
  const freshness = hudMetrics?.overallStatus ?? 'unknown'
  const activeAlerts = hudMetrics?.activeAlertCount ?? 0

  return (
    <div
      className={`hud-drag glass-surface h-screen flex flex-col overflow-hidden transition-all duration-300 ease-out ${
        expanded ? 'h-[280px]' : ''
      }`}
      style={{
        borderRadius: expanded ? '16px' : '10px',
        border: freshness === 'expired'
          ? '1px solid rgba(248,113,113,0.3)'
          : freshness === 'stale'
            ? '1px solid rgba(251,191,36,0.2)'
            : '1px solid rgba(255,255,255,0.08)'
      }}
    >
      {/* Compact bar (always visible) */}
      <div
        className="hud-no-drag flex items-center justify-between px-3 min-h-[36px] cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Progress bar + spend */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Budget progress bar */}
          <div className="flex-1 h-0.5 bg-zinc-700/50 rounded-full overflow-hidden max-w-[100px]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                budgetPercent > 90 ? 'bg-red-400' :
                budgetPercent > 70 ? 'bg-amber-400' :
                'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(budgetPercent, 100)}%` }}
            />
          </div>

          {/* Today's spend */}
          <span className={`tabular-nums-mono text-sm font-semibold ${
            freshness === 'expired' ? 'text-red-400/60' :
            freshness === 'stale' ? 'text-amber-400/80' :
            'text-zinc-50'
          }`}>
            ¥{todaySpend.toFixed(2)}
          </span>
        </div>

        {/* Alert indicator */}
        {activeAlerts > 0 && (
          <span className="ml-2 flex items-center justify-center w-5 h-5 rounded-full bg-red-400/20 text-red-400 text-[10px] font-bold">
            {activeAlerts}
          </span>
        )}
      </div>

      {/* Expanded popover content */}
      {expanded && (
        <div className="hud-no-drag flex-1 px-4 py-3 space-y-3 overflow-auto border-t border-zinc-700/30">
          {/* Summary */}
          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums-mono text-zinc-100">
              ¥{todaySpend.toFixed(2)}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">Today / 今天</div>
            {monthSpend > 0 && (
              <div className="text-xs text-zinc-600 mt-0.5">
                ¥{monthSpend.toFixed(2)} this month
              </div>
            )}
          </div>

          {/* Platform pills */}
          {configuredInstances.length > 0 && (
            <div className="space-y-1.5">
              {configuredInstances.map(inst => {
                const status = statuses[inst.id]
                const color = PLATFORM_COLORS[inst.definitionId] || DEFAULT_PLATFORM_COLOR
                const mainMetric = status?.metrics.find(m =>
                  m.key === 'total_balance' || m.key === 'remaining' || m.key.startsWith('quota_')
                )
                return (
                  <div key={inst.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-xs text-zinc-400">{inst.label}</span>
                    </div>
                    {mainMetric && (
                      <span className={`text-xs tabular-nums-mono ${
                        mainMetric.severity === 'critical' ? 'text-red-400' :
                        mainMetric.severity === 'warning' ? 'text-amber-400' :
                        'text-zinc-300'
                      }`}>
                        {mainMetric.value.toLocaleString()}{mainMetric.unit}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* No platforms */}
          {configuredInstances.length === 0 && (
            <div className="text-center text-xs text-zinc-600 py-4">
              No platforms configured.
              <br />Open the dashboard to add API keys.
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-2 pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); /* refresh */ }}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 rounded-md transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.electronAPI?.showDashboard();
              }}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 rounded-md transition-colors"
            >
              Dashboard →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

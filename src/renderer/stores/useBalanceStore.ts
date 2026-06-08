import { create } from 'zustand'
import type { PlatformStatus, BurnRate, HudMetrics, MetricsDelta } from '@shared/types'

interface BalanceState {
  statuses: Record<string, PlatformStatus>  // keyed by instanceId
  burnRate: BurnRate | null
  hudMetrics: HudMetrics | null
  lastSequenceId: number
  isLoading: boolean
  error: string | null

  fetchStatuses: () => Promise<void>
  refresh: () => Promise<void>
  applyDelta: (delta: MetricsDelta) => void
  applyHudMetrics: (metrics: HudMetrics) => void
  setBurnRate: (rate: BurnRate) => void
}

export const useBalanceStore = create<BalanceState>((set, get) => ({
  statuses: {},
  burnRate: null,
  hudMetrics: null,
  lastSequenceId: 0,
  isLoading: false,
  error: null,

  fetchStatuses: async () => {
    if (!window.electronAPI) return
    set({ isLoading: true })
    try {
      const result = await window.electronAPI.getSnapshot()
      const statuses: Record<string, PlatformStatus> = {}
      for (const s of result) {
        statuses[s.instanceId] = s
      }
      set({ statuses, isLoading: false })

      // Also fetch burn rate (API returns array, take first)
      try {
        const rates = await window.electronAPI.getBurnRate()
        set({ burnRate: Array.isArray(rates) ? rates[0] ?? null : null })
      } catch { /* burn rate is optional */ }
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  refresh: async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.refreshBalance()
    const statuses: Record<string, PlatformStatus> = {}
    for (const s of result) {
      statuses[s.instanceId] = s
    }
    set({ statuses })
  },

  applyDelta: (delta: MetricsDelta) => {
    if (delta.sequenceId <= get().lastSequenceId) return

    const statuses = { ...get().statuses }
    for (const change of delta.changes) {
      const existing = statuses[change.instanceId]
      if (existing) {
        statuses[change.instanceId] = {
          ...existing,
          metrics: change.metrics,
          dataFreshness: change.dataFreshness,
          timestamp: change.lastSuccessfulFetch
        }
      }
    }
    set({ statuses, lastSequenceId: delta.sequenceId })
  },

  applyHudMetrics: (metrics: HudMetrics) => {
    set({ hudMetrics: metrics })
  },

  setBurnRate: (rate: BurnRate) => {
    set({ burnRate: rate })
  }
}))

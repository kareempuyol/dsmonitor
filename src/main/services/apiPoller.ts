import { databaseService } from './databaseService'
import { secureStorage } from './secureStorage'
import { apiClient, ApiError, type PlatformApiConfig } from './apiClient'
import { getPlatformConfig } from './platformConfigs'
import { bus } from './eventBus'
import { burnRateEngine } from './burnRateEngine'
import { alertEngine } from './alertEngine'
import type { PlatformStatus, MetricsDelta, MetricsChange, HudMetrics, PlatformMetric } from '@shared/types'
import { DEFAULT_POLL_INTERVAL_MS, FRESH_THRESHOLD_MS, STALE_THRESHOLD_MS } from '@shared/constants'

// ============================================================
// API Polling Scheduler
// Periodic polling with error resilience and freshness tracking
// ============================================================

class ApiPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private running = false
  private sequenceId = 0
  private lastCycle = 0
  private consecutiveFailures = new Map<string, number>()

  /**
   * Start periodic polling
   */
  start(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
    if (this.running) return
    this.running = true

    console.log(`[ApiPoller] Starting — interval: ${intervalMs}ms`)

    // Initial poll after a short delay (let the app settle)
    setTimeout(() => this.pollAll(), 2000)

    // Periodic polling
    this.intervalId = setInterval(() => this.pollAll(), intervalMs)

    // Status update
    this.emitStatus()
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[ApiPoller] Stopped')
    this.emitStatus()
  }

  /**
   * Force immediate poll
   */
  async forcePoll(): Promise<PlatformStatus[]> {
    return this.pollAll()
  }

  /**
   * Get current status
   */
  getStatus(): { running: boolean; lastCycle: number } {
    return { running: this.running, lastCycle: this.lastCycle }
  }

  // ==========================================================
  // Internal
  // ==========================================================

  private async pollAll(): Promise<PlatformStatus[]> {
    const keys = databaseService.getApiKeys()
    const activeKeys = keys.filter(k => k.isActive === 1 && k.status !== 'unconfigured')

    if (activeKeys.length === 0) {
      console.log('[ApiPoller] No active keys to poll')
      return []
    }

    console.log(`[ApiPoller] Polling ${activeKeys.length} keys...`)

    const statuses: PlatformStatus[] = []
    const changes: MetricsChange[] = []

    // Clean up failure tracking for deleted keys
    const activeIds = new Set(activeKeys.map(k => k.id as string))
    for (const id of this.consecutiveFailures.keys()) {
      if (!activeIds.has(id)) this.consecutiveFailures.delete(id)
    }

    for (const key of activeKeys) {
      const config = getPlatformConfig(key.definitionId as string)
      if (!config) {
        console.warn(`[ApiPoller] No config for platform: ${key.definitionId}`)
        continue
      }

      try {
        const apiKey = secureStorage.decrypt(key.keyValue as string)
        if (!apiKey) {
          databaseService.updateApiKeyStatus(key.id as string, 'error', 'API key not configured')
          continue
        }

        const status = await apiClient.fetchStatus(config, apiKey, {}, key.id as string)

        // Mark freshness
        const lastSuccess = Date.now()
        status.dataFreshness = 'fresh'
        status.timestamp = lastSuccess

        // Store snapshot
        databaseService.insertBalanceSnapshot(
          key.id as string,
          JSON.stringify(status)
        )

        // Update key status
        databaseService.updateApiKeyStatus(key.id as string, 'ok')
        this.consecutiveFailures.set(key.id as string, 0)

        // Try to fetch usage records
        if (config.usageEndpoint && config.usageMapping) {
          try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // last 24h
            const records = await apiClient.fetchUsage(config, apiKey, {}, key.id as string, since)
            if (records.length > 0) {
              databaseService.insertUsageRecords(records.map(r => ({
                keyId: key.id as string,
                modelName: r.modelName,
                tokensInput: r.tokensInput,
                tokensOutput: r.tokensOutput,
                cost: r.cost,
                requestCount: r.requestCount,
                date: r.date
              })))
            }
          } catch (usageErr) {
            // Usage fetch is non-critical — don't fail the whole poll
            console.warn(`[ApiPoller] Usage fetch failed for ${key.id}:`, (usageErr as Error).message)
          }
        }

        statuses.push(status)
        changes.push({
          instanceId: key.id as string,
          metrics: status.metrics,
          dataFreshness: 'fresh',
          lastSuccessfulFetch: lastSuccess
        })

        bus.emit('poller:data', [status])

      } catch (err) {
        const failures = (this.consecutiveFailures.get(key.id as string) || 0) + 1
        this.consecutiveFailures.set(key.id as string, failures)

        // Determine error code
        let errorCode = 'NETWORK_ERROR'
        let errorMsg = (err as Error).message
        if (err instanceof ApiError) {
          errorCode = err.code
          errorMsg = err.message
        }

        // Check freshness of existing data
        const lastSnapshot = databaseService.getLatestBalance(key.id as string)
        let freshness: PlatformStatus['dataFreshness'] = 'unknown'
        if (lastSnapshot) {
          const lastTime = new Date(lastSnapshot.snapshotTime as string).getTime()
          const age = Date.now() - lastTime
          if (age < STALE_THRESHOLD_MS) freshness = 'stale'
          else freshness = 'expired'
        }

        // Update status
        if (failures >= 5) {
          databaseService.updateApiKeyStatus(
            key.id as string, 'error',
            `Failed ${failures} times: ${errorMsg}`
          )
        }

        bus.emit('poller:error', key.id as string, {
          code: errorCode as 'AUTH_ERROR' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'SERVER_ERROR',
          message: errorMsg
        })

        console.error(`[ApiPoller] Error for ${key.id} (#${failures}):`, errorMsg)
      }
    }

    // Update burn rate
    const rates: BurnRate[] = []
    try {
      const result = burnRateEngine.evaluate()
      rates.push(...result)
    } catch (err) {
      console.error('[ApiPoller] Burn rate error:', err)
    }

    // Evaluate alerts
    try {
      alertEngine.evaluate(statuses, rates)
    } catch (err) {
      console.error('[ApiPoller] Alert evaluation error:', err)
    }

    // Emit delta
    this.sequenceId++
    const delta: MetricsDelta = {
      sequenceId: this.sequenceId,
      changes
    }
    bus.emit('metrics:delta', delta)

    // Emit HUD update
    const hudMetrics = this.computeHudMetrics(statuses, rates)
    bus.emit('hud:update', hudMetrics)

    // Database checkpoint
    databaseService.checkpoint()

    this.lastCycle = Date.now()
    bus.emit('poller:cycle-done', this.lastCycle)
    this.emitStatus()

    console.log(`[ApiPoller] Cycle complete — ${statuses.length} platforms polled`)

    return statuses
  }

  /**
   * Compute HUD metrics from all platform statuses
   */
  private computeHudMetrics(statuses: PlatformStatus[], rates: BurnRate[]): HudMetrics {
    let todaySpend = 0
    let monthSpend = 0
    let dailyBudgetPercent = 0
    let overallFreshness: PlatformStatus['dataFreshness'] = 'unknown'

    for (const s of statuses) {
      // Sum up today's cost from usage data
      // Look for any metric that represents current spend
      for (const m of s.metrics) {
        if (m.key === 'total_usage' || m.key === 'daily_cost' || m.key === 'today_spend') {
          todaySpend += m.value
        }
        if (m.key === 'monthly_cost') {
          monthSpend += m.value
        }
      }
      // Track worst freshness
      if (s.dataFreshness === 'expired') overallFreshness = 'expired'
      else if (s.dataFreshness === 'stale' && overallFreshness !== 'expired') overallFreshness = 'stale'
      else if (s.dataFreshness === 'fresh' && overallFreshness === 'unknown') overallFreshness = 'fresh'
    }

    // Use already-computed burn rate (avoid double evaluate)
    const combinedRate = rates.length > 0
      ? rates[0]
      : { hourly: 0, daily: 0, weekly: 0, monthlyProjection: 0, daysRemaining: Infinity, pace: 'on_track' as const, trend: 'stable' as const }

    // Check for unacknowledged alerts
    const alertHistory = databaseService.getAlertHistory(50)
    const activeAlerts = alertHistory.filter(a => a.acknowledged === 0).length

    return {
      todaySpend,
      monthSpend,
      dailyBudgetPercent: Math.round(dailyBudgetPercent),
      burnRate: combinedRate,
      activeAlertCount: activeAlerts,
      overallStatus: overallFreshness
    }
  }

  private emitStatus(): void {
    bus.emit('poller:status', { running: this.running, lastCycle: this.lastCycle })
  }
}

export const apiPoller = new ApiPoller()

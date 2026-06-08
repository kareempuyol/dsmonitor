import type { BurnRate } from '@shared/types'
import { databaseService } from './databaseService'
import { bus } from './eventBus'

// ============================================================
// Burn Rate Engine
// Computes spending velocity from usage_velocity data.
// Uses weighted moving average (recent 7 days weighted higher).
// ============================================================

class BurnRateEngine {
  /**
   * Calculate burn rate for all active keys and emit results.
   */
  evaluate(): BurnRate[] {
    const keys = databaseService.getApiKeys()
    const rates: BurnRate[] = []

    for (const key of keys) {
      const keyId = key.id as string
      const monthlyBudget = (key.monthlyBudget as number) || null

      if (key.status !== 'ok') {
        rates.push(this.emptyRate(monthlyBudget))
        continue
      }

      try {
        const rate = this.calculateForKey(keyId, monthlyBudget)
        rates.push(rate)
      } catch (err) {
        console.error(`[BurnRateEngine] Error for key ${keyId}:`, err)
        rates.push(this.emptyRate(monthlyBudget))
      }
    }

    bus.emit('burnrate:updated', rates)
    return rates
  }

  /**
   * Calculate burn rate for a single key
   */
  calculateForKey(keyId: string, monthlyBudget: number | null): BurnRate {
    // Get daily velocity for the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const dailyRows = databaseService.getVelocityHistory(keyId, 'daily', thirtyDaysAgo)

    if (dailyRows.length === 0) {
      return this.emptyRate(monthlyBudget)
    }

    // Weighted moving average: last 7 days weight = 0.6, days 8-30 weight = 0.4
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    let recentSum = 0
    let recentCount = 0
    let olderSum = 0
    let olderCount = 0

    for (const row of dailyRows) {
      const cost = row.totalCost as number
      const periodStart = new Date(row.periodStart as string).getTime()

      if (now - periodStart < sevenDaysMs) {
        recentSum += cost
        recentCount++
      } else {
        olderSum += cost
        olderCount++
      }
    }

    const recentAvg = recentCount > 0 ? recentSum / recentCount : 0
    const olderAvg = olderCount > 0 ? olderSum / olderCount : 0

    // Weighted daily average
    const daily = recentCount > 0 && olderCount > 0
      ? recentAvg * 0.6 + olderAvg * 0.4
      : recentCount > 0
        ? recentAvg
        : olderAvg

    const hourly = daily / 24
    const weekly = daily * 7
    const monthlyProjection = daily * 30

    // Days remaining (if we know the balance)
    // Get latest balance snapshot
    const latestBalance = databaseService.getLatestBalance(keyId)
    let daysRemaining = Infinity
    if (latestBalance && daily > 0) {
      try {
        const balanceData = JSON.parse(latestBalance.balanceData as string)
        // Try to find remaining balance from metrics
        let remaining = 0
        for (const m of (balanceData.metrics || [])) {
          if (m.key === 'remaining' || m.key === 'total_balance') {
            remaining = m.value
            break
          }
        }
        daysRemaining = remaining / daily
      } catch {
        // Can't parse balance, skip
      }
    }

    // Pace: compare to monthly budget
    let pace: BurnRate['pace'] = 'on_track'
    if (monthlyBudget && monthlyBudget > 0) {
      const ratio = monthlyProjection / monthlyBudget
      if (ratio > 1.0) pace = 'critical'
      else if (ratio > 0.9) pace = 'over_budget'
      else if (ratio < 0.5) pace = 'under_budget'
    }

    // Trend: compare recent 7-day to older
    let trend: BurnRate['trend'] = 'stable'
    if (recentAvg > olderAvg * 1.15) trend = 'increasing'
    else if (recentAvg < olderAvg * 0.85) trend = 'decreasing'

    return { hourly, daily, weekly, monthlyProjection, daysRemaining, pace, trend }
  }

  private emptyRate(monthlyBudget: number | null): BurnRate {
    return {
      hourly: 0, daily: 0, weekly: 0,
      monthlyProjection: 0,
      daysRemaining: Infinity,
      pace: 'on_track',
      trend: 'stable'
    }
  }
}

export const burnRateEngine = new BurnRateEngine()

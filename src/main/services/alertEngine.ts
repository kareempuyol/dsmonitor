import { Notification } from 'electron'
import { databaseService } from './databaseService'
import { bus } from './eventBus'
import type {
  PlatformStatus,
  PlatformMetric,
  AlertRule,
  AlertEvent,
  AlertSeverity,
  BurnRate
} from '@shared/types'
import { ALERT_COOLDOWN_BUDGET_MS, ALERT_COOLDOWN_AUTH_MS } from '@shared/constants'

// ============================================================
// Alert Engine
// Evaluates rules against fresh data and fires notifications.
// Per-type cooldown: budget = 5min, auth errors = instant.
// ============================================================

interface CooldownEntry {
  ruleId: string
  lastFiredAt: number
}

class AlertEngine {
  private cooldowns = new Map<string, CooldownEntry>()
  private trayAlertActive = false

  /**
   * Evaluate all enabled rules against fresh platform statuses + burn rates.
   * Called after each poll cycle completes.
   */
  evaluate(statuses: PlatformStatus[], burnRates: BurnRate[]): AlertEvent[] {
    const rules = databaseService.getAlertRules() as unknown as AlertRule[]
    const enabledRules = rules.filter(r => r.enabled)

    if (enabledRules.length === 0) return []

    const fired: AlertEvent[] = []

    for (const rule of enabledRules) {
      // Find the status for this rule's key
      const status = statuses.find(s => s.instanceId === rule.keyId)
      if (!status) continue

      // Extract current value from metrics
      const currentValue = this.extractMetricValue(rule.metric, status, burnRates)
      if (currentValue === null) continue

      // Evaluate condition
      const triggered = rule.condition === 'less_than'
        ? currentValue < rule.threshold
        : currentValue > rule.threshold

      if (!triggered) continue

      // Check cooldown
      if (this.isInCooldown(rule)) continue

      // Fire alert
      const message = this.buildMessage(rule, currentValue, status)
      const event = this.fireAlert(rule, currentValue, message)
      fired.push(event)
    }

    // Emit batch
    if (fired.length > 0) {
      bus.emit('alert:fired', fired)
    }

    return fired
  }

  // ==========================================================
  // Metric extraction
  // ==========================================================

  private extractMetricValue(
    metric: string,
    status: PlatformStatus,
    burnRates: BurnRate[]
  ): number | null {
    // Platform metrics
    for (const m of status.metrics) {
      if (m.key === metric) return m.value
    }

    // Burn rate metrics (combined across all keys)
    if (burnRates.length > 0) {
      const combined = burnRates[0]
      switch (metric) {
        case 'burn_rate': return combined.hourly
        case 'daily_cost': return combined.daily
        case 'monthly_projection': return combined.monthlyProjection
        case 'days_remaining': return Math.min(combined.daysRemaining, 999)
      }
    }

    // Quota percentage special handling
    for (const m of status.metrics) {
      if (m.key.startsWith('quota_') && m.key.endsWith('_pct') && metric === 'quota_pct') {
        return m.value
      }
    }

    return null
  }

  // ==========================================================
  // Fire & notify
  // ==========================================================

  private fireAlert(rule: AlertRule, value: number, message: string): AlertEvent {
    const severity = rule.severity || this.defaultSeverity(rule, value)

    // Persist to DB
    databaseService.insertAlertEvent(rule.id, value, message, severity)

    // Set cooldown
    const cooldownMs = rule.cooldownMs ??
      (rule.metric.includes('auth') || rule.condition === 'less_than' && rule.threshold < 1
        ? ALERT_COOLDOWN_AUTH_MS
        : ALERT_COOLDOWN_BUDGET_MS)

    this.cooldowns.set(rule.id, {
      ruleId: rule.id,
      lastFiredAt: Date.now()
    })

    // System notification for warning/critical
    if (severity !== 'info') {
      this.showSystemNotification(rule.name, message, severity)
    }

    // Update tray icon state
    if (severity === 'critical') {
      this.trayAlertActive = true
      bus.emit('hud:update', {
        todaySpend: 0, monthSpend: 0, dailyBudgetPercent: 0,
        burnRate: { hourly: 0, daily: 0, weekly: 0, monthlyProjection: 0, daysRemaining: Infinity, pace: 'on_track', trend: 'stable' },
        activeAlertCount: 1, overallStatus: 'expired'
      })
    }

    return {
      id: 0, // Will be assigned by DB
      ruleId: rule.id,
      ruleName: rule.name,
      triggeredValue: value,
      message,
      severity,
      acknowledged: false,
      createdAt: new Date().toISOString()
    }
  }

  private showSystemNotification(title: string, body: string, severity: AlertSeverity): void {
    if (!Notification.isSupported()) return

    try {
      const notification = new Notification({
        title: `dsmonitor — ${title}`,
        body,
        urgency: severity === 'critical' ? 'critical' : 'normal',
        silent: severity === 'info'
      })
      notification.show()
    } catch (err) {
      console.warn('[AlertEngine] Notification failed:', (err as Error).message)
    }
  }

  private buildMessage(rule: AlertRule, value: number, status: PlatformStatus): string {
    const unit = rule.metric.includes('balance') || rule.metric.includes('cost')
      ? '¥'
      : rule.metric.includes('pct') || rule.metric.includes('quota')
        ? '%'
        : ''

    const threshold = `${rule.condition === 'less_than' ? '<' : '>'} ${rule.threshold}${unit}`
    const current = `${value.toFixed(2)}${unit}`

    // Find platform name
    const platformName = status.metrics[0]?.label || status.platformType

    return `[${platformName}] ${rule.name}: ${current} (threshold: ${threshold})`
  }

  private defaultSeverity(rule: AlertRule, value: number): AlertSeverity {
    // Auth/error conditions are always critical
    if (rule.metric.includes('auth') || rule.metric.includes('error')) return 'critical'

    // Budget/quota: severity based on how far past threshold
    if (rule.condition === 'greater_than') {
      const ratio = value / rule.threshold
      if (ratio >= 1.2) return 'critical'
      if (ratio >= 1.05) return 'warning'
      return 'info'
    }

    if (rule.condition === 'less_than') {
      const ratio = value / rule.threshold
      if (ratio <= 0.3) return 'critical'
      if (ratio <= 0.6) return 'warning'
      return 'info'
    }

    return 'warning'
  }

  private isInCooldown(rule: AlertRule): boolean {
    const entry = this.cooldowns.get(rule.id)
    if (!entry) return false

    const cooldownMs = rule.cooldownMs ?? ALERT_COOLDOWN_BUDGET_MS
    const elapsed = Date.now() - entry.lastFiredAt

    // Auth errors: no cooldown
    if (cooldownMs === 0) return false

    return elapsed < cooldownMs
  }

  /** Reset cooldown for a specific rule (e.g., when user acknowledges) */
  resetCooldown(ruleId: string): void {
    this.cooldowns.delete(ruleId)
  }

  /** Clear tray alert state (called when user acknowledges all) */
  clearTrayAlert(): void {
    this.trayAlertActive = false
  }

  isTrayAlertActive(): boolean {
    return this.trayAlertActive
  }
}

export const alertEngine = new AlertEngine()

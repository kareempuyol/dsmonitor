// ============================================================
// dsmonitor — Shared Type Definitions
// Single source of truth for all IPC-crossing types
// ============================================================

// --- Platform Definition ---

export type PlatformCategory = 'balance' | 'quota' | 'credit' | 'custom'

export interface PlatformDefinition {
  id: string
  displayName: string
  displayNameCn: string
  category: PlatformCategory
  icon: string
  defaultBaseUrl: string
  defaultAuthHeader: string
  sortOrder: number
  builtIn: boolean
}

// --- API Key Instance ---

export interface ApiKeyInstance {
  id: string
  definitionId: string
  label: string
  hasKey: boolean // never expose actual key to renderer
  dailyBudget: number | null
  monthlyBudget: number | null
  isActive: boolean
  status: 'ok' | 'error' | 'unconfigured'
  statusMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiKeyInstanceWithDefinition extends ApiKeyInstance {
  definition: PlatformDefinition
}

// --- Unified Metrics ---

export interface PlatformMetric {
  key: string
  label: string
  labelEn: string
  value: number
  max?: number
  unit: string
  type: 'currency' | 'percentage' | 'count' | 'tokens' | 'duration'
  severity: 'normal' | 'warning' | 'critical'
  trend: 'up' | 'down' | 'stable'
}

export interface PlatformStatus {
  platformType: string
  instanceId: string
  metrics: PlatformMetric[]
  raw: Record<string, unknown>
  timestamp: number
  dataFreshness: DataFreshnessStatus
}

// --- Data Freshness ---

export type DataFreshnessStatus = 'fresh' | 'stale' | 'expired' | 'unknown'

export interface DataFreshness {
  status: DataFreshnessStatus
  lastSuccessfulFetch: number
  consecutiveFailures: number
  nextRetryAt?: number
  lastError?: ApiErrorInfo
}

export interface ApiErrorInfo {
  code: 'AUTH_ERROR' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'SERVER_ERROR'
  message: string
  statusCode?: number
}

// --- IPC Metrics Delta ---

export interface MetricsDelta {
  sequenceId: number
  changes: MetricsChange[]
}

export interface MetricsChange {
  instanceId: string
  metrics: PlatformMetric[]
  dataFreshness: DataFreshnessStatus
  lastSuccessfulFetch: number
}

// --- Burn Rate ---

export interface BurnRate {
  hourly: number
  daily: number
  weekly: number
  monthlyProjection: number
  daysRemaining: number
  pace: 'under_budget' | 'on_track' | 'over_budget' | 'critical'
  trend: 'increasing' | 'stable' | 'decreasing'
}

// --- HUD Metrics ---

export interface HudMetrics {
  todaySpend: number
  monthSpend: number
  dailyBudgetPercent: number
  burnRate: BurnRate
  activeAlertCount: number
  overallStatus: DataFreshnessStatus
}

// --- Usage Records ---

export interface UnifiedUsageRecord {
  platformType: string
  instanceId: string
  modelName: string
  tokensInput: number
  tokensOutput: number
  cost: number
  requestCount: number
  date: string
}

export interface UsageFilter {
  instanceId?: string
  modelName?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export interface UsageSummary {
  groupKey: string
  totalTokensInput: number
  totalTokensOutput: number
  totalCost: number
  recordCount: number
}

// --- Alerts ---

export type AlertMetric = 'balance' | 'quota_5h_pct' | 'quota_7d_pct' | 'daily_cost' | 'burn_rate'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertNotifyChannel = 'app' | 'system' | 'tray'

export interface AlertRule {
  id: string
  keyId: string
  name: string
  metric: AlertMetric
  condition: 'less_than' | 'greater_than'
  threshold: number
  enabled: boolean
  severity: AlertSeverity
  notifyChannels: AlertNotifyChannel[]
  cooldownMs: number
  createdAt: string
}

export interface AlertEvent {
  id: number
  ruleId: string
  ruleName: string
  triggeredValue: number
  message: string
  severity: AlertSeverity
  acknowledged: boolean
  createdAt: string
}

// --- Settings ---

export interface AppSettings {
  pollingIntervalMs: number
  startMinimizedToTray: boolean
  hudEnabled: boolean
  hudCompact: boolean
  hudOpacity: number
  theme: 'dark'
  language: 'zh-CN' | 'en'
  dataRetentionDays: number
  monthlyBudget: number | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollingIntervalMs: 300000, // 5 minutes
  startMinimizedToTray: true,
  hudEnabled: false,
  hudCompact: false,
  hudOpacity: 0.82,
  theme: 'dark',
  language: 'zh-CN',
  dataRetentionDays: 365,
  monthlyBudget: null
}

// --- Platform API Config ---

export interface PlatformInstanceConfig {
  baseUrl?: string
  headers?: Record<string, string>
  timeout?: number
}

// --- Optimization Hints ---

export interface OptimizationHint {
  id: string
  severity: 'info' | 'warning' | 'critical'
  category: 'model_selection' | 'cache_usage' | 'retry_storm' | 'runaway_loop' | 'idle_spend'
  title: string
  evidence: string
  estimatedMonthlySavings: number
  actionable: boolean
  instanceId: string
}

// --- Cost Session ---

export interface CostSession {
  id: string
  label: string
  startTime: number
  endTime?: number
  totalCost: number
  peakBurnRate: number
  topModel: string
  costBreakdown: { model: string; cost: number; tokens: number }[]
  autoDetected: boolean
}

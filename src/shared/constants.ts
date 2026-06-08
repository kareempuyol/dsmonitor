// ============================================================
// dsmonitor — Shared Constants
// ============================================================

export const APP_NAME = 'dsmonitor'

// Default polling interval (5 minutes — balance APIs are not real-time)
export const DEFAULT_POLL_INTERVAL_MS = 300_000

// Data freshness thresholds
export const FRESH_THRESHOLD_MS = 6 * 60_000    // 6 minutes
export const STALE_THRESHOLD_MS = 15 * 60_000   // 15 minutes

// Retry configuration
export const MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 1_000
export const RETRY_MAX_DELAY_MS = 60_000

// Request timeout
export const REQUEST_TIMEOUT_MS = 10_000

// HUD dimensions
export const HUD_HEIGHT = 36
export const HUD_COMPACT_HEIGHT = 24
export const HUD_MIN_WIDTH = 220

// Screen edge snap threshold (pixels)
export const EDGE_SNAP_THRESHOLD = 12

// DB retention
export const DEFAULT_RETENTION_DAYS = 365
export const REQUEST_LEVEL_RETENTION_DAYS = 30
export const HOURLY_AGGREGATE_RETENTION_DAYS = 90

// Alert default cooldowns (ms)
export const ALERT_COOLDOWN_BUDGET_MS = 5 * 60_000    // 5 min for budget alerts
export const ALERT_COOLDOWN_AUTH_MS = 0                // No cooldown for auth errors

// Default budgets
export const DEFAULT_DAILY_BUDGET: Record<string, number> = {
  deepseek: 100, // ¥
  glm: 50,
  openrouter: 10, // $
  minimax: 50,
  anthropic: 20
}

// Platform brand colors for UI
export const PLATFORM_COLORS: Record<string, string> = {
  deepseek: '#818CF8',    // indigo-400
  glm: '#34D399',          // emerald-400
  openrouter: '#FBBF24',   // amber-400
  minimax: '#F472B6',      // pink-400
  anthropic: '#FB923C'     // orange-400
}

// Default platform color (for unknown/custom)
export const DEFAULT_PLATFORM_COLOR = '#A78BFA' // violet-400

import type { PlatformApiConfig } from './apiClient'
import type { PlatformStatus, PlatformMetric, UnifiedUsageRecord } from '@shared/types'
import { FRESH_THRESHOLD_MS } from '@shared/constants'

// ============================================================
// Platform Config Registry
// All platform-specific API logic in ONE file.
// Add new platform = add one object below + drop SVG in resources/.
// ============================================================

function defaultStatus(type: string, instanceId: string, metrics: PlatformMetric[], raw: unknown, lastFetch?: number): PlatformStatus {
  return {
    platformType: type,
    instanceId,
    metrics,
    raw: raw as Record<string, unknown>,
    timestamp: Date.now(),
    dataFreshness: !lastFetch
      ? 'fresh'
      : (Date.now() - lastFetch < FRESH_THRESHOLD_MS ? 'fresh' : 'stale')
  }
}

function metric(
  key: string,
  label: string,
  labelEn: string,
  value: number,
  unit: string,
  type: PlatformMetric['type'],
  opts?: { max?: number; severity?: PlatformMetric['severity']; trend?: PlatformMetric['trend'] }
): PlatformMetric {
  return {
    key, label, labelEn, value, unit, type,
    max: opts?.max,
    severity: opts?.severity ?? 'normal',
    trend: opts?.trend ?? 'stable'
  }
}

// ============================================================
// DeepSeek
// ============================================================

const deepseekConfig: PlatformApiConfig = {
  type: 'deepseek',
  displayName: 'DeepSeek',
  displayNameCn: 'DeepSeek',
  category: 'balance',
  baseUrl: 'https://api.deepseek.com',
  balanceEndpoint: 'GET /user/balance',
  usageEndpoint: 'GET /usage?start={{start}}&end={{end}}',

  responseMapping(raw: unknown, instanceId: string): PlatformStatus {
    const data = raw as { is_available?: boolean; balance_infos?: Array<{ currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }> }
    const info = data.balance_infos?.[0]
    if (!info) {
      return defaultStatus('deepseek', instanceId, [
        metric('total_balance', '总余额', 'Total Balance', 0, '¥', 'currency', { severity: 'critical' })
      ], raw)
    }

    const total = parseFloat(info.total_balance)
    const granted = parseFloat(info.granted_balance)
    const toppedUp = parseFloat(info.topped_up_balance)
    const isLow = total < 10

    return defaultStatus('deepseek', instanceId, [
      metric('total_balance', '总余额', 'Total Balance', total, '¥', 'currency', { severity: isLow ? 'warning' : 'normal' }),
      metric('granted_balance', '赠送余额', 'Granted', granted, '¥', 'currency'),
      metric('topped_up_balance', '充值余额', 'Topped Up', toppedUp, '¥', 'currency')
    ], raw)
  },

  usageMapping(raw: unknown, instanceId: string): UnifiedUsageRecord[] {
    const data = raw as { data?: Array<{ model?: string; prompt_tokens?: number; completion_tokens?: number; total_cost?: number; date?: string }> }
    if (!data.data) return []
    return data.data.map(r => ({
      platformType: 'deepseek',
      instanceId,
      modelName: r.model || 'unknown',
      tokensInput: r.prompt_tokens || 0,
      tokensOutput: r.completion_tokens || 0,
      cost: r.total_cost || 0,
      requestCount: 1,
      date: r.date || new Date().toISOString().split('T')[0]
    }))
  },

  testMapping(raw: unknown): { ok: boolean; message: string } {
    const data = raw as { is_available?: boolean; balance_infos?: Array<{ total_balance: string }> }
    if (data.is_available !== undefined) {
      const balance = data.balance_infos?.[0]?.total_balance || '0'
      return { ok: true, message: `Connected — Balance: ¥${balance}` }
    }
    return { ok: true, message: 'Connected' }
  }
}

// ============================================================
// GLM Coding Plan (Zhipu AI)
// ============================================================

const glmConfig: PlatformApiConfig = {
  type: 'glm',
  displayName: 'GLM Coding Plan',
  displayNameCn: '智谱 GLM',
  category: 'quota',
  baseUrl: 'https://open.bigmodel.cn/api',
  balanceEndpoint: 'GET /monitor/usage/quota/limit',

  responseMapping(raw: unknown, instanceId: string): PlatformStatus {
    const data = raw as {
      data?: Array<{
        type?: string
        name?: string
        limit?: number
        used?: number
        remaining?: number
        reset_time?: string
      }>
    }

    const metrics: PlatformMetric[] = []
    if (data.data) {
      for (const q of data.data) {
        const key = q.type || q.name || 'unknown'
        const pct = q.limit && q.limit > 0 ? (q.used || 0) / q.limit * 100 : 0
        const severity = pct > 95 ? 'critical' as const : pct > 80 ? 'warning' as const : 'normal' as const

        metrics.push(metric(
          `quota_${key}_pct`,
          `${q.name || key}`,
          q.name || key,
          Math.round(pct),
          '%',
          'percentage',
          { max: 100, severity }
        ))

        // Also add absolute values
        if (q.remaining !== undefined) {
          metrics.push(metric(
            `quota_${key}_remaining`,
            `${q.name || key} 剩余`,
            `${q.name || key} Remaining`,
            q.remaining,
            'tokens',
            'tokens',
            { severity }
          ))
        }
      }
    }

    if (metrics.length === 0) {
      metrics.push(metric('quota_status', '配额状态', 'Quota Status', 0, '%', 'percentage', { severity: 'warning' }))
    }

    return defaultStatus('glm', instanceId, metrics, raw)
  },

  testMapping(raw: unknown): { ok: boolean; message: string } {
    const data = raw as { data?: Array<{ remaining?: number }> }
    if (data.data) {
      const totalRemaining = data.data.reduce((s, q) => s + (q.remaining || 0), 0)
      return { ok: true, message: `Connected — ${totalRemaining.toLocaleString()} tokens remaining` }
    }
    return { ok: true, message: 'Connected' }
  }
}

// ============================================================
// OpenRouter
// ============================================================

const openrouterConfig: PlatformApiConfig = {
  type: 'openrouter',
  displayName: 'OpenRouter',
  displayNameCn: 'OpenRouter',
  category: 'credit',
  baseUrl: 'https://openrouter.ai/api/v1',
  balanceEndpoint: 'GET /credits',
  usageEndpoint: 'GET /activity?start={{start}}&end={{end}}',

  responseMapping(raw: unknown, instanceId: string): PlatformStatus {
    const data = raw as { total_credits?: number; total_usage?: number }
    const total = data.total_credits || 0
    const usage = data.total_usage || 0
    const remaining = total - usage
    const isLow = remaining < 5

    return defaultStatus('openrouter', instanceId, [
      metric('total_credits', '总充值', 'Total Credits', total, '$', 'currency'),
      metric('total_usage', '已消费', 'Total Usage', usage, '$', 'currency'),
      metric('remaining', '剩余', 'Remaining', remaining, '$', 'currency', { severity: isLow ? 'warning' : 'normal' })
    ], raw)
  },

  usageMapping(raw: unknown, instanceId: string): UnifiedUsageRecord[] {
    const data = raw as { data?: Array<{ model?: string; usage?: number; prompt_tokens?: number; completion_tokens?: number; date?: string }> }
    if (!data.data) return []
    return data.data.map(r => ({
      platformType: 'openrouter',
      instanceId,
      modelName: r.model || 'unknown',
      tokensInput: r.prompt_tokens || 0,
      tokensOutput: r.completion_tokens || 0,
      cost: r.usage || 0,
      requestCount: 1,
      date: r.date || new Date().toISOString().split('T')[0]
    }))
  },

  testMapping(raw: unknown): { ok: boolean; message: string } {
    const data = raw as { total_credits?: number }
    if (data.total_credits !== undefined) {
      return { ok: true, message: `Connected — $${data.total_credits.toFixed(2)} credits` }
    }
    return { ok: true, message: 'Connected' }
  }
}

// ============================================================
// Registry — all platforms listed here
// ============================================================

export const PLATFORM_CONFIGS: PlatformApiConfig[] = [
  deepseekConfig,
  glmConfig,
  openrouterConfig
]

/** Lookup config by platform type */
export function getPlatformConfig(type: string): PlatformApiConfig | undefined {
  return PLATFORM_CONFIGS.find(c => c.type === type)
}

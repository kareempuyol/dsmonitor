import fs from 'fs'
import path from 'path'
import os from 'os'
import { bus } from './eventBus'
import { PLATFORM_CONFIGS, getPlatformConfig } from './platformConfigs'
import { apiClient, type PlatformApiConfig } from './apiClient'
import type { PlatformInstanceConfig } from '@shared/types'
import { secureStorage } from './secureStorage'
import { databaseService } from './databaseService'
import { randomUUID } from 'crypto'

// ============================================================
// Discovery Result
// ============================================================

interface DiscoveryResult {
  platform: string
  keyHash: string // SHA256 first 8 chars (for dedup, never store full key)
  keyValue: string
  source: string
  validated: boolean
  balancePreview?: string
}

// ============================================================
// Simple hash for dedup
// ============================================================

function hashKey(key: string): string {
  // Simple hash for dedup — no crypto needed
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).slice(0, 8)
}

// ============================================================
// Discovery Sources
// ============================================================

const ENV_KEY_PATTERNS: Array<{ envVar: string; platform: string }> = [
  { envVar: 'DEEPSEEK_API_KEY', platform: 'deepseek' },
  { envVar: 'GLM_API_KEY', platform: 'glm' },
  { envVar: 'ZHIPU_API_KEY', platform: 'glm' },
  { envVar: 'OPENROUTER_API_KEY', platform: 'openrouter' },
  { envVar: 'MINIMAX_API_KEY', platform: 'minimax' },
  { envVar: 'ANTHROPIC_API_KEY', platform: 'anthropic' },
  { envVar: 'OPENAI_API_KEY', platform: 'openai' }
]

/** Scan process.env for API keys */
function scanEnvVars(): DiscoveryResult[] {
  const results: DiscoveryResult[] = []
  for (const { envVar, platform } of ENV_KEY_PATTERNS) {
    const value = process.env[envVar]
    if (value && value.length > 5) {
      results.push({
        platform,
        keyHash: hashKey(value),
        keyValue: value,
        source: `${envVar} environment variable`,
        validated: false
      })
    }
  }
  return results
}

/** Scan .env files in common locations */
function scanDotEnvFiles(): DiscoveryResult[] {
  const results: DiscoveryResult[] = []
  const homeDir = os.homedir()

  const envFiles = [
    path.join(homeDir, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local')
  ]

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue

    try {
      const content = fs.readFileSync(envFile, 'utf-8')
      const lines = content.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue

        const key = trimmed.slice(0, eqIdx).trim()
        let value = trimmed.slice(eqIdx + 1).trim()

        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }

        if (!value || value.length < 5) continue

        for (const { envVar, platform } of ENV_KEY_PATTERNS) {
          if (key.toUpperCase() === envVar.toUpperCase()) {
            results.push({
              platform,
              keyHash: hashKey(value),
              keyValue: value,
              source: `${envFile} (.env file)`,
              validated: false
            })
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results
}

/** Scan Claude Code config */
function scanClaudeCodeConfig(): DiscoveryResult[] {
  const results: DiscoveryResult[] = []
  const claudeConfigPath = path.join(os.homedir(), '.claude', 'credentials.json')

  if (fs.existsSync(claudeConfigPath)) {
    try {
      const content = fs.readFileSync(claudeConfigPath, 'utf-8')
      const config = JSON.parse(content)

      // Claude Code stores settings with API keys
      // Check common patterns
      const checkValue = (obj: unknown, platform: string, source: string): void => {
        if (typeof obj === 'string' && obj.length > 5) {
          // Check if it looks like an API key
          const keyPatterns: Array<{ prefix: string; platform: string }> = [
            { prefix: 'sk-', platform: 'deepseek' },
            { prefix: 'gcp-', platform: 'glm' },
            { prefix: 'sk-or-', platform: 'openrouter' },
            { prefix: 'sk-ant-', platform: 'anthropic' }
          ]
          for (const { prefix, platform: p } of keyPatterns) {
            if (obj.startsWith(prefix)) {
              results.push({
                platform: p,
                keyHash: hashKey(obj),
                keyValue: obj,
                source: `Claude Code config (${source})`,
                validated: false
              })
              return
            }
          }
        } else if (typeof obj === 'object' && obj !== null) {
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('api')) {
              checkValue(v, platform, `${source}.${k}`)
            }
          }
        }
      }

      checkValue(config, 'unknown', 'credentials.json')
    } catch {
      // Skip malformed files
    }
  }

  return results
}

/** Deduplicate by key hash */
function deduplicate(results: DiscoveryResult[]): DiscoveryResult[] {
  const seen = new Set<string>()
  return results.filter(r => {
    if (seen.has(r.keyHash)) return false
    seen.add(r.keyHash)
    return true
  })
}

// ============================================================
// Main Discovery Service
// ============================================================

class AccountDiscoveryService {
  /**
   * Scan all sources for API keys and validate them.
   * Returns validated results.
   */
  async scan(): Promise<DiscoveryResult[]> {
    bus.emit('discovery:progress', { platform: 'all', status: 'scanning' })

    // 1. Gather keys from all sources
    const envResults = scanEnvVars()
    const dotEnvResults = scanDotEnvFiles()
    const claudeResults = scanClaudeCodeConfig()

    const allResults = deduplicate([...envResults, ...dotEnvResults, ...claudeResults])

    console.log(`[AccountDiscovery] Found ${allResults.length} candidate keys`)

    // 2. Validate each key
    for (const result of allResults) {
      const config = getPlatformConfig(result.platform)
      if (!config) {
        bus.emit('discovery:progress', { platform: result.platform, status: 'skipped (unsupported)' })
        continue
      }

      bus.emit('discovery:progress', { platform: result.platform, status: 'validating' })

      try {
        const testResult = await apiClient.testConnection(config, result.keyValue, {})
        result.validated = testResult.ok
        result.balancePreview = testResult.message
        bus.emit('discovery:progress', { platform: result.platform, status: testResult.ok ? 'valid' : 'invalid' })
      } catch {
        result.validated = false
        bus.emit('discovery:progress', { platform: result.platform, status: 'error' })
      }
    }

    bus.emit('discovery:complete', allResults)
    return allResults
  }

  /**
   * Add validated discovered keys to the database
   */
  async addDiscoveredKeys(results: DiscoveryResult[]): Promise<number> {
    let added = 0
    for (const r of results) {
      if (!r.validated) continue

      const encryptedKey = secureStorage.encrypt(r.keyValue)
      const id = randomUUID()

      try {
        databaseService.createApiKey({
          id,
          definitionId: r.platform,
          label: `${r.platform} (${r.source.split(' ')[0]})`,
          keyValue: encryptedKey
        })
        added++
      } catch (err) {
        console.error(`[AccountDiscovery] Failed to add key for ${r.platform}:`, err)
      }
    }
    return added
  }
}

export const accountDiscovery = new AccountDiscoveryService()

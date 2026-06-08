import { net } from 'electron'
import type {
  PlatformStatus,
  UnifiedUsageRecord,
  ApiErrorInfo,
  PlatformInstanceConfig
} from '@shared/types'

// ============================================================
// Platform API Config (config-driven, not strategy pattern)
// Add a new platform = add one config object here
// ============================================================

export interface PlatformApiConfig {
  type: string
  displayName: string
  displayNameCn: string
  category: 'balance' | 'quota' | 'credit' | 'custom'
  baseUrl: string
  balanceEndpoint: string
  balanceMethod?: string
  usageEndpoint?: string
  usageMethod?: string
  testEndpoint?: string
  testMethod?: string
  /** Map raw API response to unified PlatformStatus */
  responseMapping: (raw: unknown, instanceId: string) => PlatformStatus
  /** Map raw usage/activity response to unified records */
  usageMapping?: (raw: unknown, instanceId: string) => UnifiedUsageRecord[]
  /** Map test connection response */
  testMapping?: (raw: unknown) => { ok: boolean; message: string }
  /** Extra headers */
  extraHeaders?: Record<string, string>
}

// ============================================================
// Error types
// ============================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public code: ApiErrorInfo['code'],
    public statusCode?: number,
    public retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ============================================================
// HTTP Client (uses Electron's `net` module)
// ============================================================

interface RequestOptions {
  method: string
  url: string
  headers: Record<string, string>
  timeout?: number
}

async function electronFetch(options: RequestOptions): Promise<{ status: number; data: unknown }> {
  const timeout = options.timeout ?? 10_000

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options.method,
      url: options.url
    })

    // Set headers
    for (const [key, value] of Object.entries(options.headers)) {
      request.setHeader(key, value)
    }

    // Timeout
    const timer = setTimeout(() => {
      request.abort()
      reject(new ApiError('Request timeout', 'NETWORK_ERROR'))
    }, timeout)

    request.on('response', (response) => {
      clearTimeout(timer)
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        let data: unknown
        try {
          data = JSON.parse(body)
        } catch {
          data = body
        }

        // Handle HTTP errors
        if (response.statusCode >= 400) {
          let code: ApiErrorInfo['code'] = 'SERVER_ERROR'
          if (response.statusCode === 401 || response.statusCode === 403) code = 'AUTH_ERROR'
          else if (response.statusCode === 429) code = 'RATE_LIMITED'

          const retryAfter = response.headers['retry-after']
          const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : undefined

          reject(new ApiError(
            `HTTP ${response.statusCode}: ${body.slice(0, 200)}`,
            code,
            response.statusCode,
            retryMs
          ))
          return
        }

        resolve({ status: response.statusCode, data })
      })

      response.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new ApiError(`Response error: ${err.message}`, 'NETWORK_ERROR'))
      })
    })

    request.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(new ApiError(`Request failed: ${err.message}`, 'NETWORK_ERROR'))
    })

    request.end()
  })
}

// ============================================================
// ApiClient — executes requests against platform configs
// ============================================================

class ApiClient {
  /**
   * Fetch balance/quota status for a platform instance
   */
  async fetchStatus(
    config: PlatformApiConfig,
    apiKey: string,
    instanceConfig: PlatformInstanceConfig,
    instanceId: string
  ): Promise<PlatformStatus> {
    const baseUrl = instanceConfig.baseUrl || config.baseUrl
    const url = this.buildUrl(baseUrl, config.balanceEndpoint)
    const method = config.balanceMethod || 'GET'

    const headers = this.buildHeaders(config, apiKey, instanceConfig)

    const { data } = await this.retry(() =>
      electronFetch({ method, url, headers })
    )

    return config.responseMapping(data, instanceId)
  }

  /**
   * Fetch usage breakdown
   */
  async fetchUsage(
    config: PlatformApiConfig,
    apiKey: string,
    instanceConfig: PlatformInstanceConfig,
    instanceId: string,
    since: Date
  ): Promise<UnifiedUsageRecord[]> {
    if (!config.usageEndpoint || !config.usageMapping) return []

    const baseUrl = instanceConfig.baseUrl || config.baseUrl
    const url = this.buildUrl(baseUrl, config.usageEndpoint)
        .replace('{{start}}', since.toISOString().split('T')[0])
        .replace('{{end}}', new Date().toISOString().split('T')[0])
    const method = config.usageMethod || 'GET'

    const headers = this.buildHeaders(config, apiKey, instanceConfig)

    const { data } = await this.retry(() =>
      electronFetch({ method, url, headers })
    )

    return config.usageMapping(data, instanceId)
  }

  /**
   * Test API key validity
   */
  async testConnection(
    config: PlatformApiConfig,
    apiKey: string,
    instanceConfig: PlatformInstanceConfig
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const baseUrl = instanceConfig.baseUrl || config.baseUrl
      const endpoint = config.testEndpoint || config.balanceEndpoint
      const url = this.buildUrl(baseUrl, endpoint)
      const method = config.testMethod || config.balanceMethod || 'GET'

      const headers = this.buildHeaders(config, apiKey, instanceConfig)

      const { data } = await electronFetch({ method, url, headers, timeout: 8000 })

      if (config.testMapping) {
        return config.testMapping(data)
      }

      // Default: if we got a 2xx response, key is valid
      return { ok: true, message: 'Connection successful' }
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, message: `${err.code}: ${err.message}` }
      }
      return { ok: false, message: `Connection failed: ${(err as Error).message}` }
    }
  }

  // =========================================================
  // Private helpers
  // =========================================================

  private buildUrl(baseUrl: string, endpoint: string): string {
    const [method, path] = endpoint.includes(' ')
      ? endpoint.split(' ', 2)
      : ['GET', endpoint]
    const cleanBase = baseUrl.replace(/\/+$/, '')
    const cleanPath = path.startsWith('/') ? path : '/' + path
    return cleanBase + cleanPath
  }

  private buildHeaders(
    config: PlatformApiConfig,
    apiKey: string,
    instanceConfig: PlatformInstanceConfig
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...config.extraHeaders,
      ...instanceConfig.headers
    }

    // Auth header
    headers['Authorization'] = `Bearer ${apiKey}`

    return headers
  }

  private async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err as Error

        // Don't retry auth errors
        if (err instanceof ApiError && err.code === 'AUTH_ERROR') {
          throw err
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          throw err
        }

        // Respect Retry-After header
        const retryDelay = err instanceof ApiError && err.retryAfterMs
          ? err.retryAfterMs
          : baseDelay * Math.pow(2, attempt)

        console.warn(`[ApiClient] Retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms: ${(err as Error).message}`)
        await this.sleep(retryDelay)
      }
    }

    throw lastError!
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const apiClient = new ApiClient()

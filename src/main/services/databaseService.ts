import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// ============================================================
// SQL Schema (single migration for MVP)
// ============================================================

const SCHEMA_SQL = `
-- Platform type definitions (built-in + user-extensible)
CREATE TABLE IF NOT EXISTS platform_definitions (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_cn TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('balance','quota','credit','custom')),
  icon TEXT,
  default_base_url TEXT NOT NULL,
  default_auth_header TEXT DEFAULT 'Authorization: Bearer {{key}}',
  sort_order INTEGER DEFAULT 0,
  built_in INTEGER DEFAULT 1
);

-- User API key instances
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES platform_definitions(id),
  label TEXT NOT NULL,
  key_value BLOB,
  daily_budget REAL,
  monthly_budget REAL,
  is_active INTEGER DEFAULT 1,
  status TEXT DEFAULT 'unconfigured',
  status_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Usage velocity (for burn rate engine)
CREATE TABLE IF NOT EXISTS usage_velocity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL REFERENCES api_keys(id),
  period TEXT NOT NULL CHECK(period IN ('hourly','daily')),
  period_start TEXT NOT NULL,
  total_cost REAL DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  UNIQUE(key_id, period, period_start)
);

-- Balance snapshots
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL REFERENCES api_keys(id),
  balance_data TEXT NOT NULL,
  snapshot_time TEXT DEFAULT (datetime('now'))
);

-- Usage records
CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL REFERENCES api_keys(id),
  model_name TEXT NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost REAL DEFAULT 0.0,
  request_count INTEGER DEFAULT 0,
  record_date TEXT NOT NULL
);

-- Alert rules
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES api_keys(id),
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN ('less_than','greater_than')),
  threshold REAL NOT NULL,
  severity TEXT DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  notify_channels TEXT DEFAULT '["app"]',
  cooldown_ms INTEGER DEFAULT 300000,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Alert history
CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id),
  triggered_value REAL NOT NULL,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- App settings
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_velocity_key_period ON usage_velocity(key_id, period, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_balance_key_time ON balance_snapshots(key_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_key_date ON usage_records(key_id, record_date);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id, created_at DESC);

-- Seed platform definitions
INSERT OR IGNORE INTO platform_definitions (id, display_name, display_name_cn, category, icon, default_base_url, sort_order, built_in) VALUES
  ('deepseek',   'DeepSeek',          'DeepSeek',        'balance', 'deepseek',   'https://api.deepseek.com',        10, 1),
  ('glm',        'GLM Coding Plan',   '智谱 GLM',         'quota',   'glm',        'https://open.bigmodel.cn/api',    20, 1),
  ('openrouter', 'OpenRouter',        'OpenRouter',      'credit',  'openrouter', 'https://openrouter.ai/api/v1',    30, 1);

-- Default settings
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('pollingIntervalMs', '300000'),
  ('startMinimizedToTray', 'true'),
  ('hudEnabled', 'false'),
  ('hudCompact', 'false'),
  ('hudOpacity', '0.82'),
  ('theme', '"dark"'),
  ('language', '"zh-CN"'),
  ('dataRetentionDays', '365'),
  ('monthlyBudget', 'null');
`

// ============================================================
// Database Service
// ============================================================

class DatabaseService {
  private db: Database | null = null
  private dbPath: string = ''

  async init(): Promise<void> {
    // Determine database path (portable mode: next to exe; normal: userData)
    const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
    const baseDir = portableDir || app.getPath('userData')
    const dataDir = path.join(baseDir, 'data')

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    this.dbPath = path.join(dataDir, 'dsmonitor.db')

    // Initialize sql.js
    const SQL: SqlJsStatic = await initSqlJs()

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      this.db = new SQL.Database(buffer)
    } else {
      this.db = new SQL.Database()
    }

    // Enable WAL mode for better concurrent performance
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA foreign_keys = ON')

    // Run migrations
    this.runMigrations()

    console.log(`[DatabaseService] Initialized at ${this.dbPath}`)
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized')

    // Split by semicolon and execute each statement
    const statements = SCHEMA_SQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    for (const stmt of statements) {
      try {
        this.db.run(stmt + ';')
      } catch (err) {
        console.warn('[DatabaseService] Migration warning:', (err as Error).message)
      }
    }

    console.log('[DatabaseService] Migrations complete')
  }

  // ==========================================================
  // Platform Definitions
  // ==========================================================

  getPlatformDefinitions(): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec('SELECT * FROM platform_definitions ORDER BY sort_order')
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  getPlatformDefinition(id: string): Record<string, unknown> | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM platform_definitions WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const cols = stmt.getColumnNames()
      const vals = stmt.get()
      stmt.free()
      return this.rowToObject(cols, vals)
    }
    stmt.free()
    return null
  }

  // ==========================================================
  // API Key Instances
  // ==========================================================

  getApiKeys(): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec(`
      SELECT k.*, d.display_name, d.display_name_cn, d.category, d.icon, d.default_base_url
      FROM api_keys k
      JOIN platform_definitions d ON k.definition_id = d.id
      ORDER BY d.sort_order
    `)
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  getApiKey(id: string): Record<string, unknown> | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(`
      SELECT k.*, d.display_name, d.display_name_cn, d.category, d.icon, d.default_base_url
      FROM api_keys k
      JOIN platform_definitions d ON k.definition_id = d.id
      WHERE k.id = ?
    `)
    stmt.bind([id])
    if (stmt.step()) {
      const cols = stmt.getColumnNames()
      const vals = stmt.get()
      stmt.free()
      return this.rowToObject(cols, vals)
    }
    stmt.free()
    return null
  }

  createApiKey(data: {
    id: string
    definitionId: string
    label: string
    keyValue: string
    dailyBudget?: number
    monthlyBudget?: number
  }): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO api_keys (id, definition_id, label, key_value, daily_budget, monthly_budget)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.definitionId,
        data.label,
        data.keyValue,
        data.dailyBudget ?? null,
        data.monthlyBudget ?? null
      ]
    )
    this.save()
  }

  updateApiKey(id: string, data: Record<string, unknown>): void {
    if (!this.db) throw new Error('Database not initialized')
    const sets: string[] = []
    const vals: unknown[] = []

    for (const [key, value] of Object.entries(data)) {
      const col = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
      sets.push(`${col} = ?`)
      vals.push(value)
    }

    if (sets.length === 0) return

    sets.push("updated_at = datetime('now')")
    vals.push(id)
    this.db.run(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, vals)
    this.save()
  }

  deleteApiKey(id: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run('DELETE FROM api_keys WHERE id = ?', [id])
    this.save()
  }

  updateApiKeyStatus(id: string, status: string, message?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      "UPDATE api_keys SET status = ?, status_message = ?, updated_at = datetime('now') WHERE id = ?",
      [status, message ?? null, id]
    )
    this.save()
  }

  // ==========================================================
  // Balance Snapshots
  // ==========================================================

  insertBalanceSnapshot(keyId: string, data: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      "INSERT INTO balance_snapshots (key_id, balance_data) VALUES (?, ?)",
      [keyId, data]
    )
  }

  getLatestBalance(keyId: string): Record<string, unknown> | null {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec(
      `SELECT * FROM balance_snapshots WHERE key_id = '${keyId}' ORDER BY snapshot_time DESC LIMIT 1`
    )
    if (!result.length || !result[0].values.length) return null
    return this.rowToObject(result[0].columns, result[0].values[0])
  }

  getBalanceHistory(keyId: string, since: number): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const sinceStr = new Date(since).toISOString()
    const result = this.db.exec(
      `SELECT * FROM balance_snapshots WHERE key_id = '${keyId}' AND snapshot_time >= '${sinceStr}' ORDER BY snapshot_time DESC`
    )
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  // ==========================================================
  // Usage Velocity (for burn rate)
  // ==========================================================

  upsertVelocity(keyId: string, period: 'hourly' | 'daily', periodStart: string, cost: number, tokens: number, requests: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO usage_velocity (key_id, period, period_start, total_cost, total_tokens, request_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key_id, period, period_start)
       DO UPDATE SET total_cost = excluded.total_cost, total_tokens = excluded.total_tokens,
                     request_count = excluded.request_count`,
      [keyId, period, periodStart, cost, tokens, requests]
    )
  }

  getVelocityHistory(keyId: string, period: 'hourly' | 'daily', since: string): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec(
      `SELECT * FROM usage_velocity WHERE key_id = '${keyId}' AND period = '${period}' AND period_start >= '${since}' ORDER BY period_start DESC`
    )
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  // ==========================================================
  // Usage Records
  // ==========================================================

  insertUsageRecords(records: Array<{
    keyId: string
    modelName: string
    tokensInput: number
    tokensOutput: number
    cost: number
    requestCount: number
    date: string
  }>): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      `INSERT INTO usage_records (key_id, model_name, tokens_input, tokens_output, cost, request_count, record_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (const r of records) {
      stmt.bind([r.keyId, r.modelName, r.tokensInput, r.tokensOutput, r.cost, r.requestCount, r.date])
      stmt.step()
      stmt.reset()
    }
    stmt.free()
    this.save()
  }

  getUsageRecords(filters: {
    keyId?: string
    modelName?: string
    dateFrom?: string
    dateTo?: string
    limit?: number
    offset?: number
  }): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM usage_records WHERE 1=1'
    const params: unknown[] = []

    if (filters.keyId) {
      sql += ' AND key_id = ?'
      params.push(filters.keyId)
    }
    if (filters.modelName) {
      sql += ' AND model_name = ?'
      params.push(filters.modelName)
    }
    if (filters.dateFrom) {
      sql += ' AND record_date >= ?'
      params.push(filters.dateFrom)
    }
    if (filters.dateTo) {
      sql += ' AND record_date <= ?'
      params.push(filters.dateTo)
    }

    sql += ' ORDER BY record_date DESC, id DESC'

    const limit = filters.limit ?? 50
    const offset = filters.offset ?? 0
    sql += ` LIMIT ${limit} OFFSET ${offset}`

    const result = this.db.exec(sql)
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  getUsageSummary(keyId: string, groupBy: 'model' | 'day'): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const groupCol = groupBy === 'model' ? 'model_name' : 'record_date'
    const result = this.db.exec(
      `SELECT ${groupCol} as group_key,
              SUM(tokens_input) as total_tokens_input,
              SUM(tokens_output) as total_tokens_output,
              SUM(cost) as total_cost,
              COUNT(*) as record_count
       FROM usage_records
       WHERE key_id = '${keyId}'
       GROUP BY ${groupCol}
       ORDER BY total_cost DESC`
    )
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  // ==========================================================
  // Alert Rules
  // ==========================================================

  getAlertRules(): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec('SELECT * FROM alert_rules ORDER BY created_at DESC')
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  createAlertRule(data: {
    id: string
    keyId: string
    name: string
    metric: string
    condition: string
    threshold: number
    severity?: string
    notifyChannels?: string
    cooldownMs?: number
  }): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO alert_rules (id, key_id, name, metric, condition, threshold, severity, notify_channels, cooldown_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id, data.keyId, data.name, data.metric, data.condition,
        data.threshold, data.severity ?? 'warning',
        data.notifyChannels ?? '["app"]', data.cooldownMs ?? 300000
      ]
    )
    this.save()
  }

  deleteAlertRule(id: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run('DELETE FROM alert_rules WHERE id = ?', [id])
    this.save()
  }

  insertAlertEvent(ruleId: string, value: number, message: string, severity: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      'INSERT INTO alert_history (rule_id, triggered_value, message, severity) VALUES (?, ?, ?, ?)',
      [ruleId, value, message, severity]
    )
    this.save()
  }

  getAlertHistory(limit: number = 50): Array<Record<string, unknown>> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec(
      `SELECT ah.*, ar.name as rule_name
       FROM alert_history ah
       LEFT JOIN alert_rules ar ON ah.rule_id = ar.id
       ORDER BY ah.created_at DESC
       LIMIT ${limit}`
    )
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  acknowledgeAlert(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run('UPDATE alert_history SET acknowledged = 1 WHERE id = ?', [id])
    this.save()
  }

  // ==========================================================
  // App Settings
  // ==========================================================

  getSettings(): Record<string, unknown> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec('SELECT * FROM app_settings')
    if (!result.length) return {}
    const settings: Record<string, unknown> = {}
    for (const row of result[0].values) {
      const key = row[0] as string
      const val = row[1] as string
      try {
        settings[key] = JSON.parse(val)
      } catch {
        settings[key] = val
      }
    }
    return settings
  }

  updateSetting(key: string, value: unknown): void {
    if (!this.db) throw new Error('Database not initialized')
    const val = typeof value === 'string' ? value : JSON.stringify(value)
    this.db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [key, val]
    )
    this.save()
  }

  // ==========================================================
  // Database lifecycle
  // ==========================================================

  save(): void {
    if (!this.db) return
    const data = this.db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(this.dbPath, buffer)
  }

  /** Run WAL checkpoint to prevent unlimited WAL file growth */
  checkpoint(): void {
    if (!this.db) return
    try {
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.warn('[DatabaseService] Checkpoint warning:', (err as Error).message)
    }
  }

  close(): void {
    if (!this.db) return
    this.save()
    this.db.close()
    this.db = null
    console.log('[DatabaseService] Closed')
  }

  // ==========================================================
  // Helpers
  // ==========================================================

  private rowsToObjects(result: { columns: string[]; values: Array<Array<unknown>> }): Array<Record<string, unknown>> {
    return result.values.map(row => this.rowToObject(result.columns, row))
  }

  private rowToObject(columns: string[], values: Array<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      // Convert snake_case column names to camelCase
      const key = columns[i].replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      obj[key] = values[i]
    }
    return obj
  }
}

export const databaseService = new DatabaseService()

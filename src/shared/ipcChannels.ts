// ============================================================
// dsmonitor — IPC Channel Name Constants
// Single source of truth for all IPC channel names
// ============================================================

// Request/Response channels (ipcMain.handle / ipcRenderer.invoke)
export const IPC = {
  // Platform definitions
  PLATFORM_DEFINITIONS_LIST: 'platform-definitions:list',

  // API Key instances
  KEY_LIST: 'key:list',
  KEY_CREATE: 'key:create',
  KEY_UPDATE: 'key:update',
  KEY_DELETE: 'key:delete',
  KEY_TEST_CONNECTION: 'key:test-connection',

  // Balance / Quota data
  BALANCE_GET_LATEST: 'balance:get-latest',
  BALANCE_GET_HISTORY: 'balance:get-history',
  BALANCE_REFRESH: 'balance:refresh',
  BALANCE_SNAPSHOT: 'balance:snapshot',

  // Burn rate
  BURNRATE_GET: 'burnrate:get',

  // Usage records
  USAGE_GET_RECORDS: 'usage:get-records',
  USAGE_GET_SUMMARY: 'usage:get-summary',
  USAGE_EXPORT_CSV: 'usage:export-csv',

  // Alerts
  ALERT_LIST_RULES: 'alert:list-rules',
  ALERT_CREATE_RULE: 'alert:create-rule',
  ALERT_UPDATE_RULE: 'alert:update-rule',
  ALERT_DELETE_RULE: 'alert:delete-rule',
  ALERT_GET_HISTORY: 'alert:get-history',
  ALERT_ACKNOWLEDGE: 'alert:acknowledge',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Window operations
  WINDOW_GET_TYPE: 'window:get-type',
  WINDOW_SHOW_DASHBOARD: 'window:show-dashboard',
  WINDOW_TOGGLE_HUD: 'window:toggle-hud',
  WINDOW_SET_HUD_COMPACT: 'window:set-hud-compact',
  WINDOW_QUIT: 'window:quit',

  // Account discovery
  DISCOVERY_SCAN: 'discovery:scan',
  DISCOVERY_ADD_KEYS: 'discovery:add-keys',

  // Optimization hints
  HINTS_LIST: 'hints:list',
  HINTS_DISMISS: 'hints:dismiss',

  // App info
  APP_VERSION: 'app:version'
} as const

// Push events from main to renderer (webContents.send / ipcRenderer.on)
export const MAIN_EVENTS = {
  METRICS_UPDATE: 'metrics:update',
  POLLING_ERROR: 'polling:error',
  POLLING_STATUS: 'polling:status',
  ALERT_TRIGGERED: 'alert:triggered',
  HUD_UPDATE: 'hud:update',
  DISCOVERY_PROGRESS: 'discovery:progress',
  NAVIGATE: 'navigate'
} as const

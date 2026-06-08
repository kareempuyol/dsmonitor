import { contextBridge, ipcRenderer } from 'electron'
import { IPC, MAIN_EVENTS } from '@shared/ipcChannels'
import type {
  ApiKeyInstance,
  ApiKeyInstanceWithDefinition,
  PlatformDefinition,
  PlatformStatus,
  BurnRate,
  UnifiedUsageRecord,
  UsageFilter,
  UsageSummary,
  AlertRule,
  AlertEvent,
  AlertSeverity,
  AlertNotifyChannel,
  AppSettings,
  HudMetrics,
  MetricsDelta,
  OptimizationHint
} from '@shared/types'

// ============================================================
// Typed API surface exposed to renderer via contextBridge
// ============================================================

const electronAPI = {
  // --- Window ---
  getWindowType: (): string => {
    const params = new URLSearchParams(globalThis.location.hash.slice(1) || globalThis.location.search)
    return params.get('window') || 'dashboard'
  },

  showDashboard: () => ipcRenderer.invoke(IPC.WINDOW_SHOW_DASHBOARD),
  toggleHUD: () => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_HUD),
  setHudCompact: (compact: boolean) => ipcRenderer.invoke(IPC.WINDOW_SET_HUD_COMPACT, compact),
  quit: () => ipcRenderer.invoke(IPC.WINDOW_QUIT),
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_VERSION),

  // --- Platform Definitions ---
  getPlatformDefinitions: (): Promise<PlatformDefinition[]> =>
    ipcRenderer.invoke(IPC.PLATFORM_DEFINITIONS_LIST),

  // --- API Key Instances ---
  getKeys: (): Promise<ApiKeyInstanceWithDefinition[]> =>
    ipcRenderer.invoke(IPC.KEY_LIST),
  createKey: (data: { definitionId: string; label: string; apiKey: string; dailyBudget?: number; monthlyBudget?: number }): Promise<ApiKeyInstance> =>
    ipcRenderer.invoke(IPC.KEY_CREATE, data),
  updateKey: (id: string, data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC.KEY_UPDATE, id, data),
  deleteKey: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.KEY_DELETE, id),
  testKeyConnection: (id: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.KEY_TEST_CONNECTION, id),

  // --- Balance ---
  getLatestBalance: (instanceId?: string): Promise<PlatformStatus[]> =>
    ipcRenderer.invoke(IPC.BALANCE_GET_LATEST, instanceId),
  getBalanceHistory: (instanceId: string, since: number): Promise<PlatformStatus[]> =>
    ipcRenderer.invoke(IPC.BALANCE_GET_HISTORY, instanceId, since),
  refreshBalance: (): Promise<PlatformStatus[]> =>
    ipcRenderer.invoke(IPC.BALANCE_REFRESH),
  getSnapshot: (): Promise<PlatformStatus[]> =>
    ipcRenderer.invoke(IPC.BALANCE_SNAPSHOT),

  // --- Burn Rate ---
  getBurnRate: (): Promise<BurnRate> =>
    ipcRenderer.invoke(IPC.BURNRATE_GET),

  // --- Usage ---
  getUsageRecords: (filters: UsageFilter): Promise<UnifiedUsageRecord[]> =>
    ipcRenderer.invoke(IPC.USAGE_GET_RECORDS, filters),
  getUsageSummary: (instanceId: string, groupBy: 'model' | 'day'): Promise<UsageSummary[]> =>
    ipcRenderer.invoke(IPC.USAGE_GET_SUMMARY, instanceId, groupBy),
  exportCSV: (filters: UsageFilter): Promise<string> =>
    ipcRenderer.invoke(IPC.USAGE_EXPORT_CSV, filters),

  // --- Alerts ---
  getAlertRules: (): Promise<AlertRule[]> =>
    ipcRenderer.invoke(IPC.ALERT_LIST_RULES),
  createAlertRule: (data: {
    keyId: string; name: string; metric: string; condition: 'less_than' | 'greater_than';
    threshold: number; severity: AlertSeverity; notifyChannels: AlertNotifyChannel[]
  }): Promise<AlertRule> =>
    ipcRenderer.invoke(IPC.ALERT_CREATE_RULE, data),
  updateAlertRule: (id: string, data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC.ALERT_UPDATE_RULE, id, data),
  deleteAlertRule: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.ALERT_DELETE_RULE, id),
  getAlertHistory: (options?: { limit?: number }): Promise<AlertEvent[]> =>
    ipcRenderer.invoke(IPC.ALERT_GET_HISTORY, options),
  acknowledgeAlert: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.ALERT_ACKNOWLEDGE, id),

  // --- Settings ---
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (data: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_UPDATE, data),

  // --- Account Discovery ---
  scanForKeys: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.DISCOVERY_SCAN),
  addDiscoveredKeys: (keys: unknown[]): Promise<void> =>
    ipcRenderer.invoke(IPC.DISCOVERY_ADD_KEYS, keys),

  // --- Optimization Hints ---
  getHints: (): Promise<OptimizationHint[]> =>
    ipcRenderer.invoke(IPC.HINTS_LIST),
  dismissHint: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.HINTS_DISMISS, id),

  // --- Event Subscriptions (main → renderer push) ---
  onMetricsUpdate: (callback: (delta: MetricsDelta) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: MetricsDelta): void => callback(delta)
    ipcRenderer.on(MAIN_EVENTS.METRICS_UPDATE, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.METRICS_UPDATE, handler) }
  },

  onPollingError: (callback: (error: { instanceId: string; error: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { instanceId: string; error: string }): void => callback(data)
    ipcRenderer.on(MAIN_EVENTS.POLLING_ERROR, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.POLLING_ERROR, handler) }
  },

  onPollingStatus: (callback: (status: { running: boolean; lastCycle: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { running: boolean; lastCycle: number }): void => callback(data)
    ipcRenderer.on(MAIN_EVENTS.POLLING_STATUS, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.POLLING_STATUS, handler) }
  },

  onAlertTriggered: (callback: (alert: AlertEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, alert: AlertEvent): void => callback(alert)
    ipcRenderer.on(MAIN_EVENTS.ALERT_TRIGGERED, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.ALERT_TRIGGERED, handler) }
  },

  onHudUpdate: (callback: (metrics: HudMetrics) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, metrics: HudMetrics): void => callback(metrics)
    ipcRenderer.on(MAIN_EVENTS.HUD_UPDATE, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.HUD_UPDATE, handler) }
  },

  onDiscoveryProgress: (callback: (progress: { platform: string; status: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { platform: string; status: string }): void => callback(data)
    ipcRenderer.on(MAIN_EVENTS.DISCOVERY_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(MAIN_EVENTS.DISCOVERY_PROGRESS, handler) }
  },

  /** Listen for navigation commands from main process (e.g. tray menu → Settings) */
  onNavigate: (callback: (route: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, route: string): void => callback(route)
    ipcRenderer.on('navigate', handler)
    return () => { ipcRenderer.removeListener('navigate', handler) }
  }
}

// Expose in renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI

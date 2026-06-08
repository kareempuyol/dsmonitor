import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, screen } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import path from 'path'
import { randomUUID } from 'crypto'

// Services
import { databaseService } from './services/databaseService'
import { secureStorage } from './services/secureStorage'
import { apiPoller } from './services/apiPoller'
import { apiClient } from './services/apiClient'
import { accountDiscovery } from './services/accountDiscovery'
import { burnRateEngine } from './services/burnRateEngine'
import { getPlatformConfig, PLATFORM_CONFIGS } from './services/platformConfigs'
import { bus } from './services/eventBus'

// Shared
import { IPC, MAIN_EVENTS } from '@shared/ipcChannels'
import { DEFAULT_POLL_INTERVAL_MS } from '@shared/constants'
import { DEFAULT_SETTINGS, type AppSettings, type MetricsDelta, type HudMetrics, type AlertEvent } from '@shared/types'

// ============================================================
// Window Manager
// ============================================================

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function getIconPath(name: string): string {
  return path.join(__dirname, '../../resources', name)
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'dsmonitor',
    backgroundColor: '#09090B',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Minimize to tray on close
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=dashboard')
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/?window=dashboard'
    })
  }

  return win
}

function createHudWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 280,
    height: 36,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: 'dsmonitor HUD',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Position at top-right initially
  const { workArea } = screen.getPrimaryDisplay()
  win.setPosition(workArea.x + workArea.width - 300, workArea.y + 12)

  // Edge snapping
  let snapTimeout: ReturnType<typeof setTimeout> | null = null
  win.on('moved', () => {
    if (snapTimeout) clearTimeout(snapTimeout)
    snapTimeout = setTimeout(() => snapToEdge(win), 200)
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=hud')
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/?window=hud'
    })
  }

  return win
}

function snapToEdge(win: BrowserWindow): void {
  const SNAP_THRESHOLD = 12
  const { workArea } = screen.getPrimaryDisplay()
  const [x, y] = win.getPosition()
  const [w, h] = win.getSize()

  let newX = x, newY = y

  if (Math.abs(y - workArea.y) < SNAP_THRESHOLD) newY = workArea.y
  if (Math.abs(y + h - (workArea.y + workArea.height)) < SNAP_THRESHOLD) newY = workArea.y + workArea.height - h
  if (Math.abs(x - workArea.x) < SNAP_THRESHOLD) newX = workArea.x
  if (Math.abs(x + w - (workArea.x + workArea.width)) < SNAP_THRESHOLD) newX = workArea.x + workArea.width - w

  if (newX !== x || newY !== y) {
    win.setPosition(newX, newY)
  }
}

function createTray(): Tray {
  // Create a simple 16x16 tray icon programmatically
  // Draw a filled circle on a transparent background
  const size = 16
  const canvas = Buffer.alloc(size * size * 4) // RGBA

  // Draw a simple filled circle (violet brand color)
  const cx = size / 2, cy = size / 2, r = 6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const idx = (y * size + x) * 4
      if (dist <= r) {
        canvas[idx] = 167     // R (violet-400)
        canvas[idx + 1] = 139 // G
        canvas[idx + 2] = 250 // B
        canvas[idx + 3] = 255 // A
      }
    }
  }

  const trayIcon = nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size
  })

  tray = new Tray(trayIcon)
  tray.setToolTip('dsmonitor — AI API Monitor')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主面板',
      click: () => {
        if (!mainWindow) mainWindow = createMainWindow()
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: '显示/隐藏悬浮条 (HUD)',
      type: 'checkbox',
      checked: false,
      click: (mi) => toggleHud(mi.checked)
    },
    { type: 'separator' },
    {
      label: '立即刷新数据',
      click: () => apiPoller.forcePoll()
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        if (!mainWindow) mainWindow = createMainWindow()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send(MAIN_EVENTS.NAVIGATE, '/settings')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (!mainWindow) mainWindow = createMainWindow()
    mainWindow.show()
    mainWindow.focus()
  })

  return tray
}

function toggleHud(show: boolean): void {
  if (show && !hudWindow) {
    hudWindow = createHudWindow()
    hudWindow.once('ready-to-show', () => hudWindow!.show())
  } else if (!show && hudWindow) {
    hudWindow.close()
    hudWindow = null
  }
}

// ============================================================
// IPC Handler Registration
// ============================================================

function registerIpcHandlers(): void {
  // --- Platform Definitions ---
  ipcMain.handle(IPC.PLATFORM_DEFINITIONS_LIST, () => {
    return databaseService.getPlatformDefinitions()
  })

  // --- API Key Instances ---
  ipcMain.handle(IPC.KEY_LIST, () => {
    const keys = databaseService.getApiKeys()
    // Strip sensitive key data
    return keys.map(k => ({
      ...k,
      hasKey: !!(k.keyValue as string),
      keyValue: undefined
    }))
  })

  ipcMain.handle(IPC.KEY_CREATE, (_event, data: {
    definitionId: string; label: string; apiKey: string; dailyBudget?: number; monthlyBudget?: number
  }) => {
    const id = randomUUID()
    const encryptedKey = secureStorage.encrypt(data.apiKey)
    databaseService.createApiKey({
      id,
      definitionId: data.definitionId,
      label: data.label,
      keyValue: encryptedKey,
      dailyBudget: data.dailyBudget,
      monthlyBudget: data.monthlyBudget
    })
    // Restart poller to include new key
    apiPoller.stop()
    const settings = databaseService.getSettings()
    apiPoller.start((settings.pollingIntervalMs as number) || DEFAULT_POLL_INTERVAL_MS)
    return databaseService.getApiKey(id)
  })

  ipcMain.handle(IPC.KEY_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    if (data.apiKey) {
      data.keyValue = secureStorage.encrypt(data.apiKey as string)
      delete data.apiKey
    }
    databaseService.updateApiKey(id, data)
  })

  ipcMain.handle(IPC.KEY_DELETE, (_event, id: string) => {
    databaseService.deleteApiKey(id)
  })

  ipcMain.handle(IPC.KEY_TEST_CONNECTION, async (_event, id: string) => {
    const key = databaseService.getApiKey(id)
    if (!key) return { ok: false, message: 'Key not found' }
    const config = getPlatformConfig(key.definitionId as string)
    if (!config) return { ok: false, message: 'Unsupported platform' }
    const apiKey = secureStorage.decrypt(key.keyValue as string)
    return apiClient.testConnection(config, apiKey, {})
  })

  // --- Balance ---
  ipcMain.handle(IPC.BALANCE_GET_LATEST, (_event, instanceId?: string) => {
    if (instanceId) {
      const snap = databaseService.getLatestBalance(instanceId)
      return snap ? [JSON.parse(snap.balanceData as string)] : []
    }
    const keys = databaseService.getApiKeys()
    return keys
      .map(k => {
        const snap = databaseService.getLatestBalance(k.id as string)
        return snap ? JSON.parse(snap.balanceData as string) : null
      })
      .filter(Boolean)
  })

  ipcMain.handle(IPC.BALANCE_GET_HISTORY, (_event, instanceId: string, since: number) => {
    return databaseService.getBalanceHistory(instanceId, since)
      .map(s => JSON.parse(s.balanceData as string))
  })

  ipcMain.handle(IPC.BALANCE_REFRESH, async () => {
    return apiPoller.forcePoll()
  })

  ipcMain.handle(IPC.BALANCE_SNAPSHOT, () => {
    return databaseService.getApiKeys()
      .map(k => {
        const snap = databaseService.getLatestBalance(k.id as string)
        return snap ? JSON.parse(snap.balanceData as string) : null
      })
      .filter(Boolean)
  })

  // --- Burn Rate ---
  ipcMain.handle(IPC.BURNRATE_GET, () => {
    return burnRateEngine.evaluate()
  })

  // --- Usage ---
  ipcMain.handle(IPC.USAGE_GET_RECORDS, (_event, filters) => {
    return databaseService.getUsageRecords(filters)
  })

  ipcMain.handle(IPC.USAGE_GET_SUMMARY, (_event, instanceId: string, groupBy: 'model' | 'day') => {
    return databaseService.getUsageSummary(instanceId, groupBy)
  })

  ipcMain.handle(IPC.USAGE_EXPORT_CSV, (_event, filters) => {
    // Simple CSV export
    const records = databaseService.getUsageRecords({ ...filters, limit: 10000 })
    const headers = ['date', 'model_name', 'tokens_input', 'tokens_output', 'cost', 'request_count']
    const rows = records.map(r => headers.map(h => r[h] ?? '').join(','))
    return [headers.join(','), ...rows].join('\n')
  })

  // --- Alerts ---
  ipcMain.handle(IPC.ALERT_LIST_RULES, () => {
    return databaseService.getAlertRules()
  })

  ipcMain.handle(IPC.ALERT_CREATE_RULE, (_event, data) => {
    const id = randomUUID()
    databaseService.createAlertRule({ id, ...data })
    return databaseService.getAlertRules().find(r => r.id === id)
  })

  ipcMain.handle(IPC.ALERT_UPDATE_RULE, (_event, id: string, data: Record<string, unknown>) => {
    databaseService.updateAlertRule(id, data)
  })

  ipcMain.handle(IPC.ALERT_DELETE_RULE, (_event, id: string) => {
    databaseService.deleteAlertRule(id)
  })

  ipcMain.handle(IPC.ALERT_GET_HISTORY, (_event, options?: { limit?: number }) => {
    return databaseService.getAlertHistory(options?.limit ?? 50)
  })

  ipcMain.handle(IPC.ALERT_ACKNOWLEDGE, (_event, id: number) => {
    databaseService.acknowledgeAlert(id)
  })

  // --- Settings ---
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    const raw = databaseService.getSettings()
    return { ...DEFAULT_SETTINGS, ...raw }
  })

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, data: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(data)) {
      databaseService.updateSetting(key, value)
    }
  })

  // --- Window ---
  ipcMain.handle(IPC.WINDOW_GET_TYPE, () => 'dashboard')
  ipcMain.handle(IPC.WINDOW_SHOW_DASHBOARD, () => {
    if (!mainWindow) mainWindow = createMainWindow()
    mainWindow.show()
    mainWindow.focus()
  })
  ipcMain.handle(IPC.WINDOW_TOGGLE_HUD, () => {
    toggleHud(!hudWindow)
    return !!hudWindow
  })
  ipcMain.handle(IPC.WINDOW_SET_HUD_COMPACT, (_event, compact: boolean) => {
    hudWindow?.setSize(compact ? 200 : 280, compact ? 24 : 36)
  })
  ipcMain.handle(IPC.WINDOW_QUIT, () => {
    isQuitting = true
    app.quit()
  })

  // --- Discovery ---
  ipcMain.handle(IPC.DISCOVERY_SCAN, async () => {
    return accountDiscovery.scan()
  })

  ipcMain.handle(IPC.DISCOVERY_ADD_KEYS, async (_event, keys: unknown[]) => {
    return accountDiscovery.addDiscoveredKeys(keys as Parameters<typeof accountDiscovery.addDiscoveredKeys>[0])
  })

  // --- App ---
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion())
}

// ============================================================
// Main → Renderer event forwarding
// ============================================================

function forwardEvents(): void {
  bus.on('metrics:delta', (delta: MetricsDelta) => {
    mainWindow?.webContents.send(MAIN_EVENTS.METRICS_UPDATE, delta)
    // HUD only needs HUD_UPDATE (smaller payload), not full metrics delta
  })

  bus.on('hud:update', (metrics: HudMetrics) => {
    hudWindow?.webContents.send(MAIN_EVENTS.HUD_UPDATE, metrics)
  })

  bus.on('poller:error', (instanceId: string, error) => {
    mainWindow?.webContents.send(MAIN_EVENTS.POLLING_ERROR, { instanceId, error: error.message })
  })

  bus.on('poller:status', (status) => {
    mainWindow?.webContents.send(MAIN_EVENTS.POLLING_STATUS, status)
  })

  bus.on('alert:fired', (alerts: AlertEvent[]) => {
    mainWindow?.webContents.send(MAIN_EVENTS.ALERT_TRIGGERED, alerts[0])
    // Windows notification
    if (Notification.isSupported() && alerts.length > 0) {
      const alert = alerts[0]
      new Notification({
        title: 'dsmonitor Alert',
        body: alert.message,
        urgency: alert.severity === 'critical' ? 'critical' : 'normal'
      }).show()
    }
  })
}

// ============================================================
// Bootstrap
// ============================================================

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.dsmonitor.app')
    optimizer.watchWindowShortcuts()

    // Initialize database
    await databaseService.init()
    bus.emit('db:ready')

    // Register IPC handlers
    registerIpcHandlers()

    // Forward events to renderer
    forwardEvents()

    // Create tray
    tray = createTray()

    // Load settings
    const settings = databaseService.getSettings() as unknown as Record<string, unknown>
    // DB stores settings as JSON strings — coerce properly
    const startMinimized = settings.startMinimizedToTray !== undefined
      ? String(settings.startMinimizedToTray) === 'true'
      : DEFAULT_SETTINGS.startMinimizedToTray

    // Create main window
    mainWindow = createMainWindow()

    if (!startMinimized) {
      mainWindow.once('ready-to-show', () => mainWindow!.show())
    }

    // Start polling
    const interval = settings.pollingIntervalMs || DEFAULT_POLL_INTERVAL_MS
    apiPoller.start(interval)

    // Run account discovery on first launch
    const keys = databaseService.getApiKeys()
    if (keys.length === 0) {
      console.log('[Bootstrap] No keys configured — running discovery...')
      accountDiscovery.scan().then(results => {
        const valid = results.filter(r => r.validated)
        if (valid.length > 0) {
          accountDiscovery.addDiscoveredKeys(valid)
        }
      })
    }

    console.log('[Bootstrap] dsmonitor ready')
  })

  app.on('window-all-closed', () => {
    // Keep running in tray
  })

  app.on('before-quit', () => {
    isQuitting = true
    apiPoller.stop()
    databaseService.close()
  })
}

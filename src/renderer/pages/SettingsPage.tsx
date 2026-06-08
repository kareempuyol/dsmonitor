import { useState } from 'react'
import { usePlatformStore } from '../stores/usePlatformStore'

interface Props {
  onBack?: () => void
}

type SettingsTab = 'general' | 'api-keys' | 'budgets' | 'alerts' | 'appearance'

export default function SettingsPage({ onBack }: Props): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('api-keys')
  const instances = usePlatformStore(s => s.instances)
  const definitions = usePlatformStore(s => s.definitions)
  const addKey = usePlatformStore(s => s.addKey)
  const removeKey = usePlatformStore(s => s.removeKey)
  const testConnection = usePlatformStore(s => s.testConnection)

  // Form state
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [keyLabel, setKeyLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleAddKey = async (): Promise<void> => {
    if (!selectedPlatform || !apiKey) return
    setAdding(true)
    try {
      await addKey({
        definitionId: selectedPlatform,
        label: keyLabel || selectedPlatform,
        apiKey
      })
      setApiKey('')
      setKeyLabel('')
      setSelectedPlatform('')
      setTestResult(null)
    } catch (err) {
      console.error('Failed to add key:', err)
    } finally {
      setAdding(false)
    }
  }

  const tabs: Array<{ id: SettingsTab; label: string; labelCn: string; icon: string }> = [
    { id: 'general', label: 'General', labelCn: '通用', icon: '📊' },
    { id: 'api-keys', label: 'API Keys', labelCn: 'API 密钥', icon: '🔑' },
    { id: 'budgets', label: 'Budgets', labelCn: '预算', icon: '💰' },
    { id: 'alerts', label: 'Alerts', labelCn: '告警', icon: '⚡' },
    { id: 'appearance', label: 'Appearance', labelCn: '外观', icon: '🎨' }
  ]

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
          >
            ← Back
          </button>
        )}
        <h1 className="text-lg font-bold font-mono text-zinc-50">Settings</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 border-r border-zinc-800 p-3 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                activeTab === tab.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.labelCn}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {activeTab === 'api-keys' && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-lg font-medium text-zinc-200">API Keys</h2>

              {/* Existing keys */}
              {instances.length > 0 && (
                <div className="space-y-2">
                  {instances.map(inst => (
                    <div key={inst.id} className="glass-surface rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-300">{inst.label}</span>
                          <span className="text-xs text-zinc-600">{inst.definitionId}</span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          Status: {inst.status}
                          {inst.statusMessage && ` — ${inst.statusMessage}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {inst.status === 'ok' && (
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        )}
                        {inst.status === 'error' && (
                          <div className="w-2 h-2 rounded-full bg-red-400" />
                        )}
                        <button
                          onClick={() => removeKey(inst.id)}
                          className="text-xs text-zinc-500 hover:text-red-400 transition-colors ml-2"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new key */}
              <div className="glass-surface rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium text-zinc-300">Add API Key</h3>

                <select
                  value={selectedPlatform}
                  onChange={e => setSelectedPlatform(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="">Select platform...</option>
                  {definitions.map(d => (
                    <option key={d.id} value={d.id}>{d.displayNameCn} ({d.displayName})</option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Label (e.g. Personal Account)"
                  value={keyLabel}
                  onChange={e => setKeyLabel(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                />

                <input
                  type="password"
                  placeholder="API Key"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 font-mono"
                />

                {testResult && (
                  <div className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.ok ? '✓' : '✗'} {testResult.message}
                  </div>
                )}

                <button
                  onClick={handleAddKey}
                  disabled={!selectedPlatform || !apiKey || adding}
                  className="w-full py-2 bg-violet-400/20 text-violet-400 rounded-lg text-sm font-medium hover:bg-violet-400/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {adding ? 'Adding...' : 'Add Key'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-lg font-medium text-zinc-200">General Settings</h2>

              <div className="glass-surface rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">Polling Interval / 轮询间隔</div>
                    <div className="text-xs text-zinc-500">How often to fetch data from APIs</div>
                  </div>
                  <select className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200">
                    <option value="60000">1 minute</option>
                    <option value="300000" selected>5 minutes</option>
                    <option value="600000">10 minutes</option>
                    <option value="1800000">30 minutes</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">Start Minimized / 启动最小化</div>
                    <div className="text-xs text-zinc-500">Start app minimized to system tray</div>
                  </div>
                  <div className="w-10 h-5 bg-emerald-400/30 rounded-full flex items-center px-0.5 cursor-pointer">
                    <div className="w-4 h-4 bg-emerald-400 rounded-full ml-auto" />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">HUD / 悬浮条</div>
                    <div className="text-xs text-zinc-500">Show floating always-on-top metrics bar</div>
                  </div>
                  <div className="w-10 h-5 bg-zinc-700 rounded-full flex items-center px-0.5 cursor-pointer">
                    <div className="w-4 h-4 bg-zinc-500 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'budgets' && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-lg font-medium text-zinc-200">Budget Settings</h2>

              <div className="glass-surface rounded-lg p-4 space-y-4">
                <div>
                  <div className="text-sm text-zinc-300 mb-2">Monthly Budget / 月预算</div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500">¥</span>
                    <input
                      type="number"
                      placeholder="2000"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono"
                    />
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">Set a cap for total monthly spending across all platforms</div>
                </div>

                <div>
                  <div className="text-sm text-zinc-300 mb-2">Daily Budget / 日预算</div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500">¥</span>
                    <input
                      type="number"
                      placeholder="100"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono"
                    />
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">Daily spending limit for alerts and HUD progress bar</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'alerts' && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-lg font-medium text-zinc-200">Alert Rules</h2>
              <div className="glass-surface rounded-lg p-6 text-center">
                <p className="text-sm text-zinc-500 mb-2">No alert rules configured</p>
                <p className="text-xs text-zinc-600 mb-4">
                  Default alerts fire when daily budget exceeds 80% or API connections fail.
                </p>
                <button className="px-4 py-2 bg-violet-400/20 text-violet-400 rounded-lg text-sm hover:bg-violet-400/30 transition-colors">
                  + Add Rule
                </button>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-lg font-medium text-zinc-200">Appearance</h2>

              <div className="glass-surface rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">Theme / 主题</div>
                    <div className="text-xs text-zinc-500">Dark mode only (always)</div>
                  </div>
                  <span className="text-sm text-zinc-400">Dark 🌙</span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">Language / 语言</div>
                  </div>
                  <select className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200">
                    <option value="zh-CN" selected>中文</option>
                    <option value="en">English</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-300">HUD Opacity / 悬浮条透明度</div>
                    <div className="text-xs text-zinc-500">Scroll on the HUD to adjust</div>
                  </div>
                  <span className="text-sm text-zinc-400 font-mono">82%</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

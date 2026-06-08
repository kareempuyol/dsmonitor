import { useState, useEffect, useCallback, useRef } from 'react'

// ============================================================
// Command Palette — Raycast-style keyboard command interface
// ============================================================

interface Command {
  id: string
  label: string
  labelCn: string
  shortcut?: string
  action: () => void
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function CommandPalette({ isOpen, onClose }: Props): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const commands: Command[] = [
    {
      id: 'dashboard',
      label: 'Show Dashboard',
      labelCn: '显示仪表板',
      shortcut: 'Ctrl+Shift+D',
      action: () => { window.electronAPI?.showDashboard(); onClose() }
    },
    {
      id: 'hud',
      label: 'Toggle HUD',
      labelCn: '切换悬浮条',
      shortcut: 'Ctrl+Shift+H',
      action: () => { window.electronAPI?.toggleHUD(); onClose() }
    },
    {
      id: 'refresh',
      label: 'Refresh Data',
      labelCn: '刷新数据',
      action: () => { window.electronAPI?.refreshBalance(); onClose() }
    },
    {
      id: 'settings',
      label: 'Open Settings',
      labelCn: '打开设置',
      shortcut: 'Ctrl+Shift+,',
      action: onClose // Navigate handled by parent
    },
    {
      id: 'quit',
      label: 'Quit',
      labelCn: '退出',
      action: () => { window.electronAPI?.quit() }
    }
  ]

  const filtered = query
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.labelCn.includes(query)
      )
    : commands

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action()
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [filtered, selectedIndex, onClose])

  // Global Esc handler
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-[480px] glass-surface rounded-2xl overflow-hidden shadow-2xl border-zinc-700/30"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700/30">
          <span className="text-zinc-500 text-sm">▸</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 outline-none font-mono"
            autoFocus
          />
          <kbd className="text-[10px] text-zinc-600 font-mono bg-zinc-800 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        {/* Command list */}
        <div className="max-h-[320px] overflow-auto py-2">
          {filtered.map((cmd, idx) => (
            <button
              key={cmd.id}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                idx === selectedIndex
                  ? 'bg-zinc-800/80 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-base">
                  {cmd.id === 'dashboard' ? '📊' :
                   cmd.id === 'hud' ? '🖥️' :
                   cmd.id === 'refresh' ? '🔄' :
                   cmd.id === 'settings' ? '⚙️' :
                   cmd.id === 'quit' ? '🚪' : '•'}
                </span>
                <span>{cmd.labelCn}</span>
                <span className="text-xs text-zinc-600">{cmd.label}</span>
              </div>
              {cmd.shortcut && (
                <kbd className="text-[10px] text-zinc-600 font-mono bg-zinc-800 px-1.5 py-0.5 rounded">
                  {cmd.shortcut}
                </kbd>
              )}
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600">
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

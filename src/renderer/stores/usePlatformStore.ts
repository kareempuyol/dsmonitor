import { create } from 'zustand'
import type { PlatformDefinition, ApiKeyInstanceWithDefinition } from '@shared/types'

interface PlatformState {
  definitions: PlatformDefinition[]
  instances: ApiKeyInstanceWithDefinition[]
  isLoading: boolean
  error: string | null

  fetchDefinitions: () => Promise<void>
  fetchInstances: () => Promise<void>
  addKey: (data: {
    definitionId: string; label: string; apiKey: string; dailyBudget?: number; monthlyBudget?: number
  }) => Promise<void>
  updateKey: (id: string, data: Record<string, unknown>) => Promise<void>
  removeKey: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>
}

export const usePlatformStore = create<PlatformState>((set) => ({
  definitions: [],
  instances: [],
  isLoading: false,
  error: null,

  fetchDefinitions: async () => {
    if (!window.electronAPI) return
    set({ isLoading: true })
    try {
      const defs = await window.electronAPI.getPlatformDefinitions()
      set({ definitions: defs, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  fetchInstances: async () => {
    if (!window.electronAPI) return
    set({ isLoading: true })
    try {
      const instances = await window.electronAPI.getKeys()
      set({ instances, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  addKey: async (data) => {
    if (!window.electronAPI) return
    await window.electronAPI.createKey(data)
    // Refresh instances
    const instances = await window.electronAPI.getKeys()
    set({ instances })
  },

  updateKey: async (id, data) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateKey(id, data)
    const instances = await window.electronAPI.getKeys()
    set({ instances })
  },

  removeKey: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteKey(id)
    const instances = await window.electronAPI.getKeys()
    set({ instances })
  },

  testConnection: async (id) => {
    if (!window.electronAPI) return { ok: false, message: 'API not available' }
    return window.electronAPI.testKeyConnection(id)
  }
}))

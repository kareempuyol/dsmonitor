import { create } from 'zustand'

interface UIState {
  isMainWindowVisible: boolean
  isHudVisible: boolean
  hudCompact: boolean
  theme: 'dark'
  language: 'zh-CN' | 'en'
  sidePanelOpen: boolean

  setMainWindowVisible: (v: boolean) => void
  setHudVisible: (v: boolean) => void
  setHudCompact: (v: boolean) => void
  setLanguage: (l: 'zh-CN' | 'en') => void
  toggleSidePanel: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isMainWindowVisible: true,
  isHudVisible: false,
  hudCompact: false,
  theme: 'dark',
  language: 'zh-CN',
  sidePanelOpen: false,

  setMainWindowVisible: (v) => set({ isMainWindowVisible: v }),
  setHudVisible: (v) => set({ isHudVisible: v }),
  setHudCompact: (v) => set({ hudCompact: v }),
  setLanguage: (l) => set({ language: l }),
  toggleSidePanel: () => set(s => ({ sidePanelOpen: !s.sidePanelOpen }))
}))

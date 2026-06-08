import { EventEmitter } from 'events'
import type {
  PlatformStatus,
  BurnRate,
  HudMetrics,
  MetricsDelta,
  AlertEvent,
  ApiErrorInfo
} from '@shared/types'

// ============================================================
// Service Event Definitions
// All inter-service communication goes through the EventBus.
// No service directly imports another service.
// ============================================================

export interface ServiceEvents {
  // Polling lifecycle
  'poller:data': (statuses: PlatformStatus[]) => void
  'poller:error': (instanceId: string, error: ApiErrorInfo) => void
  'poller:cycle-done': (timestamp: number) => void
  'poller:status': (status: { running: boolean; lastCycle: number }) => void

  // Data updates
  'burnrate:updated': (rates: BurnRate[]) => void
  'hud:update': (metrics: HudMetrics) => void
  'metrics:delta': (delta: MetricsDelta) => void

  // Alerts
  'alert:fired': (events: AlertEvent[]) => void

  // Database
  'db:ready': () => void

  // Discovery
  'discovery:progress': (data: { platform: string; status: string }) => void
  'discovery:complete': (results: unknown[]) => void
}

type TypedEventEmitter = {
  on<K extends keyof ServiceEvents>(event: K, listener: ServiceEvents[K]): void
  off<K extends keyof ServiceEvents>(event: K, listener: ServiceEvents[K]): void
  emit<K extends keyof ServiceEvents>(event: K, ...args: Parameters<ServiceEvents[K]>): void
}

export const bus: TypedEventEmitter = new EventEmitter() as TypedEventEmitter

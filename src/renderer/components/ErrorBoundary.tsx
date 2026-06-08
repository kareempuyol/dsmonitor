import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error('[ErrorBoundary]', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="h-screen flex items-center justify-center bg-zinc-950">
          <div className="text-center space-y-3 max-w-md px-6">
            <div className="text-3xl">⚠️</div>
            <h2 className="text-lg font-medium text-zinc-300">Something went wrong</h2>
            <p className="text-sm text-zinc-500 break-all font-mono">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 mt-2 bg-violet-400/20 text-violet-400 rounded-lg text-sm hover:bg-violet-400/30 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** Safe number formatting — never crashes on undefined/null */
export function safeFixed(value: number | undefined | null, digits: number = 2): string {
  return ((value ?? 0) as number).toFixed(digits)
}

export function safeLocale(value: number | undefined | null): string {
  return ((value ?? 0) as number).toLocaleString()
}

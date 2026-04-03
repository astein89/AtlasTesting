import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { testingPath } from '../lib/appPaths'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  backTo?: string
  backLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 py-8">
          <h2 className="text-lg font-semibold text-foreground">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="max-w-md text-center text-sm text-foreground/80">
            {this.state.error.message}
          </p>
          <Link
            to={this.props.backTo ?? testingPath('test-plans')}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-card"
          >
            {this.props.backLabel ?? 'Back to Test plans'}
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}

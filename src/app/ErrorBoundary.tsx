import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { logger } from '@/infrastructure/logger/logger'
import { isAppError } from '@/infrastructure/errors/AppError'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
  fallback?: (err: Error, reset: () => void) => ReactNode
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(
      'Unhandled error in component tree',
      { componentStack: info.componentStack },
      error,
    )
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {isAppError(error) ? error.message : error.message || 'Unexpected error'}
          </p>
          <Button onClick={this.reset} variant="outline">
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
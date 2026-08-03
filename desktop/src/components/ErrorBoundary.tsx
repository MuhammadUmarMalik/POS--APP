// The last line of defence against a blank window.
//
// React unmounts the whole tree when a render throws, and #root is emptied —
// so without a boundary any single bad value anywhere renders as a white
// screen with nothing to report. Everything below shows the failure instead.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown above the message, e.g. "This screen could not be opened". */
  title?: string
  /** Remounts the subtree instead of reloading the whole window. */
  onReset?: () => void
}

interface State {
  error: Error | null
  details: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, details: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes to the DevTools console and, in a packaged build, to the main
    // process log — the only trace a shopkeeper can send us after the fact.
    console.error('Unhandled render error:', error, info.componentStack)
    this.setState({ details: `${error.stack ?? error.message}\n\n${info.componentStack ?? ''}`.trim() })
  }

  private reset = () => {
    this.setState({ error: null, details: '' })
    this.props.onReset?.()
  }

  render() {
    const { error, details } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-full items-center justify-center bg-page p-6">
        <div className="w-full max-w-lg rounded-lg border border-danger/30 bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{this.props.title ?? 'Something went wrong'}</h1>
          <p className="mt-2 text-sm text-muted">
            {error.message || 'An unexpected error stopped this screen from loading.'}
          </p>
          <p className="mt-2 text-sm text-muted">
            Your data has not been changed. Try again, and if this keeps happening send the details
            below to support.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-md bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary-hover"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-line px-5 py-2.5 font-medium hover:bg-page"
            >
              Restart screen
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(details || error.message)}
              className="rounded-md border border-line px-5 py-2.5 font-medium hover:bg-page"
            >
              Copy details
            </button>
          </div>
          {details && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted">Technical details</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-page p-3 text-xs text-muted">
                {details}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}

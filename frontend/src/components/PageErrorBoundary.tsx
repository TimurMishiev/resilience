import { Component, Suspense } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Callout, Button, Icon, Spinner } from '@blueprintjs/core'

// ── Per-page loading fallback ────────────────────────────────────────────────
function PageLoadingFallback({ pageName }: { pageName: string }) {
  return (
    <div className="page-loading-fallback bp6-dark" aria-label={`Loading ${pageName}`}>
      <Spinner size={36} />
      <p className="bp6-text-muted page-loading-fallback__label">{pageName}</p>
    </div>
  )
}

interface Props {
  /** Human-readable label shown in the fallback UI, e.g. "Globe" */
  pageName: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Page-level error boundary for heavy/third-party pages (CesiumJS, AI).
 * Renders a styled fallback instead of a blank crash when the subtree throws.
 * Reset by navigating away and back, or by clicking "Try again".
 */
export default class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production you'd forward this to Sentry / Datadog
    console.error(`[PageErrorBoundary] ${error.message}`, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { pageName, children } = this.props

    if (error) {
      return (
        <div className="page-error-boundary bp6-dark">
          <div className="page-error-boundary__inner">
            <Icon icon="warning-sign" size={40} intent="warning" />
            <h2 className="bp6-heading page-error-boundary__title">
              {pageName} failed to load
            </h2>
            <Callout intent="danger" className="page-error-boundary__callout">
              <code>{error.message}</code>
            </Callout>
            <p className="bp6-text-muted page-error-boundary__hint">
              This can happen if a required API key is missing or a third-party
              library failed to initialise. Check the browser console for details.
            </p>
            <Button
              intent="primary"
              icon="refresh"
              onClick={this.handleReset}
            >
              Try again
            </Button>
          </div>
        </div>
      )
    }

    // Suspense here so lazy-load network failures propagate up to THIS
    // error boundary rather than to a distant ancestor.
    return (
      <Suspense fallback={<PageLoadingFallback pageName={pageName} />}>
        {children}
      </Suspense>
    )
  }
}

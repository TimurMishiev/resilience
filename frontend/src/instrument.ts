import * as Sentry from '@sentry/react'
import type { ErrorInfo } from 'react'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim() ?? ''
const sentryEnvironment = import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE
const sentryRelease = import.meta.env.VITE_SENTRY_RELEASE?.trim() || undefined

export const sentryEnabled = sentryDsn.length > 0

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    release: sentryRelease,
    sendDefaultPii: false,
  })
}

export function createRootErrorHandlers() {
  if (!sentryEnabled) return undefined

  return {
    onUncaughtError: Sentry.reactErrorHandler(),
  }
}

export function capturePageRenderException(error: Error, errorInfo: ErrorInfo, pageName: string) {
  if (!Sentry.isInitialized()) return

  Sentry.captureReactException(error, errorInfo, {
    tags: {
      surface: 'page_error_boundary',
      page_name: pageName,
    },
  })
}

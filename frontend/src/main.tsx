import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FocusStyleManager } from '@blueprintjs/core'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import '@blueprintjs/core/lib/css/blueprint.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'

// Reload the page when the service worker updates so the new JS chunks
// (with fresh content hashes) are loaded immediately. The previousController
// guard ensures this only fires on SW *updates*, never on first install.
if ('serviceWorker' in navigator) {
  const previousController = navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (previousController) window.location.reload()
  })
}

// Only show focus outlines when navigating with a keyboard (Blueprint best practice).
FocusStyleManager.onlyShowFocusOnTabs()

// Apply Blueprint dark theme globally.
document.body.classList.add('bp6-dark')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,   // 30 seconds
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)

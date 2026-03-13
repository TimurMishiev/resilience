import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FocusStyleManager } from '@blueprintjs/core'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import '@blueprintjs/core/lib/css/blueprint.css'
import './index.css'
import App from './App.tsx'

// Only show focus outlines when navigating with a keyboard (Blueprint best practice).
FocusStyleManager.onlyShowFocusOnTabs()

// Apply Blueprint dark theme globally.
document.body.classList.add('bp6-dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

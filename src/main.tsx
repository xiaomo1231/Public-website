import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { logger } from '@/infrastructure/logger/logger'
import '@/shared/styles/globals.css'

logger.info('Application starting', { mode: import.meta.env.MODE })

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { logger } from '@/infrastructure/logger/logger'
import { installAIUsageRecording } from '@/services/aiUsageService'
import { SettingsService } from '@/services/settingsService'
import { setLearnedOutputLimitSink } from '@/infrastructure/ai/outputLimit'
import '@/shared/styles/globals.css'

// Every AI response's token usage is counted locally (settings → AI usage).
installAIUsageRecording()
// Output limits learned from provider rejections (自动探测) are remembered.
setLearnedOutputLimitSink((baseURL, model, limit) => {
  void new SettingsService().rememberLearnedOutputLimit(baseURL, model, limit).catch((err) => {
    logger.warn('Could not remember the learned output limit', {
      error: (err as Error)?.message,
    })
  })
})

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

import type { ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { Bootstrap } from './Bootstrap'
import { TooltipProvider } from '@/shared/ui/Tooltip'

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Bootstrap>{children}</Bootstrap>
      </TooltipProvider>
    </ErrorBoundary>
  )
}
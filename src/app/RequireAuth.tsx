import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Gate that sends unauthenticated users to /invite.
 * Preserves the intended destination so users land back where they wanted.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { loaded, isUnlocked } = useAuth()
  const location = useLocation()

  if (!loaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (!isUnlocked) {
    return <Navigate to="/invite" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
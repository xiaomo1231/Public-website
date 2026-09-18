import { Navigate } from 'react-router-dom'

/**
 * Phase 1 has a single entry point: an invite code.
 * /login simply forwards to /invite. When proper accounts are added later,
 * this page can host a real login form.
 */
export function LoginPage(): JSX.Element {
  return <Navigate to="/invite" replace />
}
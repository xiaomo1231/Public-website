import { Navigate, useLocation } from 'react-router-dom'

/**
 * Phase 1 has a single entry point: an invite code.
 * /login simply forwards to /invite (keeping any return path in the
 * navigation state). When proper accounts are added later, this page can
 * host a real login form.
 */
export function LoginPage(): JSX.Element {
  const location = useLocation()
  return <Navigate to="/invite" replace state={location.state} />
}

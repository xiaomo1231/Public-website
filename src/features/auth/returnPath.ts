/**
 * Where to send a student after unlocking.
 *
 * `RequireAuth` stores the address they asked for in the router state as
 * `{ from }`. Only a same-app path is honoured: it must start with a single
 * `/` (not `//host` or a full URL) and must not point back at the gate
 * itself. Anything else falls back to the dashboard.
 */
export const DEFAULT_RETURN_PATH = '/dashboard'

export function safeReturnPath(state: unknown): string {
  if (!state || typeof state !== 'object') return DEFAULT_RETURN_PATH
  const from = (state as { from?: unknown }).from
  if (typeof from !== 'string') return DEFAULT_RETURN_PATH
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\')) {
    return DEFAULT_RETURN_PATH
  }
  const pathname = from.split(/[?#]/, 1)[0] ?? ''
  if (pathname === '/' || pathname === '/invite' || pathname === '/login') {
    return DEFAULT_RETURN_PATH
  }
  return from
}

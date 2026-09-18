import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Bootstrap screen shown while we open IndexedDB and seed the default profile.
 * Avoids the page rendering an empty shell.
 */
export function Bootstrap({ children }: { children: React.ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Tiny delay so IndexedDB open can fire even on fast machines.
    const t = setTimeout(() => setReady(true), 50)
    return () => clearTimeout(t)
  }, [])

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace…
        </div>
      </div>
    )
  }
  return <>{children}</>
}
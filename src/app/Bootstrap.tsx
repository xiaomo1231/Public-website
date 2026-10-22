import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { installKeyboardAvoidance } from '@/shared/lib/keyboardInset'

/**
 * Bootstrap screen shown while we open IndexedDB and seed the default profile.
 * Avoids the page rendering an empty shell.
 */
export function Bootstrap({ children }: { children: React.ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Tiny delay so IndexedDB open can fire even on fast machines.
    const t = setTimeout(() => setReady(true), 50)
    return () => clearTimeout(t)
  }, [])

  // Course analyses cut off by a closed tab would otherwise read "processing" forever.
  useEffect(() => {
    // Imported on demand: these services pull in the AI layer, mathjs, pdf.js
    // and the file extractors, which must stay out of the first-paint bundle.
    void import('@/services/courseContentService')
      .then((m) => m.recoverInterruptedAnalyses())
      .catch(() => undefined)
    // Same for a file whose processing was cut off: it would read 处理中 forever.
    void import('@/services/processingRecovery')
      .then((m) => m.recoverInterruptedProcessing())
      .catch(() => undefined)
  }, [])

  // iPad: keep the focused field (and sticky footers) above the on-screen keyboard.
  useEffect(() => installKeyboardAvoidance(), [])

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('bootstrap.loading')}
        </div>
      </div>
    )
  }
  return <>{children}</>
}

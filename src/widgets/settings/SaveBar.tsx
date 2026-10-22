import { useEffect, useRef } from 'react'
import { Loader2, Save, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { publishStickyFooter } from '@/shared/lib/keyboardInset'
import { useTranslation } from '@/i18n'

/**
 * The settings save bar: stuck to the bottom of the viewport while there are
 * unsaved changes, gone otherwise. Only the AI-service sections go through
 * it; the instant sections apply on their own. While shown it publishes its
 * height (`--sticky-footer`), so a field revealed above the on-screen
 * keyboard also clears the bar.
 */
export function SaveBar({
  visible,
  saving,
  onSave,
  onDiscard,
}: {
  visible: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const shown = visible || saving
  useEffect(() => {
    if (!shown || !ref.current) return
    return publishStickyFooter(ref.current)
  }, [shown])
  if (!shown) return null
  return (
    <div
      ref={ref}
      data-sticky-footer
      role="region"
      aria-label={t('settings.unsaved')}
      className={cn(
        // Lifts above the iPad keyboard (`--keyboard-inset`, 0 elsewhere).
        'sticky bottom-[var(--keyboard-inset,0px)] z-30 -mx-4 -mb-6 mt-6 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
        'lab:border-border',
      )}
    >
      <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-3">
        <p role="status" className="min-w-0 flex-1 text-sm font-medium">
          {t('settings.unsaved')}
        </p>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>
          <Undo2 className="h-4 w-4" />
          {t('settings.discard')}
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t('settings.saving') : t('settings.saveChanges')}
        </Button>
      </div>
    </div>
  )
}

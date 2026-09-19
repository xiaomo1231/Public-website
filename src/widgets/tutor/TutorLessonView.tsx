import { useState, type ReactNode } from 'react'
import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { RichText } from '@/shared/ui/RichText'
import { stripDuplicateTitle } from '@/shared/lib/lessonDocument'
import { useTranslation } from '@/i18n'
import type { UseTutorLessonState } from '@/features/tutor/useTutorLesson'

export interface TutorLessonViewProps {
  topicName: string
  topicDescription?: string
  state: UseTutorLessonState
  /** Rendered after the lesson body — used for the practice call to action. */
  footer?: ReactNode
}

/**
 * The Topic page's teaching material.
 *
 * Reading surface only: no question is ever asked here. Practice lives in the
 * Interactive Tutor, which the footer links to.
 */
export function TutorLessonView({
  topicName,
  topicDescription,
  state,
  footer,
}: TutorLessonViewProps): JSX.Element {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[46rem]">
        <LoadingState
          label={state.lesson ? t('tutor.loadingSaved') : t('tutor.generatingLesson')}
        />
      </div>
    )
  }

  if (state.status === 'error' || !state.lesson) {
    return (
      <div className="mx-auto w-full max-w-[46rem]">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <p className="min-w-0 break-words text-sm text-destructive">
                {state.error ?? t('tutor.lessonFailed')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void state.regenerate()}>
              <RefreshCw />
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { lesson } = state

  return (
    <div className="mx-auto w-full max-w-[46rem]">
      <article className="space-y-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="min-w-0 text-[32px] font-semibold leading-tight tracking-tight text-foreground">
              {topicName}
            </h1>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden />
              {t('tutor.savedLocally')}
            </span>
          </div>
          {topicDescription ? (
            <p className="min-w-0 break-words text-sm text-muted-foreground">{topicDescription}</p>
          ) : null}
        </header>

        {state.refreshError && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-50/50 px-3 py-2.5 text-xs dark:bg-amber-950/20">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {t('tutor.lessonRefreshFailed')}
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300/90">{t('tutor.showingSaved')}</p>
          </div>
        )}

        {/* The lesson is the visual subject: constrained measure, generous leading. */}
        <RichText
          text={stripDuplicateTitle(lesson.content, topicName)}
          format="markdown"
          paragraphClassName="text-[16.5px] leading-[1.8]"
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setConfirmOpen(true)}
            disabled={state.regenerating}
          >
            {state.regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {state.regenerating ? t('tutor.regenerating') : t('tutor.regenerate')}
          </Button>
        </div>

        {footer}
      </article>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('tutor.regenerateTitle')}
        description={t('tutor.regenerateBody')}
        confirmLabel={t('tutor.regenerate')}
        busy={state.regenerating}
        onConfirm={async () => {
          setConfirmOpen(false)
          await state.regenerate()
        }}
      />
    </div>
  )
}

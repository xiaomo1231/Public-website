import { useState, type CSSProperties, type ReactNode } from 'react'
import { AlertCircle, HardDrive, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { RichText } from '@/shared/ui/RichText'
import { VisualSourceFigure } from '@/widgets/source/VisualSourceFigure'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { ReferenceImageGallery } from '@/widgets/tutor/ReferenceImageGallery'
import { useReferenceImages } from '@/features/tutor/useReferenceImages'
import { LessonFigureContext } from '@/features/tutor/lessonFigureContext'
import { stripDuplicateTitle, parseLessonSections } from '@/shared/lib/lessonDocument'
import { anchorVisualizations } from '@/entities/tutorVisualization/placement'
import { useTranslation } from '@/i18n'
import {
  LESSON_PARAGRAPH_CLASS,
  LESSON_PROSE_CLASS,
  estimateReadingMinutes,
  lessonNumberVar,
} from '@/widgets/tutor/lessonStyle'
import type { UseTutorLessonState } from '@/features/tutor/useTutorLesson'

export interface TutorLessonViewProps {
  topicName: string
  topicDescription?: string
  state: UseTutorLessonState
  /**
   * Where the topic sits (chapter · section), shown as the small kicker above
   * the title in the lecture style.
   */
  kicker?: string
  /**
   * The topic's number (textbook section number or its position). The lab
   * style shows it as `§ n` and prefixes the numbered section headings.
   */
  number?: string
  /** Rendered after the lesson body — used for the practice call to action. */
  footer?: ReactNode
}

/**
 * The Topic page's teaching material.
 *
 * Reading surface only: no question is ever asked here. Practice lives in the
 * Interactive Tutor, which the footer links to.
 */
/** Lecture: a ~680px reading measure. Lab: fills the panel's document cell. */
const COLUMN_CLASS = 'mx-auto w-full max-w-[46rem] lecture:max-w-[680px] lab:mx-0 lab:max-w-[54rem]'

export function TutorLessonView({
  topicName,
  topicDescription,
  state,
  kicker,
  number,
  footer,
}: TutorLessonViewProps): JSX.Element {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const referenceImages = useReferenceImages(state.lesson, {
    name: topicName,
    description: topicDescription,
  })

  if (state.status === 'loading') {
    return (
      <div className={COLUMN_CLASS}>
        <LoadingState
          label={state.lesson ? t('tutor.loadingSaved') : t('tutor.generatingLesson')}
        />
        <GenerationControls
          kind="single"
          state={state.generation}
          onStopNow={state.stop}
          hideStatus
          className="justify-center"
        />
      </div>
    )
  }

  if (state.stopped && !state.lesson) {
    return (
      <div className={COLUMN_CLASS}>
        <Card>
          <CardContent className="space-y-4 p-5">
            <p role="status" className="text-sm text-muted-foreground">
              {t('generation.stoppedKept')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void state.regenerate()}
              disabled={state.regenerating}
            >
              {state.regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('common.generate')}
            </Button>
            {state.regenerating && (
              <GenerationControls kind="single" state={state.generation} onStopNow={state.stop} />
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (state.status === 'error' || !state.lesson) {
    return (
      <div className={COLUMN_CLASS}>
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
  const lessonContent = stripDuplicateTitle(lesson.content, topicName)
  const readingMinutes = estimateReadingMinutes(lessonContent)
  const numberStyle = { '--lesson-num': lessonNumberVar(number) } as CSSProperties
  // Place each figure next to the teaching block it illustrates; anything
  // without a resolvable anchor stays in the trailing section.
  const { bySection, trailing } = anchorVisualizations(
    lesson.visualizations,
    parseLessonSections(lessonContent),
  )

  return (
    <LessonFigureContext.Provider value={{ projectId: lesson.projectId, topicId: lesson.topicId }}>
      <div className={COLUMN_CLASS}>
        <article className="space-y-5" style={numberStyle}>
          <header className="space-y-2 lecture:space-y-3 lecture:border-b lecture:pb-6 lab:space-y-1.5 lab:border-b lab:border-dashed lab:pb-4">
            {(kicker || number) && (
              <p className="text-xs text-muted-foreground lecture:text-[13px] lecture:tracking-[0.14em] lecture:text-primary lab:font-mono lab:tracking-[0.04em] lab:text-primary">
                {number ? <span className="hidden tabular-nums lab:inline">§ {number}</span> : null}
                {number && kicker ? (
                  <span aria-hidden className="hidden lab:inline">
                    {' '}
                    ·{' '}
                  </span>
                ) : null}
                {kicker ? <span>{kicker}</span> : null}
              </p>
            )}
            <h1 className="min-w-0 font-heading text-[32px] font-semibold leading-tight tracking-tight text-foreground lecture:text-[34px] lecture:font-bold lecture:leading-[1.35] lecture:tracking-normal lab:text-[26px] lab:leading-[1.3]">
              {topicName}
            </h1>
            {topicDescription ? (
              <p className="min-w-0 break-words text-sm text-muted-foreground lecture:text-[15px] lecture:leading-[1.75]">
                {topicDescription}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground lecture:gap-x-2 lecture:text-[13.5px] lab:gap-x-3.5 lab:font-mono lab:text-[11.5px]">
              <span className="tabular-nums">
                {t('tutor.readingTime', { count: readingMinutes })}
              </span>
              <span aria-hidden className="hidden lecture:inline">
                ·
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 lecture:gap-0 lecture:[&_svg]:hidden">
                <HardDrive className="h-3 w-3" aria-hidden />
                {t('tutor.savedLocally')}
              </span>
            </p>
          </header>

          {state.refreshError && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-50/50 px-3 py-2.5 text-xs dark:bg-amber-950/20">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {t('tutor.lessonRefreshFailed')}
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300/90">
                {t('tutor.showingSaved')}
              </p>
            </div>
          )}

          {/* The lesson is the visual subject: constrained measure, generous leading. */}
          <RichText
            text={lessonContent}
            format="markdown"
            className={LESSON_PROSE_CLASS}
            paragraphClassName={LESSON_PARAGRAPH_CLASS}
            renderAfterSection={(_section, index) => {
              const list = bySection.get(index)
              if (!list || list.length === 0) return null
              return (
                <div className="space-y-3">
                  {list.map((visualization) => (
                    <TutorVisualizationFigure
                      key={visualization.id}
                      visualization={visualization}
                    />
                  ))}
                </div>
              )
            }}
          />

          {/* Figures preserved from the course material come first: they are the
            primary source, ahead of anything drawn or found for the lesson. */}
          {lesson.visuals && lesson.visuals.length > 0 && (
            <section className="space-y-2" aria-label={t('tutor.visualSources')}>
              <h2 className="font-heading text-[22px] font-semibold leading-snug tracking-tight text-foreground lecture:font-bold lab:text-[17px]">
                {t('tutor.visualSources')}
              </h2>
              {lesson.visuals.map((visual) => (
                <VisualSourceFigure key={visual.id} visual={visual} />
              ))}
            </section>
          )}

          {/* Lesson-level figures, or figures whose anchor did not resolve. */}
          {trailing.length > 0 && (
            <section className="space-y-3" aria-label={t('tutor.visualizations')}>
              <h2 className="font-heading text-[22px] font-semibold leading-snug tracking-tight text-foreground lecture:font-bold lab:text-[17px]">
                {t('tutor.visualizations')}
              </h2>
              {trailing.map((visualization) => (
                <TutorVisualizationFigure key={visualization.id} visualization={visualization} />
              ))}
            </section>
          )}

          {/* Opt-in web reference pictures (chemistry / biology). */}
          <ReferenceImageGallery
            state={referenceImages}
            hasCourseFigures={Boolean(lesson.visuals?.some((visual) => visual.hasImage))}
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
            {state.regenerating && (
              <GenerationControls kind="single" state={state.generation} onStopNow={state.stop} />
            )}
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
    </LessonFigureContext.Provider>
  )
}

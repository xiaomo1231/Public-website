import { useState } from 'react'
import { BookOpenText, ListChecks, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import type { HomeworkQuestion } from '@/entities/homework/types'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import {
  LINEAR_ALGEBRA_METHODS,
  suggestLinearAlgebraMethod,
  type LinearAlgebraMethod,
} from '@/entities/homework/linearAlgebraGuide'
import { summarizeProgress, type GuidedProgress } from '@/entities/homework/guided'
import type { GuidedStepsService } from '@/services/guidedStepsService'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { LoadingState } from '@/shared/ui/LoadingState'
import { RichText } from '@/shared/ui/RichText'
import { useTranslation, type TranslationKey } from '@/i18n'
import { useProject } from '@/features/project/useProjects'
import { targetLanguageOf } from '@/shared/lib/language'
import { GuidedMatrixPractice } from './GuidedMatrixPractice'
import { GuidedBlankPractice } from './GuidedBlankPractice'
import { useGuidedQuestion } from './useGuidedQuestion'

export interface GuidedPracticeViewProps {
  setId: string
  question: HomeworkQuestion
  /** Open the assignment's complete walkthrough (where the steps come from). */
  onOpenWalkthrough: () => void
  /** For tests. */
  service?: GuidedStepsService
}

/**
 * 引导练习 for one question: the walkthrough's steps, worked one at a time and
 * checked locally. The question is rendered with a `key`, so switching
 * questions remounts this view (pending progress is saved on the way out).
 */
export function GuidedPracticeView({
  setId,
  question,
  onOpenWalkthrough,
  service,
}: GuidedPracticeViewProps): JSX.Element {
  const { t } = useTranslation()
  const guided = useGuidedQuestion(setId, question.id, service)
  // A language course's letters go on its written blanks.
  const language = targetLanguageOf(useProject(question.projectId).project)
  const { state, progress, update } = guided
  const summary = summarizeProgress(progress ?? undefined)
  const preparingActive = guided.preparing.active

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <Card data-selection-context="homework" data-selection-title={question.number ?? ''}>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground lecture:tracking-[0.14em] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
                {t('guided.title')}
              </span>
              {question.number && (
                <Badge variant="outline" className="lab:font-mono">
                  {question.number}
                </Badge>
              )}
            </div>
            <RichText
              text={formatHomeworkQuestion(question.prompt)}
              format="markdown"
              className="max-w-[74ch] [&>p]:mb-3"
              paragraphClassName="text-[16px] leading-[1.75]"
            />
          </CardHeader>
        </Card>
        <MethodCue prompt={question.prompt} />
      </div>

      <div className="min-w-0 space-y-4">
        {guided.loading && !state ? (
          <LoadingState label={t('common.loading')} />
        ) : !state ? (
          <Card>
            <CardContent className="p-4 text-sm text-destructive" role="alert">
              {guided.error ?? t('guided.errors.load')}
            </CardContent>
          </Card>
        ) : state.source.kind === 'no-walkthrough' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base lecture:font-heading lecture:font-bold">
                {t('guided.noWalkthroughTitle')}
              </CardTitle>
              <CardDescription>{t('guided.noWalkthroughHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" className="h-11" onClick={onOpenWalkthrough}>
                <BookOpenText className="h-4 w-4" aria-hidden />
                {t('guided.openWalkthrough')}
              </Button>
            </CardContent>
          </Card>
        ) : state.source.kind === 'needs-steps' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base lecture:font-heading lecture:font-bold">
                {t('guided.prepareTitle')}
              </CardTitle>
              <CardDescription>{t('guided.prepareHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="h-11"
                  onClick={() => void guided.prepare()}
                  disabled={!state.hasAI || preparingActive}
                >
                  {preparingActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden />
                  )}
                  {preparingActive ? t('guided.preparing') : t('guided.prepare')}
                </Button>
                <GenerationControls
                  kind="single"
                  state={guided.preparing.state}
                  stopRequested={guided.preparing.run?.stopRequested ?? false}
                  onStopNow={guided.preparing.stopNow}
                />
              </div>
              {!state.hasAI && <p className="text-sm text-muted-foreground">{t('guided.noAI')}</p>}
              {guided.error && (
                <p role="alert" className="text-sm text-destructive">
                  {guided.error}
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base lecture:font-heading lecture:font-bold">
                  <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t('guided.title')}
                </CardTitle>
                <Badge variant="outline">
                  {t(state.level === 'detailed' ? 'guided.fromDetailed' : 'guided.fromStandard')}
                </Badge>
              </div>
              <CardDescription>
                {t(state.source.kind === 'matrix' ? 'guided.introMatrix' : 'guided.introBlanks')}
              </CardDescription>
              {state.source.kind === 'blanks' && state.source.droppedBlanks > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('guided.droppedBlanks', { count: state.source.droppedBlanks })}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              {progress && state.source.kind === 'matrix' && (
                <GuidedMatrixPractice
                  chains={state.source.chains}
                  progress={progress.chains ?? []}
                  onChange={(index, next) =>
                    update((current) =>
                      withCompletion({
                        ...current,
                        chains: (current.chains ?? []).map((item, i) =>
                          i === index ? next : item,
                        ),
                      }),
                    )
                  }
                />
              )}
              {progress && state.source.kind === 'blanks' && (
                <GuidedBlankPractice
                  steps={state.source.steps}
                  progress={progress.steps ?? []}
                  {...(state.subject ? { subject: state.subject } : {})}
                  {...(language ? { language } : {})}
                  onChange={(index, next) =>
                    update((current) =>
                      withCompletion({
                        ...current,
                        steps: (current.steps ?? []).map((item, i) => (i === index ? next : item)),
                      }),
                    )
                  }
                />
              )}
              {summary.complete && <GuidedSummaryCard summary={summary} />}
              {summary.stepsDone + summary.hintsViewed + summary.answersViewed > 0 && (
                <RestartButton onRestart={() => void guided.restart()} />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function withCompletion(progress: GuidedProgress): GuidedProgress {
  const complete = summarizeProgress(progress).complete
  if (complete && !progress.completedAt) return { ...progress, completedAt: Date.now() }
  if (!complete && progress.completedAt) {
    const { completedAt: _dropped, ...rest } = progress
    return rest
  }
  return progress
}

function GuidedSummaryCard({
  summary,
}: {
  summary: ReturnType<typeof summarizeProgress>
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      aria-label={t('guided.summaryTitle')}
      className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 lab:rounded-sm"
      data-guided-summary
    >
      <h4 className="font-heading text-[15px] font-semibold text-foreground">
        {t('guided.summaryTitle')}
      </h4>
      <ul className="grid gap-1 text-sm text-foreground sm:grid-cols-3">
        <li>{t('guided.summarySteps', { count: summary.stepsDone })}</li>
        <li>{t('guided.summaryHints', { count: summary.hintsViewed })}</li>
        <li>{t('guided.summaryAnswers', { count: summary.answersViewed })}</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        {t(
          summary.answersViewed > 0
            ? 'guided.summaryRetry'
            : summary.hintsViewed > 0
              ? 'guided.summaryWithHints'
              : 'guided.summaryOnOwn',
        )}
      </p>
    </section>
  )
}

function RestartButton({ onRestart }: { onRestart: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  return confirming ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t('guided.restartConfirm')}</span>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => {
          setConfirming(false)
          onRestart()
        }}
      >
        {t('guided.restart')}
      </Button>
      <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirming(false)}>
        {t('common.cancel')}
      </Button>
    </div>
  ) : (
    <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirming(true)}>
      <RotateCcw className="h-4 w-4" aria-hidden />
      {t('guided.restart')}
    </Button>
  )
}

/**
 * Linear algebra: where to start (the method cues and templates of the former
 * six-step study guide). Local text only, no AI; the student chooses.
 */
function MethodCue({ prompt }: { prompt: string }): JSX.Element | null {
  const { t } = useTranslation()
  const suggested = suggestLinearAlgebraMethod(prompt)
  const [method, setMethod] = useState<LinearAlgebraMethod | null>(null)
  if (!suggested) return null
  return (
    <details className="rounded-xl border border-border/70 bg-muted/20 p-3 lab:rounded-sm">
      <summary className="cursor-pointer rounded-lg py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t('guided.methodTitle')}
      </summary>
      <div className="space-y-3 pt-2">
        <p className="text-xs text-muted-foreground">{t('homework.guide.methodCaution')}</p>
        <div
          role="group"
          aria-label={t('homework.guide.chooseMethod')}
          className="flex flex-wrap gap-2"
        >
          {LINEAR_ALGEBRA_METHODS.map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              className="min-h-11"
              variant={method === item ? 'default' : 'outline'}
              aria-pressed={method === item}
              onClick={() => setMethod(item)}
            >
              {t(`homework.guide.method.${item}` as TranslationKey)}
              {item === suggested ? ` · ${t('homework.guide.suggested')}` : ''}
            </Button>
          ))}
        </div>
        {method && (
          <RichText
            text={t(`homework.guide.template.${method}` as TranslationKey)}
            format="markdown"
            paragraphClassName="text-sm leading-relaxed"
          />
        )}
      </div>
    </details>
  )
}

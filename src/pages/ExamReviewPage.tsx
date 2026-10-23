import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  ListChecks,
  NotebookText,
  Printer,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Button } from '@/shared/ui/Button'
import { Progress } from '@/shared/ui/Progress'
import { RichText } from '@/shared/ui/RichText'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn, formatDateTime } from '@/shared/lib/utils'
import { useExamTools } from '@/features/studyPlan/useExamTools'
import { useProject } from '@/features/project/useProjects'
import { WalkthroughPrint } from '@/widgets/homework/walkthrough/WalkthroughPrint'
import {
  reviewSectionMarkdown,
  type ReviewClaim,
  type ReviewSection,
} from '@/entities/studyPlan/review'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { useTranslation } from '@/i18n'

/**
 * 复习提纲 of one exam: plan the topics, see the estimate, check the
 * connection and generate (pause / stop / continue, retry a failed topic);
 * read each topic with its sources, print or save as PDF. Selecting text
 * offers 解释 / 提问 like the homework pages.
 */
export function ExamReviewPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId = '', examId = '' } = useParams<{ id: string; examId: string }>()
  const { project } = useProject(projectId)
  const { review: service, hasAI, loaded: toolsLoaded } = useExamTools()
  const [exam, setExam] = useState<PlannedExam | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const generation = useGenerationRun()
  const location = useLocation()

  const load = useCallback(async () => {
    try {
      const row = (await service.recoverInterrupted(examId)) ?? null
      if (!row || row.projectId !== projectId) {
        setMissing(true)
        return
      }
      setExam(row)
    } catch (err) {
      setError(friendlyAIError(err))
    }
  }, [service, examId, projectId])

  useEffect(() => {
    void load()
  }, [load])

  // A plan task links to `#<sectionId>`: scroll to that topic once it is shown.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id || !exam) return
    document.getElementById(`review-${id}`)?.scrollIntoView({ block: 'start' })
  }, [location.hash, exam])

  const sections = exam?.review?.sections ?? []
  const done = sections.filter((s) => s.status === 'done').length
  const failed = sections.filter((s) => s.status === 'failed').length
  const running = generation.state === 'running' || generation.state === 'pausing'
  const estimate = useMemo(() => (exam ? service.estimate(exam) : null), [exam, service])

  async function plan(replace = false) {
    setError(null)
    try {
      setExam(await service.plan(examId, { replace }))
    } catch (err) {
      setError(friendlyAIError(err))
    }
  }

  async function generate(extra: { sectionIds?: string[]; retryFailed?: boolean } = {}) {
    setError(null)
    setStopRequested(false)
    const run = generation.start()
    try {
      setExam(
        await service.generate(examId, {
          control: run,
          onProgress: setExam,
          ...extra,
        }),
      )
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      run.finish()
      await load()
    }
  }

  const labels = {
    summary: t('plan.review.summary'),
    keyPoints: t('plan.review.keyPoints'),
    questionTypes: t('plan.review.questionTypes'),
    mistakes: t('plan.review.mistakes'),
    formula: t('plan.review.formula'),
    definition: t('plan.review.definition'),
    sources: t('plan.review.sources'),
  }

  if (missing)
    return (
      <PageContainer>
        <PageContent>
          <ErrorState description={t('plan.review.errors.examMissing')} />
        </PageContent>
      </PageContainer>
    )

  return (
    <PageContainer>
      <PageHeader
        icon={<NotebookText className="h-5 w-5" />}
        title={exam ? t('plan.review.title', { exam: exam.name }) : t('plan.review.titleShort')}
        description={
          exam
            ? `${project?.name ?? ''} · ${formatDateTime(exam.at)}`
            : t('plan.review.description')
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild size="sm" variant="ghost">
              <Link to="/plan?tab=exams">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t('plan.review.back')}
              </Link>
            </Button>
            {done > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPrinting(true)}>
                <Printer className="h-4 w-4" aria-hidden />
                {t('plan.review.print')}
              </Button>
            )}
          </div>
        }
      />
      <PageContent>
        {!exam && !error && <LoadingState label={t('common.loading')} />}
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive lab:rounded-none"
          >
            {error}
          </p>
        )}
        {exam && sections.length === 0 && (
          <div className="max-w-2xl space-y-3" data-review-empty>
            <p className="text-sm text-muted-foreground">{t('plan.review.intro')}</p>
            <Button onClick={() => void plan()}>
              <ListChecks className="h-4 w-4" aria-hidden />
              {t('plan.review.plan')}
            </Button>
          </div>
        )}
        {exam && sections.length > 0 && (
          <div className="space-y-6">
            <div
              className="space-y-3 rounded-md border p-4 lab:rounded-none print:hidden"
              data-review-progress
            >
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm font-medium tabular-nums">
                  {t('plan.review.progress', { done, total: sections.length, failed })}
                </p>
                <GenerationControls
                  kind="parts"
                  state={generation.state}
                  done={done}
                  total={sections.length}
                  stopRequested={stopRequested}
                  onPause={generation.requestPause}
                  onStopNow={() => {
                    setStopRequested(true)
                    generation.stopNow()
                  }}
                  onResume={() => void generate()}
                />
              </div>
              <Progress
                value={(done / sections.length) * 100}
                aria-label={t('plan.review.progressAria')}
              />
              {exam.review?.scopeChangedAt !== undefined && (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/60 px-3 py-2 text-sm text-amber-800 lab:rounded-none dark:text-amber-300"
                  data-review-outdated
                >
                  <p className="flex-1">{t('plan.review.scopeChanged')}</p>
                  {!running && (
                    <Button size="sm" variant="outline" onClick={() => void plan(true)}>
                      {t('plan.review.scopeChangedAction')}
                    </Button>
                  )}
                </div>
              )}
              {!running && done < sections.length && (
                <div className="space-y-2">
                  {estimate && estimate.requests > 0 && (
                    <p className="text-xs tabular-nums text-muted-foreground" data-review-estimate>
                      {t('plan.review.estimate', {
                        requests: estimate.requests,
                        input: Math.round(estimate.inputTokens / 1000),
                        output: Math.round(estimate.outputTokens / 1000),
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!hasAI || !toolsLoaded}
                      onClick={() => void generate()}
                      data-review-generate
                    >
                      {done > 0 || failed > 0
                        ? t('plan.review.continue')
                        : t('plan.review.generate')}
                    </Button>
                    {failed > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!hasAI}
                        onClick={() => void generate({ retryFailed: true })}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden />
                        {t('plan.review.retryFailed', { count: failed })}
                      </Button>
                    )}
                  </div>
                  {!hasAI && toolsLoaded && (
                    <p className="text-xs text-muted-foreground">{t('plan.review.needsAI')}</p>
                  )}
                </div>
              )}
              {!running && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void plan(true)}>
                    {t('plan.review.replan')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t('plan.review.remove')}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t('plan.review.note')}</p>
            </div>

            <nav aria-label={t('plan.review.toc')} className="print:hidden">
              <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {sections.map((section, i) => (
                  <li key={section.id}>
                    <a
                      className="focus-ring rounded-sm hover:text-primary"
                      href={`#review-${section.id}`}
                    >
                      {i + 1}. {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="space-y-8">
              {sections.map((section, i) => (
                <ReviewTopic
                  key={section.id}
                  index={i}
                  section={section}
                  projectId={projectId}
                  running={running}
                  hasAI={hasAI}
                  onRetry={() => void generate({ sectionIds: [section.id] })}
                />
              ))}
            </div>
          </div>
        )}
      </PageContent>

      {printing && exam && (
        <WalkthroughPrint
          title={t('plan.review.title', { exam: exam.name })}
          sections={sections
            .filter((section) => section.status === 'done')
            .map((section) => ({
              id: section.id,
              title: section.title,
              body: reviewSectionMarkdown(section, labels),
            }))}
          onDone={() => setPrinting(false)}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('plan.review.removeTitle')}
        description={t('plan.review.removeHint')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={async () => {
          try {
            await service.remove(examId)
            setRemoving(false)
            await load()
          } catch (err) {
            setError(friendlyAIError(err))
          }
        }}
      />
    </PageContainer>
  )
}

function Sources({
  claim,
  section,
  projectId,
}: {
  claim: ReviewClaim
  section: ReviewSection
  projectId: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const places = claim.sources
    .map((id) => section.citations?.[id])
    .filter((c): c is NonNullable<typeof c> => !!c)
  if (places.length === 0) return null
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">
      {places.map((place) => (
        <Link
          key={place.chunkId}
          to={`/projects/${projectId}/documents/${place.documentId}${place.page ? `?page=${place.page}` : ''}`}
          className="focus-ring rounded-sm border px-1 text-[11px] text-muted-foreground hover:text-primary lab:rounded-none lab:font-mono"
          aria-label={t('plan.review.sourceAria', {
            name: place.documentName,
            page: place.page ?? '',
          })}
          data-review-source
        >
          {place.documentName}
          {place.page ? ` p. ${place.page}` : ''}
        </Link>
      ))}
    </span>
  )
}

function ReviewTopic({
  index,
  section,
  projectId,
  running,
  hasAI,
  onRetry,
}: {
  index: number
  section: ReviewSection
  projectId: string
  running: boolean
  hasAI: boolean
  onRetry: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const courseTopic =
    section.topicId && !section.topicId.startsWith('exam:') ? section.topicId : undefined
  return (
    <article
      id={`review-${section.id}`}
      className={cn(
        'scroll-mt-24 space-y-3',
        'lecture:border-t-[1.5px] lecture:border-foreground lecture:pt-4',
        'lab:border lab:border-border lab:bg-card lab:p-4',
      )}
      data-selection-context="homework"
      data-selection-title={section.title}
      data-review-section={section.id}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-semibold lecture:text-[20px] lab:text-[15px]">
          <span className="tabular-nums text-muted-foreground lab:font-mono">{index + 1}. </span>
          {section.title}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {section.mastery !== null
            ? t('plan.review.mastery', { percent: Math.round(section.mastery * 100) })
            : t('plan.review.noPractice')}
        </span>
        <span className="flex flex-wrap gap-2 print:hidden">
          {courseTopic && (
            <Link
              to={`/projects/${projectId}/tutor/${courseTopic}`}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline coarse:py-2"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {t('plan.review.lesson')}
            </Link>
          )}
          <Link
            to={
              courseTopic
                ? `/projects/${projectId}/quiz?topic=${encodeURIComponent(courseTopic)}`
                : `/projects/${projectId}/quiz`
            }
            className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline coarse:py-2"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            {t('plan.review.practice')}
          </Link>
        </span>
      </header>

      {section.status !== 'done' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground print:hidden">
          <span>
            {section.status === 'generating'
              ? t('plan.review.status.generating')
              : section.status === 'failed'
                ? t('plan.review.status.failed', { reason: section.error ?? '' })
                : t('plan.review.status.pending')}
          </span>
          {section.status === 'failed' && !running && (
            <Button size="sm" variant="outline" disabled={!hasAI} onClick={onRetry}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('plan.review.retry')}
            </Button>
          )}
        </div>
      )}

      {section.status === 'done' && (
        <div className="max-w-[70ch] space-y-4">
          {!!section.summary?.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('plan.review.summary')}</h3>
              {section.summary.map((claim, i) => (
                <div key={i} className="text-[15px] leading-relaxed">
                  <RichText
                    text={claim.text}
                    paragraphClassName="text-[15px] leading-relaxed inline"
                  />
                  <Sources claim={claim} section={section} projectId={projectId} />
                </div>
              ))}
            </div>
          )}
          {!!section.keyPoints?.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('plan.review.keyPoints')}</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                {section.keyPoints.map((point, i) => (
                  <li key={i} className="text-[15px]">
                    {point.kind !== 'fact' && (
                      <span className="mr-1 text-xs text-muted-foreground">
                        {t(
                          point.kind === 'formula'
                            ? 'plan.review.formula'
                            : 'plan.review.definition',
                        )}
                      </span>
                    )}
                    <RichText text={point.text} paragraphClassName="text-[15px] leading-relaxed" />
                    <Sources claim={point} section={section} projectId={projectId} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!section.questionTypes?.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('plan.review.questionTypes')}</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                {section.questionTypes.map((item, i) => (
                  <li key={i} className="text-[15px]">
                    <RichText text={item.text} paragraphClassName="text-[15px] leading-relaxed" />
                    <Sources claim={item} section={section} projectId={projectId} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!section.mistakes?.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('plan.review.mistakes')}</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                {section.mistakes.map((item, i) => (
                  <li key={i} className="text-[15px]">
                    <RichText text={item.text} paragraphClassName="text-[15px] leading-relaxed" />
                  </li>
                ))}
              </ul>
              <Link
                to={`/projects/${projectId}/mistakes`}
                className="focus-ring inline-block rounded-sm text-xs text-primary hover:underline print:hidden"
              >
                {t('plan.review.openMistakes')}
              </Link>
            </div>
          )}
          {!!section.dropped && (
            <p className="text-xs text-muted-foreground">
              {t('plan.review.droppedClaims', { count: section.dropped })}
            </p>
          )}
        </div>
      )}
    </article>
  )
}

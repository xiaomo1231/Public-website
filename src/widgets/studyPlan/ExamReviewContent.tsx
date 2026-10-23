import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BookOpen, ListChecks, Printer, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Progress } from '@/shared/ui/Progress'
import { RichText } from '@/shared/ui/RichText'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useExamTools } from '@/features/studyPlan/useExamTools'
import { withExamReturn } from '@/features/studyPlan/examReturn'
import { WalkthroughPrint } from '@/widgets/homework/walkthrough/WalkthroughPrint'
import {
  questionRefLabel,
  reviewSectionMarkdown,
  type ReviewClaim,
  type ReviewOverview,
  type ReviewQuestionRef,
  type ReviewSection,
} from '@/entities/studyPlan/review'
import type { PlannedExam } from '@/entities/studyPlan/types'
import type { ReviewSourceOption } from '@/services/examReviewService'
import { useTranslation, type TranslationKey } from '@/i18n'
import { ReviewSourcePicker } from './ReviewSourcePicker'

export interface ExamReviewContentProps {
  projectId: string
  examId: string
  /** Told whenever the exam row is (re)read, e.g. for the page title. */
  onExam?: (exam: PlannedExam | null) => void
  /**
   * Shown inside the 考试工作台: links to lessons / quizzes return to the
   * workspace (`?fromExam=`).
   */
  embedded?: boolean
}

/**
 * 复习提纲 of one exam: plan the topics, see the estimate, check the
 * connection and generate (pause / stop / continue, retry a failed topic);
 * read each topic with its sources, print or save as PDF. Selecting text
 * offers 解释 / 提问 like the homework pages. Used by the 复习提纲 page and
 * the 考试工作台's 复习提纲 tab.
 */
export function ExamReviewContent({
  projectId,
  examId,
  onExam,
  embedded = false,
}: ExamReviewContentProps): JSX.Element {
  const { t } = useTranslation()
  const { review: service, hasAI, loaded: toolsLoaded } = useExamTools()
  const [exam, setExam] = useState<PlannedExam | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const generation = useGenerationRun()
  const location = useLocation()
  const [sources, setSources] = useState<{
    options: ReviewSourceOption[]
    selected: string[]
  } | null>(null)
  const [planning, setPlanning] = useState(false)
  const planRun = useRef<GenerationRun | null>(null)

  useEffect(() => {
    onExam?.(exam)
  }, [exam, onExam])

  const load = useCallback(async () => {
    try {
      const row = (await service.recoverInterrupted(examId)) ?? null
      if (!row || row.projectId !== projectId) {
        setMissing(true)
        return
      }
      setExam(row)
      const choice = await service.sourceOptions(examId)
      setSources({ options: choice.options, selected: choice.selected })
    } catch (err) {
      setError(friendlyAIError(err))
    }
  }, [service, examId, projectId])

  useEffect(() => () => planRun.current?.stopNow(), [])

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
  const running = generation.state === 'running' || generation.state === 'pausing' || planning
  const estimate = useMemo(() => (exam ? service.estimate(exam) : null), [exam, service])
  const linkFrom = embedded ? examId : null

  async function plan(replace = false) {
    setError(null)
    const run = createGenerationRun()
    planRun.current = run
    setPlanning(true)
    try {
      setExam(await service.plan(examId, { replace, useAI: hasAI, control: run }))
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      run.finish()
      planRun.current = null
      setPlanning(false)
    }
  }

  async function chooseSources(next: string[]) {
    setError(null)
    setSources((current) => (current ? { ...current, selected: next } : current))
    try {
      setExam(await service.setSources(examId, next))
    } catch (err) {
      setError(friendlyAIError(err))
      await load()
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
    examQuestions: t('plan.review.examQuestions'),
    marking: t('plan.review.marking'),
  }
  const overview = exam?.review?.overview
  const picker = sources && (
    <ReviewSourcePicker
      options={sources.options}
      selected={sources.selected}
      disabled={running}
      onChange={(next) => void chooseSources(next)}
    />
  )
  const planningNote = planning && (
    <div
      className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      role="status"
      data-review-planning
    >
      <span className="flex-1">{t('plan.review.planning')}</span>
      <Button size="sm" variant="outline" onClick={() => planRun.current?.stopNow()}>
        {t('plan.review.stopPlanning')}
      </Button>
    </div>
  )

  if (missing) return <ErrorState description={t('plan.review.errors.examMissing')} />

  return (
    <div data-review-content>
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
        <div className="max-w-2xl space-y-4" data-review-empty>
          <p className="text-sm text-muted-foreground">{t('plan.review.intro')}</p>
          {picker && (
            <section className="space-y-2 rounded-md border p-4 lab:rounded-none">
              <h2 className="text-sm font-semibold">{t('plan.review.sources.title')}</h2>
              {picker}
            </section>
          )}
          {planningNote}
          <Button
            onClick={() => void plan()}
            disabled={planning || (!!sources && sources.selected.length === 0)}
            data-review-plan
          >
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
              {done > 0 && (
                <Button size="sm" variant="outline" onClick={() => setPrinting(true)}>
                  <Printer className="h-4 w-4" aria-hidden />
                  {t('plan.review.print')}
                </Button>
              )}
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
                    {done > 0 || failed > 0 ? t('plan.review.continue') : t('plan.review.generate')}
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
            {planningNote}
            {picker && (
              <details className="text-sm" data-review-sources-details>
                <summary className="focus-ring cursor-pointer rounded-sm font-medium coarse:py-2">
                  {t('plan.review.sources.title')}{' '}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {t('plan.review.sources.count', {
                      count: sources!.selected.length,
                      total: sources!.options.length,
                    })}
                  </span>
                </summary>
                <div className="mt-2">{picker}</div>
              </details>
            )}
            {exam.review?.layout && (
              <p className="text-xs text-muted-foreground" data-review-layout>
                {t(
                  exam.review.layout === 'outline'
                    ? 'plan.review.layout.outline'
                    : 'plan.review.layout.local',
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('plan.review.note')}</p>
          </div>

          {overview && <ReviewOverviewPanel overview={overview} />}

          <nav aria-label={t('plan.review.toc')} className="print:hidden">
            <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {sections.map((section, i) => (
                <li key={section.id}>
                  <a
                    className="focus-ring rounded-sm hover:text-primary coarse:inline-block coarse:py-2"
                    href={`#review-${section.id}`}
                    onClick={(event) => {
                      // Inside the workspace the URL keeps its tab: scroll only.
                      if (!embedded) return
                      event.preventDefault()
                      document
                        .getElementById(`review-${section.id}`)
                        ?.scrollIntoView({ block: 'start' })
                    }}
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
                linkFrom={linkFrom}
                onRetry={() => void generate({ sectionIds: [section.id] })}
              />
            ))}
          </div>
        </div>
      )}

      {printing && exam && (
        <WalkthroughPrint
          title={t('plan.review.title', { exam: exam.name })}
          sections={[
            ...(overview
              ? [
                  {
                    id: 'overview',
                    title: t('plan.review.overview.title'),
                    body: overviewMarkdown(overview, t),
                  },
                ]
              : []),
            ...sections
              .filter((section) => section.status === 'done')
              .map((section) => ({
                id: section.id,
                title: section.title,
                body: reviewSectionMarkdown(section, labels),
              })),
          ]}
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
    </div>
  )
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const KIND_KEYS: Record<string, TranslationKey> = {
  multiple_choice: 'examAnalysis.kind.multiple_choice',
  true_false: 'examAnalysis.kind.true_false',
  fill_blank: 'examAnalysis.kind.fill_blank',
  calculation: 'examAnalysis.kind.calculation',
  proof: 'examAnalysis.kind.proof',
  explain: 'examAnalysis.kind.explain',
  other: 'examAnalysis.kind.other',
}

function kindLabel(kind: string, t: Translate): string {
  const key = KIND_KEYS[kind]
  return key ? t(key) : kind
}

/** 考试概览 as Markdown (print / PDF). */
function overviewMarkdown(overview: ReviewOverview, t: Translate): string {
  if (overview.papers === 0) return t('plan.review.overview.none')
  const out = [
    t('plan.review.overview.papers', { papers: overview.papers, questions: overview.questions }),
  ]
  if (overview.questionsWithMarks > 0)
    out.push(
      '',
      t('plan.review.overview.marks', {
        count: overview.questionsWithMarks,
        marks: overview.totalMarks,
      }),
    )
  if (overview.byKind.length > 0) {
    out.push('', `**${t('plan.review.overview.byKind')}**`, '')
    for (const row of overview.byKind)
      out.push(
        `- ${kindLabel(row.kind, t)}: ${t('plan.review.overview.kindRow', { questions: row.questions, marks: row.marks })}`,
      )
  }
  if (overview.topPoints.length > 0) {
    out.push('', `**${t('plan.review.overview.top')}**`, '')
    for (const row of overview.topPoints)
      out.push(
        `- ${row.title}: ${t('plan.review.overview.topRow', { questions: row.questions, marks: row.marks })}`,
      )
  }
  out.push('', `_${t('plan.review.overview.note')}_`)
  return out.join('\n')
}

function ReviewOverviewPanel({ overview }: { overview: ReviewOverview }): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        'space-y-3',
        'lecture:border-t-[1.5px] lecture:border-foreground lecture:pt-4',
        'lab:border lab:border-border lab:bg-card lab:p-4',
      )}
      aria-labelledby="review-overview-title"
      data-review-overview
    >
      <h2
        id="review-overview-title"
        className="font-heading text-lg font-semibold lecture:text-[20px] lab:text-[15px]"
      >
        {t('plan.review.overview.title')}
      </h2>
      {overview.papers === 0 ? (
        <p className="text-sm text-muted-foreground">{t('plan.review.overview.none')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="tabular-nums">
              {t('plan.review.overview.papers', {
                papers: overview.papers,
                questions: overview.questions,
              })}
            </p>
            {overview.questionsWithMarks > 0 && (
              <p className="tabular-nums text-muted-foreground">
                {t('plan.review.overview.marks', {
                  count: overview.questionsWithMarks,
                  marks: overview.totalMarks,
                })}
              </p>
            )}
            {overview.byKind.length > 0 && (
              <>
                <h3 className="pt-2 text-sm font-semibold">{t('plan.review.overview.byKind')}</h3>
                <ul className="space-y-0.5" data-review-overview-kinds>
                  {overview.byKind.map((row) => (
                    <li key={row.kind} className="flex gap-2 tabular-nums">
                      <span className="flex-1">{kindLabel(row.kind, t)}</span>
                      <span className="text-muted-foreground lab:font-mono">
                        {t('plan.review.overview.kindRow', {
                          questions: row.questions,
                          marks: row.marks,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {overview.topPoints.length > 0 && (
            <div className="space-y-1 text-sm">
              <h3 className="text-sm font-semibold">{t('plan.review.overview.top')}</h3>
              <ol className="list-decimal space-y-0.5 pl-5" data-review-overview-top>
                {overview.topPoints.map((row) => (
                  <li key={row.sectionId}>
                    <a
                      href={`#review-${row.sectionId}`}
                      className="focus-ring rounded-sm hover:text-primary coarse:inline-block coarse:py-2"
                      onClick={(event) => {
                        event.preventDefault()
                        document
                          .getElementById(`review-${row.sectionId}`)
                          ?.scrollIntoView({ block: 'start' })
                      }}
                    >
                      {row.title}
                    </a>{' '}
                    <span className="tabular-nums text-muted-foreground lab:font-mono">
                      {t('plan.review.overview.topRow', {
                        questions: row.questions,
                        marks: row.marks,
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('plan.review.overview.note')}</p>
    </section>
  )
}

/** "Midterm 2023 Q3 (10 marks)" links to the paper / assignment. */
function QuestionLinks({
  ids,
  refs,
  projectId,
}: {
  ids: string[]
  refs: Record<string, ReviewQuestionRef> | undefined
  projectId: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const shown = ids.map((id) => refs?.[id]).filter((ref): ref is ReviewQuestionRef => !!ref)
  if (shown.length === 0) return null
  return (
    <span className="mr-1 inline-flex flex-wrap gap-1 align-baseline">
      {shown.map((ref) => {
        const label = questionRefLabel(ref, (marks) => t('plan.review.marks', { marks }))
        const to = ref.setId
          ? `/projects/${projectId}/homework/${ref.setId}`
          : `/projects/${projectId}/documents/${ref.documentId}`
        return (
          <Link
            key={ref.questionId}
            to={to}
            className="focus-ring rounded-sm border px-1 text-[11px] text-muted-foreground hover:text-primary lab:rounded-none lab:font-mono coarse:py-1"
            data-review-question={ref.questionId}
          >
            {label}
          </Link>
        )
      })}
    </span>
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
  linkFrom,
  onRetry,
}: {
  index: number
  section: ReviewSection
  projectId: string
  running: boolean
  hasAI: boolean
  /** The workspace's exam: lesson / quiz links return there. */
  linkFrom: string | null
  onRetry: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const courseTopic =
    section.topicId && !section.topicId.startsWith('exam:') && !section.topicId.startsWith('unit:')
      ? section.topicId
      : undefined
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
              to={withExamReturn(`/projects/${projectId}/tutor/${courseTopic}`, linkFrom)}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline coarse:py-2"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {t('plan.review.lesson')}
            </Link>
          )}
          <Link
            to={withExamReturn(
              courseTopic
                ? `/projects/${projectId}/quiz?topic=${encodeURIComponent(courseTopic)}`
                : `/projects/${projectId}/quiz`,
              linkFrom,
            )}
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
          {!!section.examQuestions?.length && (
            <div className="space-y-1" data-review-exam-questions>
              <h3 className="text-sm font-semibold">{t('plan.review.examQuestions')}</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                {section.examQuestions.map((item, i) => (
                  <li key={i} className="text-[15px]">
                    <QuestionLinks
                      ids={item.questionIds}
                      refs={section.questionRefs}
                      projectId={projectId}
                    />
                    {item.text && (
                      <RichText text={item.text} paragraphClassName="text-[15px] leading-relaxed" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!section.marking?.length && (
            <div className="space-y-1" data-review-marking>
              <h3 className="text-sm font-semibold">{t('plan.review.marking')}</h3>
              <ul className="space-y-2">
                {section.marking.map((item, i) => (
                  <li key={i} className="text-[15px]">
                    {item.text && (
                      <RichText text={item.text} paragraphClassName="text-[15px] leading-relaxed" />
                    )}
                    <blockquote
                      className="mt-1 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground"
                      aria-label={t('plan.review.markingQuote')}
                    >
                      <QuestionLinks
                        ids={item.questionIds}
                        refs={section.questionRefs}
                        projectId={projectId}
                      />
                      <RichText text={item.quote} paragraphClassName="text-sm leading-relaxed" />
                    </blockquote>
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

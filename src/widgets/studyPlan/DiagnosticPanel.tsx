import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Progress } from '@/shared/ui/Progress'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useDiagnosticServices } from '@/features/studyPlan/useDiagnosticService'
import {
  DIAGNOSTIC_MAX_QUESTIONS,
  diagnosticProgress,
  estimateDiagnostic,
  minutesFor,
  planItems,
  proposeSection,
  type SectionProposal,
} from '@/services/diagnosticService'
import type { DiagnosticPaper } from '@/entities/studyPlan/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

type Proposal = SectionProposal & { selected: boolean }

/**
 * 摸底卷: one paper over every planned exam's course. The suggested question
 * count and time per course can be changed before anything is generated; the
 * estimate (requests, tokens) is shown first. Generation runs item by item
 * through the shared request pool, can be paused / stopped / continued, and a
 * failed item is retried on its own. Each course's part is taken in the quiz
 * page; its results feed the mastery estimates and so the plan.
 */
export function DiagnosticPanel(): JSX.Element {
  const { t } = useTranslation()
  const plans = useStudyPlanService()
  const { diagnostic, hasAI } = useDiagnosticServices()
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [papers, setPapers] = useState<DiagnosticPaper[]>([])
  const [results, setResults] = useState<
    Awaited<ReturnType<NonNullable<typeof diagnostic>['results']>>
  >([])
  const generation = useGenerationRun()
  const [stopRequested, setStopRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPapers = useCallback(async () => {
    if (!diagnostic) return
    const list = await diagnostic.list()
    // A tab closed mid-generation leaves items "generating": they wait for 继续.
    const recovered = await Promise.all(
      list.map(async (paper) => (await diagnostic.recoverInterrupted(paper.id)) ?? paper),
    )
    setPapers(recovered)
    if (recovered[0]) setResults(await diagnostic.results(recovered[0].id))
  }, [diagnostic])

  useEffect(() => {
    void loadPapers()
    void plans
      .contexts()
      .then((contexts) =>
        setProposals(contexts.map((context) => ({ ...proposeSection(context), selected: true }))),
      )
  }, [plans, loadPapers])

  const current = papers[0]
  const estimate = useMemo(
    () =>
      estimateDiagnostic(
        (proposals ?? [])
          .filter((p) => p.selected)
          .map((p) => ({ items: planItems(p.topics, p.count) })),
      ),
    [proposals],
  )

  async function generate(
    paper: DiagnosticPaper,
    extra: { itemIds?: string[]; retryFailed?: boolean } = {},
  ) {
    if (!diagnostic) return
    setError(null)
    setStopRequested(false)
    const run = generation.start()
    try {
      await diagnostic.generate(paper.id, {
        control: run,
        onProgress: (next) => setPapers((list) => list.map((p) => (p.id === next.id ? next : p))),
        ...extra,
      })
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      run.finish()
      await loadPapers()
    }
  }

  async function create() {
    if (!diagnostic || !proposals) return
    try {
      const paper = await diagnostic.create(proposals.filter((p) => p.selected))
      setPapers((list) => [paper, ...list])
      await generate(paper)
    } catch (err) {
      setError(friendlyAIError(err))
    }
  }

  const running = generation.state === 'running' || generation.state === 'pausing'
  const progress = current ? diagnosticProgress(current) : null

  return (
    <section className="space-y-6" data-plan-diagnostic>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">{t('plan.diagnostic.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('plan.diagnostic.hint')}</p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {current && progress && (
        <div className="space-y-4 rounded-md border p-4 lab:rounded-none" data-diagnostic-paper>
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm font-medium">
              {t('plan.diagnostic.paperStatus', {
                done: progress.done,
                total: progress.total,
                failed: progress.failed,
              })}
            </p>
            <GenerationControls
              kind="parts"
              state={generation.state}
              done={progress.done}
              total={progress.total}
              stopRequested={stopRequested}
              onPause={generation.requestPause}
              onStopNow={() => {
                setStopRequested(true)
                generation.stopNow()
              }}
              onResume={() => void generate(current)}
            />
          </div>
          <Progress
            value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
            aria-label={t('plan.diagnostic.progressAria')}
          />
          {!running && current.status !== 'ready' && progress.done < progress.total && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!hasAI} onClick={() => void generate(current)}>
                {t('plan.diagnostic.continue')}
              </Button>
              {progress.failed > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasAI}
                  onClick={() => void generate(current, { retryFailed: true })}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {t('plan.diagnostic.retryFailed', { count: progress.failed })}
                </Button>
              )}
              {progress.failed > 0 && progress.done > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void diagnostic
                      ?.assembleReady(current.id, { allowFailed: true })
                      .then(loadPapers)
                  }
                >
                  {t('plan.diagnostic.takeWhatIsReady')}
                </Button>
              )}
            </div>
          )}
          <ul className="space-y-3">
            {current.sections.map((section, s) => {
              const sectionProgress = progress.sections[s]!
              const result = results.find((row) => row.examId === section.examId)
              return (
                <li key={section.examId} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm">
                      {section.label}
                      <span className="tabular-nums text-muted-foreground">
                        {' · '}
                        {t('plan.diagnostic.sectionLine', {
                          count: section.count,
                          minutes: section.minutes,
                          done: sectionProgress.done,
                          total: sectionProgress.total,
                        })}
                      </span>
                    </p>
                    {section.quizId && (
                      <Button asChild size="sm">
                        <Link to={`/projects/${section.projectId}/quiz/${section.quizId}`}>
                          <ClipboardCheck className="h-4 w-4" aria-hidden />
                          {result?.percentage !== null && result?.percentage !== undefined
                            ? t('plan.diagnostic.viewResult')
                            : t('plan.diagnostic.take')}
                        </Link>
                      </Button>
                    )}
                  </div>
                  {section.items
                    .filter((item) => item.status === 'failed')
                    .map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center gap-2 pl-3 text-xs">
                        <span className="flex-1 text-destructive">
                          {item.label || t('plan.diagnostic.wholeCourse')}: {item.error}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={running || !hasAI}
                          onClick={() => void generate(current, { itemIds: [item.id] })}
                        >
                          {t('plan.diagnostic.retryItem')}
                        </Button>
                      </div>
                    ))}
                  {result && result.percentage !== null && (
                    <div className="pl-3 text-xs text-muted-foreground">
                      <p>
                        {t('plan.diagnostic.score', { percent: Math.round(result.percentage) })}
                      </p>
                      <p>
                        {result.byKnowledgePoint
                          .filter((row) => row.percent !== null)
                          .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
                          .slice(0, 8)
                          .map((row) => `${row.knowledgePoint} ${row.percent}%`)
                          .join(' · ')}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{t('plan.diagnostic.estimateNote')}</p>
          <Button
            size="sm"
            variant="ghost"
            disabled={running}
            onClick={() => void diagnostic?.remove(current.id).then(loadPapers)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t('plan.diagnostic.delete')}
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-base font-semibold">{t('plan.diagnostic.newTitle')}</h3>
        {!proposals ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('plan.weights.none')}</p>
        ) : (
          <>
            <ul className="space-y-3">
              {proposals.map((proposal, index) => {
                const update = (patch: Partial<Proposal>) =>
                  setProposals((list) =>
                    (list ?? []).map((p, i) => (i === index ? { ...p, ...patch } : p)),
                  )
                return (
                  <li key={proposal.examId} className="flex flex-wrap items-end gap-3">
                    <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={proposal.selected}
                        onChange={(event) => update({ selected: event.target.checked })}
                      />
                      {proposal.label}
                    </label>
                    <div className="space-y-1">
                      <Label htmlFor={`diag-count-${proposal.examId}`}>
                        {t('plan.diagnostic.count')}
                      </Label>
                      <Input
                        id={`diag-count-${proposal.examId}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={DIAGNOSTIC_MAX_QUESTIONS}
                        value={proposal.count}
                        className="w-24"
                        onChange={(event) => {
                          const count = Math.max(
                            1,
                            Math.min(DIAGNOSTIC_MAX_QUESTIONS, Number(event.target.value) || 1),
                          )
                          update({ count, minutes: minutesFor(count) })
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`diag-minutes-${proposal.examId}`}>
                        {t('plan.diagnostic.minutes')}
                      </Label>
                      <Input
                        id={`diag-minutes-${proposal.examId}`}
                        type="number"
                        inputMode="numeric"
                        min={5}
                        max={300}
                        value={proposal.minutes}
                        className="w-24"
                        onChange={(event) =>
                          update({
                            minutes: Math.max(5, Math.min(300, Number(event.target.value) || 5)),
                          })
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-sm tabular-nums text-muted-foreground" data-diagnostic-estimate>
              {t('plan.diagnostic.estimate', {
                questions: estimate.questions,
                requests: estimate.requests,
                input: Math.round(estimate.inputTokens / 1000),
                output: Math.round(estimate.outputTokens / 1000),
                minutes: proposals.filter((p) => p.selected).reduce((sum, p) => sum + p.minutes, 0),
              })}
            </p>
            <Button
              disabled={running || !hasAI || !proposals.some((p) => p.selected)}
              onClick={() => void create()}
            >
              {t('plan.diagnostic.generate')}
            </Button>
            {!hasAI && (
              <p className="text-xs text-muted-foreground">{t('plan.diagnostic.needsAI')}</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

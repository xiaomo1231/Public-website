import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RotateCcw, Sparkles, Timer } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import type { AiMockDefaults, AiMockPaperService } from '@/services/aiMockPaperService'
import type { HomeworkSet } from '@/entities/homework/types'
import {
  estimateMockPaper,
  MAX_MOCK_QUESTIONS,
  MOCK_DIFFICULTIES,
  structureReport,
  type AiMockConfig,
  type DefaultReason,
  type MockDifficulty,
  type MockSlotState,
} from '@/entities/exam/mockPaper'
import { startAiMockRun, useAiMockRun } from '@/features/exam/useAiMockService'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'
import { AiMockNotice } from './AiMockNotice'

const SELECT = 'focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm'

function reasonText(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  reason: DefaultReason,
): string {
  switch (reason.code) {
    case 'structure_from_paper':
      return t('aiMock.why.structure', { paper: reason.paper, questions: reason.questions })
    case 'minutes_from_paper':
      return t('aiMock.why.minutesPaper', { minutes: reason.minutes })
    case 'minutes_default':
      return t('aiMock.why.minutesDefault', { minutes: reason.minutes })
    case 'difficulty':
      return t(`aiMock.why.difficulty.${reason.reason}` as TranslationKey)
    case 'topics_exam_scope':
      return t('aiMock.why.topicsExam', { exam: reason.exam, topics: reason.topics })
    case 'topics_course':
      return t('aiMock.why.topicsCourse', { topics: reason.topics })
    case 'topics_weighted':
      return t('aiMock.why.topicsWeighted')
    case 'formula_sheet':
      return t('aiMock.why.formulaSheet')
  }
}

/**
 * 生成模拟卷: the defaults chosen locally (with why), the student's overrides
 * (difficulty, focus topics or an exam scope, question count, time), the
 * estimate, then the per-question progress. Opened with `setId` it shows an
 * existing paper's progress (继续 / 重试 / 完成).
 */
export function AiMockDialog({
  projectId,
  service,
  open,
  onOpenChange,
  examId,
  templateSetId,
  setId: initialSetId,
  onChanged,
}: {
  projectId: string
  service: AiMockPaperService
  open: boolean
  onOpenChange: (open: boolean) => void
  examId?: string
  templateSetId?: string
  setId?: string
  onChanged?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [defaults, setDefaults] = useState<AiMockDefaults | null>(null)
  const [template, setTemplate] = useState<string | undefined>(templateSetId)
  const [form, setForm] = useState<AiMockConfig | null>(null)
  const [scopeKey, setScopeKey] = useState('')
  const [setId, setSetId] = useState<string | undefined>(initialSetId)
  const [paper, setPaper] = useState<HomeworkSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const handle = useAiMockRun(setId)

  // Setup: the defaults for the chosen past paper.
  useEffect(() => {
    if (!open || setId) return
    let alive = true
    setError(null)
    void service
      .defaults(projectId, {
        ...(examId ? { examId } : {}),
        ...(template ? { templateSetId: template } : {}),
      })
      .then((next) => {
        if (!alive) return
        setDefaults(next)
        setForm(next.config)
        setScopeKey('')
      })
      .catch((err) => alive && setError(friendlyAIError(err)))
    return () => {
      alive = false
    }
  }, [open, setId, service, projectId, examId, template])

  const reload = useCallback(async () => {
    if (!setId) return
    const next = await service.getPaper(setId)
    setPaper(next ?? null)
  }, [service, setId])

  // Paper: read it, and keep reading while it is written.
  useEffect(() => {
    if (!open || !setId) return
    void service.recoverInterrupted(setId).then(() => reload())
  }, [open, setId, service, reload])
  const live = handle.active || paper?.status === 'analyzing'
  useEffect(() => {
    if (!open || !setId || !live) return
    const timer = window.setInterval(() => void reload(), 1000)
    return () => window.clearInterval(timer)
  }, [open, setId, live, reload])

  const run = useCallback(
    async (id: string, action: 'resume' | { retry: string }) => {
      const generation = startAiMockRun(id)
      handle.attach(generation)
      setError(null)
      try {
        if (action === 'resume') await service.resume(id, { control: generation })
        else await service.retrySlot(id, action.retry, { control: generation })
      } catch (err) {
        if (!isGenerationInterruption(err, generation)) setError(friendlyAIError(err))
      } finally {
        generation.finish()
        await reload()
        onChanged?.()
      }
    },
    [service, handle, reload, onChanged],
  )

  const start = useCallback(async () => {
    if (!form) return
    setStarting(true)
    setError(null)
    try {
      await service.preflight(projectId)
      const [documentId, scopeId] = scopeKey ? scopeKey.split('::') : []
      const planned = await service.plan(projectId, {
        ...form,
        ...(documentId && scopeId ? { scope: { documentId, scopeId } } : {}),
      })
      setSetId(planned.id)
      setPaper(planned)
      onChanged?.()
      void run(planned.id, 'resume')
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setStarting(false)
    }
  }, [form, service, projectId, scopeKey, run, onChanged])

  const estimate = useMemo(() => estimateMockPaper(form?.questionCount ?? 0), [form])
  const info = paper?.exam?.aiMock

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-ai-mock-dialog>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t('aiMock.dialogTitle')}
          </DialogTitle>
          <DialogDescription>{t('aiMock.disclaimer')}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {!setId &&
          (!defaults ? (
            <LoadingState label={t('common.loading')} />
          ) : !defaults.structure || !form ? (
            <p className="text-sm text-muted-foreground" data-ai-mock-no-template>
              {t('aiMock.noTemplate')}
            </p>
          ) : (
            <SetupForm
              defaults={defaults}
              form={form}
              onForm={setForm}
              template={form.templateSetId}
              onTemplate={setTemplate}
              scopeKey={scopeKey}
              onScope={setScopeKey}
              estimate={estimate}
            />
          ))}

        {setId && paper && info && (
          <div className="space-y-3" data-ai-mock-progress>
            <AiMockNotice report={structureReport(info)} detailed={paper.status === 'ready'} />
            {info.error && <p className="text-sm text-destructive">{info.error}</p>}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {live && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              <span>
                {t('aiMock.progress', {
                  done: info.slots.filter((s) => s.status === 'passed' || s.status === 'dropped')
                    .length,
                  total: info.slots.length,
                })}
              </span>
              <GenerationControls
                kind="parts"
                state={handle.state ?? (paper.status === 'paused' ? 'paused' : null)}
                stopRequested={handle.run?.stopRequested ?? false}
                onPause={handle.requestPause}
                onStopNow={handle.stopNow}
                onResume={() => void run(paper.id, 'resume')}
                hideStatus
              />
            </div>
            <SlotList
              slots={info.slots}
              busy={live}
              onRetry={(slotId) => void run(paper.id, { retry: slotId })}
            />
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {!setId && (
            <Button
              onClick={() => void start()}
              disabled={!form || starting || !defaults?.structure}
              data-ai-mock-start
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {t('aiMock.start')}
            </Button>
          )}
          {setId && paper && paper.status === 'paused' && !live && (
            <Button
              variant="outline"
              onClick={async () => {
                await service.finishWithMissing(paper.id)
                await reload()
                onChanged?.()
              }}
            >
              {t('aiMock.finishMissing')}
            </Button>
          )}
          {setId && paper?.status === 'ready' && (
            <Button asChild>
              <Link to={`/projects/${projectId}/homework/${paper.id}/exam`}>
                <Timer className="h-4 w-4" aria-hidden />
                {t('aiMock.take')}
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SetupForm({
  defaults,
  form,
  onForm,
  template,
  onTemplate,
  scopeKey,
  onScope,
  estimate,
}: {
  defaults: AiMockDefaults
  form: AiMockConfig
  onForm: (next: AiMockConfig) => void
  template: string
  onTemplate: (setId: string) => void
  scopeKey: string
  onScope: (key: string) => void
  estimate: ReturnType<typeof estimateMockPaper>
}): JSX.Element {
  const { t } = useTranslation()
  const structure = defaults.structure!
  const focus = new Set(form.focusTopicIds)
  const changed =
    form.difficulty !== defaults.config?.difficulty ||
    form.questionCount !== defaults.config?.questionCount ||
    form.minutes !== defaults.config?.minutes ||
    form.focusTopicIds.length > 0 ||
    scopeKey !== ''
  return (
    <div className="space-y-4 text-sm" data-ai-mock-setup>
      <section className="space-y-1">
        <Label htmlFor="ai-mock-template">{t('aiMock.template')}</Label>
        <select
          id="ai-mock-template"
          className={SELECT}
          value={template}
          onChange={(event) => onTemplate(event.target.value)}
        >
          {defaults.templates.map((item) => (
            <option key={item.setId} value={item.setId}>
              {item.title} · {t('aiMock.templateCount', { count: item.questions })}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {t('aiMock.structureSummary', {
            questions: structure.slots.length,
            marks: structure.totalMarks ?? '—',
          })}
          {' · '}
          {Object.entries(structure.kindMix)
            .map(([kind, n]) => `${t(`examAnalysis.kind.${kind}` as TranslationKey)} ${n}`)
            .join(' · ')}
        </p>
      </section>

      <section className="space-y-1" data-ai-mock-reasons>
        <p className="font-medium">{t('aiMock.defaultsTitle')}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {defaults.reasons.map((reason, index) => (
            <li key={index}>{reasonText(t, reason)}</li>
          ))}
          {defaults.conventions.length > 0 && (
            <li>
              {t('aiMock.conventions', {
                list: defaults.conventions
                  .map((c) => t(`aiMock.convention.${c}` as TranslationKey))
                  .join('、'),
              })}
            </li>
          )}
        </ul>
        {changed && <p className="text-xs text-primary">{t('aiMock.overridden')}</p>}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="ai-mock-difficulty">{t('aiMock.difficultyLabel')}</Label>
          <select
            id="ai-mock-difficulty"
            className={SELECT}
            value={form.difficulty}
            onChange={(event) =>
              onForm({ ...form, difficulty: event.target.value as MockDifficulty })
            }
          >
            {MOCK_DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {t(`aiMock.difficulty.${level}` as TranslationKey)}
                {level === defaults.config?.difficulty ? ` (${t('aiMock.default')})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-mock-count">{t('aiMock.count')}</Label>
          <Input
            id="ai-mock-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_MOCK_QUESTIONS}
            value={form.questionCount}
            onChange={(event) =>
              onForm({ ...form, questionCount: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-mock-minutes">{t('aiMock.minutes')}</Label>
          <Input
            id="ai-mock-minutes"
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            value={form.minutes}
            onChange={(event) =>
              onForm({ ...form, minutes: Math.max(5, Number(event.target.value) || 5) })
            }
          />
        </div>
      </section>

      {defaults.scopes.length > 0 && (
        <section className="space-y-1">
          <Label htmlFor="ai-mock-scope">{t('aiMock.scope')}</Label>
          <select
            id="ai-mock-scope"
            className={SELECT}
            value={scopeKey}
            onChange={(event) => onScope(event.target.value)}
          >
            <option value="">{t(defaults.exam ? 'aiMock.scopeExam' : 'aiMock.scopeCourse')}</option>
            {defaults.scopes.map((scope) => (
              <option
                key={`${scope.documentId}::${scope.scopeId}`}
                value={`${scope.documentId}::${scope.scopeId}`}
              >
                {scope.label}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="space-y-1">
        <p className="font-medium">{t('aiMock.focus')}</p>
        <p className="text-xs text-muted-foreground">{t('aiMock.focusHint')}</p>
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 lab:rounded-none sm:grid-cols-2">
          {defaults.allTopics.map((topic) => {
            const weighted = defaults.topics.find((item) => item.id === topic.id)
            return (
              <label key={topic.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={focus.has(topic.id)}
                  onChange={() =>
                    onForm({
                      ...form,
                      focusTopicIds: focus.has(topic.id)
                        ? form.focusTopicIds.filter((id) => id !== topic.id)
                        : [...form.focusTopicIds, topic.id],
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                {weighted?.mastery != null && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(weighted.mastery * 100)}%
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </section>

      <section
        className="rounded-md border border-dashed p-2 text-xs lab:rounded-none"
        data-ai-mock-estimate
      >
        <p className="font-medium">{t('aiMock.estimateTitle')}</p>
        <p className="text-muted-foreground">
          {t('aiMock.estimate', {
            requests: estimate.requests,
            max: estimate.maxRequests,
            input: estimate.inputTokens.toLocaleString(),
            output: estimate.outputTokens.toLocaleString(),
          })}
        </p>
        <p className="text-muted-foreground">{t('aiMock.preflightNote')}</p>
      </section>
    </div>
  )
}

const STATUS_VARIANT = {
  pending: 'outline',
  written: 'secondary',
  passed: 'default',
  dropped: 'destructive',
  failed: 'destructive',
} as const

function SlotList({
  slots,
  busy,
  onRetry,
}: {
  slots: MockSlotState[]
  busy: boolean
  onRetry: (slotId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <ol className="divide-y rounded-md border text-sm lab:rounded-none" data-ai-mock-slots>
      {slots.map((slot) => (
        <li
          key={slot.id}
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          data-slot-status={slot.status}
        >
          <span className="font-medium">{t('aiMock.missingSlot', { label: slot.label })}</span>
          {slot.marks !== undefined && (
            <span className="text-xs text-muted-foreground">
              {t('mockExam.marksBadge', { marks: slot.marks })}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {slot.topicNames.join(' · ')} ·{' '}
            {t(`aiMock.difficulty.${slot.difficulty}` as TranslationKey)}
          </span>
          <Badge variant={STATUS_VARIANT[slot.status]}>
            {t(`aiMock.slot.${slot.status}` as TranslationKey)}
          </Badge>
          {(slot.status === 'failed' || slot.status === 'dropped') && !busy && (
            <Button size="sm" variant="ghost" onClick={() => onRetry(slot.id)}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('aiMock.retry')}
            </Button>
          )}
          {(slot.error || slot.dropReason || (slot.status === 'pending' && slot.rejected)) && (
            <p className="w-full text-xs text-muted-foreground">
              {slot.error ?? slot.dropReason ?? t('aiMock.rewriting', { reason: slot.rejected! })}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

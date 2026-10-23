import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ImageOff,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import {
  insertSubpartBoundary,
  mergeSubpart,
  subpartLabels,
  type ProofreadRisk,
  type ProofreadRiskKind,
  type ReconfirmKind,
} from '@/entities/homework/proofread'
import {
  EVAL_ROLES,
  EVAL_ROLE_HINT_KEYS,
  EVAL_ROLE_LABEL_KEYS,
  resolveEvalRole,
  usedForTuning,
  type EvalRole,
} from '@/entities/evaluation/evalRole'
import {
  HomeworkProofreadService,
  type ProofreadEntry,
  type ProofreadState,
} from '@/services/homeworkProofreadService'
import { buildHomeworkService, buildHomeworkWalkthroughService } from '@/services/aiServices'
import { questionSectionId } from '@/entities/homework/walkthrough'

const RISK_LABEL_KEYS: Record<ProofreadRiskKind, TranslationKey> = {
  minus_sign: 'proofread.risk.minus_sign',
  flattened_power: 'proofread.risk.flattened_power',
  matrix: 'proofread.risk.matrix',
  fraction: 'proofread.risk.fraction',
  table: 'proofread.risk.table',
  subpart: 'proofread.risk.subpart',
  number_mismatch: 'proofread.risk.number_mismatch',
  unreadable: 'proofread.risk.unreadable',
}

const RECONFIRM_LABEL_KEYS: Record<ReconfirmKind, TranslationKey> = {
  answer_link: 'proofread.reconfirm.answer_link',
  hints: 'proofread.reconfirm.hints',
  walkthrough: 'proofread.reconfirm.walkthrough',
  compare: 'proofread.reconfirm.compare',
  review: 'proofread.reconfirm.review',
  check: 'proofread.reconfirm.check',
  guided: 'proofread.reconfirm.guided',
  practice: 'proofread.reconfirm.practice',
}

interface ProofreadViewProps {
  setId: string
  projectId: string
  /** Called after any save, so the page can re-read its questions. */
  onChanged?: () => void
  /** Open another view of the assignment (review / guided / practice / walkthrough). */
  onOpenView?: (view: 'practice' | 'review' | 'guided' | 'walkthrough') => void
  /** Injected in tests. */
  service?: HomeworkProofreadService
}

/** One highlighted risk chip; clicking selects that range in the editor. */
function RiskChips({
  risks,
  onSelect,
}: {
  risks: readonly ProofreadRisk[]
  onSelect: (risk: ProofreadRisk) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (risks.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('proofread.risksLabel')}>
      {risks.slice(0, 24).map((risk, index) => (
        <li key={`${risk.kind}-${risk.start}-${index}`}>
          <button
            type="button"
            onClick={() => onSelect(risk)}
            data-risk={risk.kind}
            className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 text-xs text-foreground hover:bg-amber-500/20 lab:rounded-sm coarse:min-h-11"
          >
            <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>{t(RISK_LABEL_KEYS[risk.kind])}</span>
            <code className="max-w-[12ch] truncate font-mono">{risk.text.trim() || '·'}</code>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The original page next to the text (rendered locally, never uploaded). */
function PageImage({
  service,
  documentId,
  page,
}: {
  service: HomeworkProofreadService
  documentId: string | undefined
  page: number | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(page ?? 1)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => setCurrent(page ?? 1), [page])
  useEffect(() => {
    if (!documentId) return
    let alive = true
    let made: string | null = null
    setLoading(true)
    void service
      .renderPage(documentId, current)
      .catch(() => null)
      .then((blob) => {
        if (!alive) return
        made = blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
        setUrl(made)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
      if (made && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(made)
    }
  }, [service, documentId, current])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium lab:font-mono lab:text-xs lab:uppercase">
          {t('proofread.original', { page: current })}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            aria-label={t('proofread.prevPage')}
            disabled={current <= 1}
            onClick={() => setCurrent((value) => Math.max(1, value - 1))}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            aria-label={t('proofread.nextPage')}
            onClick={() => setCurrent((value) => value + 1)}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-[240px] overflow-auto rounded-lg border border-border/70 bg-card lab:rounded-sm">
        {loading ? (
          <div className="grid h-60 place-items-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        ) : url ? (
          <img src={url} alt={t('proofread.originalAlt', { page: current })} className="w-full" />
        ) : (
          <div className="grid h-60 place-items-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <ImageOff className="h-5 w-5" aria-hidden />
            {t('proofread.noImage')}
          </div>
        )}
      </div>
    </div>
  )
}

/** Live preview of recognised text, rendered the way the question view shows it. */
function Preview({ text, label }: { text: string; label: string }): JSX.Element {
  return (
    <div
      className="rounded-lg border border-dashed border-border/70 p-3 lab:rounded-sm"
      aria-label={label}
      role="region"
    >
      <RichText
        text={formatHomeworkQuestion(text)}
        format="markdown"
        paragraphClassName="text-sm leading-relaxed"
      />
    </div>
  )
}

/**
 * 导入校对: the original page on the left, the recognised question (and its
 * matched professor answer) on the right, editable, with risky spots marked.
 * Saving goes through the service (one transaction, edit history kept);
 * everything derived from the old text then shows as 「需重新确认」.
 */
export function ProofreadView({
  setId,
  projectId,
  onChanged,
  onOpenView,
  service: injected,
}: ProofreadViewProps): JSX.Element {
  const { t } = useTranslation()
  const service = useMemo(() => injected ?? new HomeworkProofreadService(), [injected])
  const [state, setState] = useState<ProofreadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [number, setNumber] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    const next = await service.load(setId)
    setState(next)
    setActiveId((prev) =>
      prev && next.entries.some((entry) => entry.question.id === prev)
        ? prev
        : (next.entries.find((entry) => !entry.question.verifiedAt)?.question.id ??
          next.entries[0]?.question.id ??
          null),
    )
    return next
  }, [service, setId])

  useEffect(() => {
    void load().catch((err) => setError(friendlyAIError(err)))
  }, [load])

  const index = state?.entries.findIndex((entry) => entry.question.id === activeId) ?? -1
  const entry: ProofreadEntry | undefined = index >= 0 ? state?.entries[index] : undefined

  // Reset the editor when another question is shown (or it was reloaded).
  useEffect(() => {
    if (!entry) return
    setPrompt(entry.question.prompt)
    setNumber(entry.question.number ?? '')
    setAnswer(entry.question.answerText ?? '')
    setMessage(null)
  }, [entry])

  if (error) return <ErrorState title={t('proofread.title')} description={error} />
  if (!state) return <LoadingState label={t('common.loading')} />
  if (state.entries.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t('proofread.empty')}
        </CardContent>
      </Card>
    )

  const question = entry?.question
  const dirty =
    !!question &&
    (prompt !== question.prompt ||
      number !== (question.number ?? '') ||
      (question.answerText !== undefined && answer !== question.answerText))
  const labels = subpartLabels(prompt)

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    setMessage(null)
    try {
      await action()
      await load()
      onChanged?.()
      if (done) setMessage(done)
    } catch (err) {
      setMessage(friendlyAIError(err))
    } finally {
      setBusy(null)
    }
  }

  const save = (verify: boolean) =>
    question &&
    run(
      'save',
      async () => {
        if (dirty)
          await service.saveQuestion(question.id, {
            prompt,
            number,
            ...(question.answerText !== undefined ? { answerText: answer } : {}),
          })
        if (verify) {
          await service.setVerified(question.id, true)
          // 标记已核对 moves on to the next question.
          const next = state.entries[index + 1]
          if (next) setActiveId(next.question.id)
        }
      },
      t(verify ? 'proofread.savedVerified' : 'proofread.saved'),
    )

  const selectRange = (target: 'prompt' | 'answer', risk: ProofreadRisk) => {
    const field = target === 'prompt' ? promptRef.current : answerRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(risk.start, risk.end)
  }

  const go = (delta: number) => {
    const next = state.entries[index + delta]
    if (next) setActiveId(next.question.id)
  }

  const reconfirmAction = async (kind: ReconfirmKind): Promise<void> => {
    if (!question) return
    const sectionId = questionSectionId(question.id)
    switch (kind) {
      case 'answer_link':
        return void run(kind, () => service.reconfirmAnswerLink(question.id))
      case 'hints':
        return void run(kind, async () => {
          const homework = await buildHomeworkService()
          if (question.answerBased && question.answerStatus === 'matched')
            await homework.generateAnswerForQuestion(question.id)
          else await homework.generateContent(question.id)
        })
      case 'walkthrough':
        return void run(kind, async () => {
          const walkthroughs = await buildHomeworkWalkthroughService()
          await walkthroughs.regenerateSection(setId, sectionId)
        })
      case 'compare':
        return void run(kind, async () => {
          const walkthroughs = await buildHomeworkWalkthroughService()
          await walkthroughs.compareSection(setId, sectionId)
        })
      case 'review':
        return onOpenView?.('review')
      case 'guided':
        return onOpenView?.('guided')
      case 'check':
        return onOpenView?.('practice')
      case 'practice':
        return undefined
    }
  }

  const role = resolveEvalRole(question?.evalRole)
  const tuned =
    !!question && usedForTuning(question, { hasWalkthroughSection: entry?.hasWalkthroughSection })

  return (
    <div className="space-y-4" data-proofread>
      <Card className="border-border/70">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
          <span className="font-medium">{t('proofread.title')}</span>
          <ol
            className="flex min-w-0 flex-1 flex-wrap gap-1.5"
            aria-label={t('proofread.questionList')}
          >
            {state.entries.map((item, position) => {
              const isActive = item.question.id === activeId
              const verified = Boolean(item.question.verifiedAt)
              return (
                <li key={item.question.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(item.question.id)}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={t(
                      verified ? 'proofread.chipVerified' : 'proofread.chipUnverified',
                      {
                        n: item.question.number ?? String(position + 1),
                      },
                    )}
                    data-verified={verified ? 'true' : 'false'}
                    className={cn(
                      'focus-ring inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-2.5 text-xs lab:rounded-sm',
                      isActive
                        ? 'border-primary bg-theme-primary-soft text-foreground'
                        : 'border-border/70 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {verified ? (
                      <CheckCircle2
                        className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                    ) : null}
                    <span className="font-mono">{item.question.number ?? position + 1}</span>
                    {(item.risks.length > 0 || item.reconfirm.length > 0) && (
                      <AlertTriangle
                        className="h-3 w-3 text-amber-600 dark:text-amber-400"
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>

      {entry && question && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2 lg:sticky lg:top-4">
            <PageImage service={service} documentId={state.document?.id} page={entry.page} />
            {entry.compareWithImage && (
              <p
                className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-sm"
                data-compare-image
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
                {t('proofread.compareWithImage')}
              </p>
            )}
            {entry.sourceText && (
              <details className="rounded-lg border border-border/70 p-2 text-sm lab:rounded-sm">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">
                  {t('proofread.recognisedSource')}
                </summary>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {entry.sourceText}
                </pre>
              </details>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('proofread.number')}</span>
                <Input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  className="h-11 w-28 font-mono"
                  aria-label={t('proofread.number')}
                />
              </label>
              {question.verifiedAt ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {t('proofread.verified')}
                </Badge>
              ) : null}
              {(question.edits?.length ?? 0) > 0 && (
                <Badge variant="outline">
                  {t('proofread.editCount', { count: question.edits!.length })}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor={`proofread-prompt-${question.id}`} className="text-sm font-medium">
                {t('proofread.questionText')}
              </label>
              <Textarea
                id={`proofread-prompt-${question.id}`}
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void save(false)
                  }
                }}
                rows={8}
                className="font-mono text-[13px] leading-relaxed"
                spellCheck={false}
              />
              <RiskChips risks={entry.risks} onSelect={(risk) => selectRange('prompt', risk)} />
              <Preview text={prompt} label={t('proofread.preview')} />
              <div className="flex flex-wrap items-center gap-2 text-sm" data-subparts>
                <span className="text-muted-foreground">
                  {labels.length > 0
                    ? t('proofread.subparts', { labels: labels.map((l) => `(${l})`).join(' ') })
                    : t('proofread.noSubparts')}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => {
                    const caret = promptRef.current?.selectionStart ?? prompt.length
                    setPrompt(insertSubpartBoundary(prompt, caret))
                  }}
                >
                  {t('proofread.splitAtCursor')}
                </Button>
                {labels.slice(1).map((label) => (
                  <Button
                    key={label}
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setPrompt(mergeSubpart(prompt, label))}
                  >
                    {t('proofread.mergeInto', { label })}
                  </Button>
                ))}
              </div>
            </div>

            {question.answerText !== undefined && (
              <div className="space-y-2" data-proofread-answer>
                <label htmlFor={`proofread-answer-${question.id}`} className="text-sm font-medium">
                  {t('proofread.answerText', { number: question.answerNumber ?? '—' })}
                  {question.answerSource === 'inline' && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {t('homework.answer.professorInline')}
                    </span>
                  )}
                </label>
                <Textarea
                  id={`proofread-answer-${question.id}`}
                  ref={answerRef}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={6}
                  className="font-mono text-[13px] leading-relaxed"
                  spellCheck={false}
                />
                <RiskChips
                  risks={entry.answerRisks}
                  onSelect={(risk) => selectRange('answer', risk)}
                />
                <Preview text={answer} label={t('proofread.answerPreview')} />
              </div>
            )}

            {entry.reconfirm.length > 0 && (
              <section
                className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 lab:rounded-sm"
                aria-label={t('proofread.reconfirmTitle')}
                data-reconfirm
              >
                <h3 className="text-sm font-medium">{t('proofread.reconfirmTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('proofread.reconfirmHint')}</p>
                <ul className="space-y-1.5">
                  {entry.reconfirm.map((kind) => (
                    <li
                      key={kind}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>{t(RECONFIRM_LABEL_KEYS[kind])}</span>
                      {kind === 'practice' ? (
                        <Link
                          to={`/projects/${projectId}/homework`}
                          className="focus-ring inline-flex min-h-11 items-center rounded px-2 text-primary underline"
                        >
                          {t('proofread.openPracticeSets')}
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => void reconfirmAction(kind)}
                        >
                          {busy === kind ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          {t(
                            kind === 'answer_link'
                              ? 'proofread.action.reconfirm'
                              : kind === 'review' || kind === 'guided' || kind === 'check'
                                ? 'proofread.action.open'
                                : 'proofread.action.regenerate',
                          )}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="space-y-1">
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('evalRole.label')}</span>
                <select
                  value={role ?? ''}
                  onChange={(event) => {
                    const next = resolveEvalRole(event.target.value)
                    void run('role', () => service.setQuestionEvalRole(question.id, next))
                  }}
                  className="focus-ring h-11 rounded-lg border border-input bg-background px-2 text-sm lab:rounded-sm"
                  aria-describedby={`role-hint-${question.id}`}
                >
                  <option value="">{t('evalRole.none')}</option>
                  {EVAL_ROLES.map((item: EvalRole) => (
                    <option key={item} value={item}>
                      {t(EVAL_ROLE_LABEL_KEYS[item])}
                    </option>
                  ))}
                </select>
              </label>
              <p id={`role-hint-${question.id}`} className="text-xs text-muted-foreground">
                {role ? t(EVAL_ROLE_HINT_KEYS[role]) : t('evalRole.noneHint')}
              </p>
              {role === 'independent' && tuned && (
                <p className="text-xs text-amber-700 dark:text-amber-300" data-tuned-warning>
                  {t('evalRole.alreadyUsed')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={index <= 0}
                onClick={() => go(-1)}
                aria-label={t('proofread.prevQuestion')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button
                className="min-h-11"
                disabled={!dirty || busy !== null}
                onClick={() => void save(false)}
              >
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('proofread.save')}
              </Button>
              {question.verifiedAt && !dirty ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-pressed
                  disabled={busy !== null}
                  onClick={() => void run('verify', () => service.setVerified(question.id, false))}
                >
                  {t('proofread.unverify')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-pressed={false}
                  disabled={busy !== null}
                  onClick={() => void save(true)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {dirty ? t('proofread.saveAndVerify') : t('proofread.markVerified')}
                </Button>
              )}
              <Button
                variant="outline"
                className="min-h-11"
                disabled={index >= state.entries.length - 1}
                onClick={() => go(1)}
                aria-label={t('proofread.nextQuestion')}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
              {message && (
                <span className="text-sm text-muted-foreground" role="status">
                  {message}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Scissors,
  Trash2,
  Unlink,
  Wand2,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { AnswerEntry, AnswerLine } from '@/entities/homework/answerMatching'
import { isDeferredProfessorAnswer, segmentsToAnswerEntries } from '@/entities/homework/answerMatching'
import type { AnswerGenerationProgress, HomeworkService } from '@/services/homeworkService'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Progress } from '@/shared/ui/Progress'
import { RichText } from '@/shared/ui/RichText'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation, type TranslationKey } from '@/i18n'

const NONE = '__none__'

const REASON_KEYS: Record<string, TranslationKey> = {
  'answer-number-duplicate': 'homework.answer.reason.answer-number-duplicate',
  'question-number-duplicate': 'homework.answer.reason.question-number-duplicate',
  'question-number-missing': 'homework.answer.reason.question-number-missing',
  'answer-number-missing': 'homework.answer.reason.answer-number-missing',
  'no-answers': 'homework.answer.reason.no-answers',
}

export interface HomeworkAnswerDialogProps {
  projectId: string
  set: HomeworkSet
  service: HomeworkService
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ask the parent to run the upload flow (upload / replace). */
  onRequestUpload: () => void
  /** Fired after any change so the parent can re-read local state. */
  onChanged: () => void
}

type Selections = Record<string, number | undefined>

/** Prefill the manual editor with the division the stored entries imply. */
function inferDivision(
  lines: AnswerLine[],
  entries: AnswerEntry[],
): { starts: number[]; numbers: Record<number, string> } {
  const starts: number[] = []
  const numbers: Record<number, string> = {}
  let cursor = 0
  for (const entry of entries) {
    const firstLine = entry.text.split('\n')[0]?.trim()
    let found = -1
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i]!.text === firstLine) {
        found = i
        break
      }
    }
    if (found < 0) continue
    starts.push(found)
    if (entry.number) numbers[found] = entry.number
    cursor = found + 1
  }
  return starts.length > 0 ? { starts, numbers } : { starts: [0], numbers: { 0: '1' } }
}

/** Preselect rows from the auto-match, then from any stored confirmed answer. */
function buildSelections(
  questions: HomeworkQuestion[],
  entries: AnswerEntry[],
  assignments: ReadonlyArray<{ questionId: string; status: string; answerIndex?: number }>,
): Selections {
  const used = new Set<number>()
  const selections: Selections = {}

  for (const assignment of assignments) {
    if (assignment.status !== 'matched' || assignment.answerIndex === undefined) continue
    if (used.has(assignment.answerIndex)) continue
    used.add(assignment.answerIndex)
    selections[assignment.questionId] = assignment.answerIndex
  }

  for (const question of questions) {
    if (selections[question.id] !== undefined) continue
    if (question.answerStatus !== 'matched' || !question.answerText) continue
    const index = entries.findIndex(
      (entry) => entry.text === question.answerText && entry.number === question.answerNumber,
    )
    if (index < 0 || used.has(index)) continue
    used.add(index)
    selections[question.id] = index
  }
  return selections
}

/**
 * Reviews and confirms the mapping between a homework's questions and the
 * linked professor answer file, then triggers answer-based generation.
 *
 * Only one-to-one number matches are proposed automatically. The student can
 * assign or clear any row, or divide an un-split text block manually; a
 * cleared/unconfirmed row is never used to generate, and the same answer can
 * never be saved onto two questions (enforced again by the service).
 */
export function HomeworkAnswerDialog({
  projectId,
  set,
  service,
  open,
  onOpenChange,
  onRequestUpload,
  onChanged,
}: HomeworkAnswerDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([])
  const [entries, setEntries] = useState<AnswerEntry[]>([])
  const [lines, setLines] = useState<AnswerLine[]>([])
  const [manual, setManual] = useState(false)
  const [summary, setSummary] = useState({ total: 0, numbered: 0, unnumbered: 0, unsplit: false })
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [unmatched, setUnmatched] = useState(0)
  const [selections, setSelections] = useState<Selections>({})
  const [documentName, setDocumentName] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<AnswerGenerationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReprocess, setConfirmReprocess] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualStarts, setManualStarts] = useState<number[]>([0])
  const [manualNumbers, setManualNumbers] = useState<Record<number, string>>({ 0: '1' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const [mapping, list] = await Promise.all([
        service.buildAnswerMapping(set.id),
        service.listQuestions(set.id),
      ])
      setQuestions(list)
      setEntries(mapping.entries)
      setLines(mapping.lines)
      setManual(mapping.manual)
      setSummary(mapping.summary)
      setDocumentName(mapping.document?.name ?? null)
      setDocumentStatus(mapping.document?.status ?? null)
      setDocumentType(mapping.document?.type ?? null)

      const nextReasons: Record<string, string> = {}
      for (const assignment of mapping.result.assignments) {
        nextReasons[assignment.questionId] = assignment.reason
      }
      setReasons(nextReasons)
      setSelections(buildSelections(list, mapping.entries, mapping.result.assignments))
      setUnmatched(mapping.result.unmatchedAnswers.length)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setLoading(false)
    }
  }, [service, set.id])

  useEffect(() => {
    if (open && set.answerDocumentId) void load()
  }, [open, set.answerDocumentId, load])

  useEffect(() => {
    if (!open) setManualMode(false)
  }, [open])

  const selectedIndexes = useMemo(
    () => Object.values(selections).filter((value): value is number => value !== undefined),
    [selections],
  )
  const duplicateSelection = useMemo(() => {
    const seen = new Set<number>()
    for (const index of selectedIndexes) {
      if (seen.has(index)) return true
      seen.add(index)
    }
    return false
  }, [selectedIndexes])

  const pageLabel = useCallback(
    (entry: AnswerEntry | undefined): string => {
      const pages = entry?.pageNumbers ?? []
      if (pages.length === 0) return t('homework.answer.noSourcePage')
      return pages.map((page) => t('homework.answer.sourcePage', { page })).join(' · ')
    },
    [t],
  )

  async function save(): Promise<number> {
    const payload = questions.map((question) => ({
      questionId: question.id,
      ...(selections[question.id] !== undefined ? { answerIndex: selections[question.id] } : {}),
    }))
    return service.confirmAnswerMapping(set.id, payload)
  }

  async function handleSave(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await save()
      onChanged()
      onOpenChange(false)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveAndGenerate(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    setGenerationProgress(null)
    try {
      const matched = await save()
      onChanged()
      if (matched === 0) {
        setNotice(t('homework.answer.unmatched', { count: 0 }))
        return
      }
      const result = await service.generateAnswerContent(set.id, undefined, setGenerationProgress)
      onChanged()
      // Reload first: `load()` clears the notice, so set it afterwards.
      await load()
      setNotice(result.generated === 0 && result.failed === 0
        ? t('homework.answer.upToDate')
        : t('homework.answer.generatedSummary', {
          generated: result.generated, failed: result.failed, skipped: result.skipped ?? 0,
        }))
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
      setGenerationProgress(null)
    }
  }

  async function handleRetryQuestion(questionId: string): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    setGenerationProgress(null)
    try {
      const result = await service.generateAnswerContent(set.id, [questionId], setGenerationProgress)
      onChanged()
      await load()
      setNotice(t('homework.answer.generatedSummary', {
        generated: result.generated, failed: result.failed, skipped: 0,
      }))
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
      setGenerationProgress(null)
    }
  }

  async function handleUnlink(deleteFile: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await service.detachAnswerDocument(set.id, projectId, { deleteFile })
      onChanged()
      setConfirmDelete(false)
      onOpenChange(false)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleReprocess(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await service.reprocessAnswerDocument(set.id, projectId)
      await load()
      onChanged()
      setNotice(t('homework.answer.reprocessDone'))
      setConfirmReprocess(false)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  function openManual(): void {
    const inferred = inferDivision(lines, entries)
    setManualStarts(inferred.starts)
    setManualNumbers(inferred.numbers)
    setManualMode(true)
    setError(null)
    setNotice(null)
  }

  function toggleStart(index: number): void {
    if (index === 0) return
    setManualStarts((prev) =>
      prev.includes(index)
        ? prev.filter((value) => value !== index)
        : [...prev, index].sort((a, b) => a - b),
    )
  }

  async function handleApplyDivision(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const sorted = [...new Set(manualStarts)].filter((i) => i >= 0 && i < lines.length).sort((a, b) => a - b)
      if (sorted.length === 0 || sorted[0] !== 0) {
        setError(t('homework.answer.invalidSplit'))
        return
      }
      const numbers: Record<number, string> = {}
      sorted.forEach((start, position) => {
        numbers[start] = Object.prototype.hasOwnProperty.call(manualNumbers, start)
          ? manualNumbers[start]!
          : String(position + 1)
      })
      const nextEntries = segmentsToAnswerEntries(lines, sorted, numbers)
      if (nextEntries.length === 0) {
        setError(t('homework.answer.invalidSplit'))
        return
      }
      await service.saveAnswerEntries(set.id, nextEntries)
      await load()
      setManualMode(false)
      onChanged()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleResetDivision(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await service.clearAnswerEntries(set.id)
      setManualMode(false)
      await load()
      onChanged()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = documentStatus === 'ready'
  const answerLabel = (entry: AnswerEntry, index: number): string => {
    const head = entry.text.replace(/\s+/g, ' ').slice(0, 60)
    return `${entry.number ? `#${entry.number} ` : `#${index + 1} `}${head}`
  }

  const previewEntry = (questionId: string): AnswerEntry | undefined => {
    const index = selections[questionId]
    return index === undefined ? undefined : entries[index]
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy || generationProgress !== null) && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {t('homework.answer.title')}
          </DialogTitle>
          <DialogDescription>{t('homework.answer.subtitle')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            {notice}
          </div>
        )}
        {generationProgress && generationProgress.total > 0 && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3" aria-live="polite">
            <p className="text-sm font-medium">
              {t('homework.answer.generationProgress', {
                completed: generationProgress.completed,
                total: generationProgress.total,
              })}
            </p>
            <Progress
              value={100 * generationProgress.completed / generationProgress.total}
              aria-label={t('homework.answer.generationProgressLabel')}
              aria-valuenow={Math.round(100 * generationProgress.completed / generationProgress.total)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
            <p className="text-xs text-muted-foreground">{t('homework.answer.generationCanClose')}</p>
          </div>
        )}

        {!set.answerDocumentId ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('homework.answer.uploadHint')}</p>
            <Button onClick={onRequestUpload}>
              <ClipboardCheck className="h-4 w-4" />
              {t('homework.menu.uploadAnswer')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {t('homework.answer.linked')}
                </p>
                <p className="min-w-0 text-sm font-medium">
                  <TruncatedText text={documentName ?? ''} className="min-w-0" />
                </p>
              </div>
              <div className="flex items-center gap-2">
                {ready ? (
                  <Badge variant="default">{t('homework.status.ready')}</Badge>
                ) : (
                  <Badge variant="secondary">{documentStatus ?? ''}</Badge>
                )}
                {set.answerDocumentId && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/projects/${projectId}/documents/${set.answerDocumentId}`}>
                      <ExternalLink className="h-4 w-4" />
                      {t('homework.answer.openFile')}
                    </Link>
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => void load()} aria-label={t('homework.menu.refresh')}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {!ready ? (
              <p className="text-sm text-muted-foreground">
                {documentStatus === 'failed'
                  ? t('homework.answer.failed')
                  : t('homework.answer.processing')}
              </p>
            ) : loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </div>
            ) : manualMode ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">{t('homework.answer.manualTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('homework.answer.manualHint')}</p>
                </div>
                <ul className="max-h-[45vh] space-y-1 overflow-y-auto pr-1">
                  {lines.length === 0 && (
                    <li className="text-sm text-muted-foreground">{t('homework.answer.emptyEntries')}</li>
                  )}
                  {lines.map((line, index) => {
                    const isStart = manualStarts.includes(index)
                    const position = [...manualStarts].sort((a, b) => a - b).indexOf(index)
                    return (
                      <li
                        key={`${line.chunkId}-${index}`}
                        className={`flex items-start gap-2 rounded-lg border p-2 ${
                          isStart ? 'border-primary/50 bg-primary/5' : 'border-border/60'
                        }`}
                      >
                        <Button
                          type="button"
                          variant={isStart ? 'default' : 'outline'}
                          size="sm"
                          className="shrink-0"
                          aria-pressed={isStart}
                          aria-label={t('homework.answer.manualStart')}
                          disabled={index === 0}
                          onClick={() => toggleStart(index)}
                        >
                          {index + 1}
                        </Button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{line.pageNumber !== undefined ? t('homework.answer.sourcePage', { page: line.pageNumber }) : t('homework.answer.noSourcePage')}</span>
                            {isStart && (
                              <span className="text-primary">
                                {t('homework.answer.manualNumber')}:
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{line.text}</p>
                        </div>
                        {isStart && (
                          <Input
                            className="h-8 w-20 shrink-0"
                            value={
                              Object.prototype.hasOwnProperty.call(manualNumbers, index)
                                ? manualNumbers[index]
                                : String(position + 1)
                            }
                            aria-label={t('homework.answer.manualNumber')}
                            onChange={(event) =>
                              setManualNumbers((prev) => ({ ...prev, [index]: event.target.value }))
                            }
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void handleApplyDivision()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                    {t('homework.answer.manualApply')}
                  </Button>
                  <Button variant="outline" onClick={() => setManualMode(false)} disabled={busy}>
                    {t('homework.answer.manualCancel')}
                  </Button>
                  {manual && (
                    <Button variant="ghost" onClick={() => void handleResetDivision()} disabled={busy}>
                      {t('homework.answer.manualReset')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium">{t('homework.answer.previewTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('homework.answer.previewHint')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('homework.answer.parseSummary', {
                      total: summary.total,
                      numbered: summary.numbered,
                      unnumbered: summary.unnumbered,
                    })}
                  </p>
                </div>

                {manual && (
                  <p className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs text-foreground">
                    {t('homework.answer.manualActive')}
                  </p>
                )}

                {summary.unsplit && (
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      {t('homework.answer.singleFragmentTitle')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('homework.answer.singleFragmentHint')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {set.answerDocumentId && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/projects/${projectId}/documents/${set.answerDocumentId}`}>
                            <ExternalLink className="h-4 w-4" />
                            {t('homework.answer.viewFile')}
                          </Link>
                        </Button>
                      )}
                      <Button size="sm" onClick={openManual}>
                        <Scissors className="h-4 w-4" />
                        {t('homework.answer.manualSplit')}
                      </Button>
                    </div>
                  </div>
                )}

                {entries.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('homework.answer.emptyEntries')}</p>
                )}

                {duplicateSelection && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    {t('homework.answer.duplicateSelection')}
                  </p>
                )}

                <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                  {questions.map((question, position) => {
                    const value = selections[question.id]
                    const reason = reasons[question.id]
                    const preview = previewEntry(question.id)
                    const deferredAnswer = Boolean(preview && isDeferredProfessorAnswer(preview.text))
                    return (
                      <li key={question.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-start gap-2">
                          <span className="data-num shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
                            {String(position + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="line-clamp-2 text-sm text-foreground">
                              {question.number ? `${question.number}. ` : ''}
                              {question.prompt}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={value === undefined ? NONE : String(value)}
                                onValueChange={(next) =>
                                  setSelections((prev) => ({
                                    ...prev,
                                    [question.id]: next === NONE ? undefined : Number(next),
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 w-full max-w-lg">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>{t('homework.answer.noneOption')}</SelectItem>
                                  {entries.map((entry, index) => (
                                    <SelectItem key={index} value={String(index)}>
                                      {answerLabel(entry, index)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {value === undefined ? (
                                <Badge variant="outline">{t('homework.answer.status.none')}</Badge>
                              ) : (
                                <Badge variant="default">{t('homework.answer.status.matched')}</Badge>
                              )}
                            </div>
                            {value === undefined && reason && (
                              summary.unsplit && reason === 'answer-number-missing' ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  {t('homework.answer.reason.unsplit')}
                                </p>
                              ) : REASON_KEYS[reason] ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  {t(REASON_KEYS[reason]!)}
                                </p>
                              ) : null
                            )}
                            {deferredAnswer && (
                              <p className="text-xs text-muted-foreground">{t('homework.answer.deferredAnswer')}</p>
                            )}
                            {!deferredAnswer && question.generationStatus === 'failed' && question.generationError && (
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs text-destructive">
                                  {t('homework.answer.questionGenerationFailed')}: {question.generationError}
                                </p>
                                {question.answerStatus === 'matched' && (
                                  <Button variant="outline" size="sm" disabled={busy}
                                    onClick={() => void handleRetryQuestion(question.id)}>
                                    <RefreshCw className="h-4 w-4" />
                                    {t('homework.answer.retryQuestion')}
                                  </Button>
                                )}
                              </div>
                            )}
                            {preview && (
                              <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
                                <p className="mb-1 text-xs text-muted-foreground">
                                  {t('homework.answer.preview')} · {pageLabel(preview)}
                                </p>
                                <RichText
                                  text={preview.text}
                                  format="plain"
                                  className="max-h-40 overflow-y-auto"
                                  paragraphClassName="text-sm leading-relaxed"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>

                {unmatched > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('homework.answer.unmatched', { count: unmatched })}
                  </p>
                )}
              </>
            )}

            {!manualMode && (
              <div className="flex flex-wrap items-center gap-2">
                {documentType === 'pdf' && (
                  confirmReprocess ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {t('homework.answer.reprocessHint')}
                      <Button size="sm" onClick={() => void handleReprocess()} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {t('homework.answer.reprocessConfirm')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmReprocess(false)} disabled={busy}>
                        {t('common.cancel')}
                      </Button>
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setConfirmReprocess(true)} disabled={busy}>
                      <RefreshCw className="h-4 w-4" />
                      {t('homework.answer.reprocess')}
                    </Button>
                  )
                )}
                <Button variant="outline" size="sm" onClick={onRequestUpload} disabled={busy}>
                  {t('homework.answer.replace')}
                </Button>
                <Button variant="outline" size="sm" onClick={openManual} disabled={busy || !ready}>
                  <Scissors className="h-4 w-4" />
                  {t('homework.answer.manualSplit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleUnlink(false)}
                  disabled={busy}
                >
                  <Unlink className="h-4 w-4" />
                  {t('homework.answer.unlink')}
                </Button>
                {confirmDelete ? (
                  <span className="flex items-center gap-2 text-xs text-destructive">
                    {t('homework.answer.deleteFileHint')}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleUnlink(true)}
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('homework.answer.deleteFile')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                      {t('common.cancel')}
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('homework.answer.deleteFile')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy && generationProgress === null}>
            {t('common.close')}
          </Button>
          {set.answerDocumentId && ready && !manualMode && (
            <>
              <Button
                variant="outline"
                onClick={() => void handleSave()}
                disabled={busy || duplicateSelection}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('homework.answer.confirm')}
              </Button>
              <Button onClick={() => void handleSaveAndGenerate()} disabled={busy || duplicateSelection}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {t('homework.answer.confirmAndGenerate')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

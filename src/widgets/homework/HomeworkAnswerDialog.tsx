import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  Unlink,
  Wand2,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
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

/**
 * Reviews and confirms the mapping between a homework's questions and the
 * linked professor answer file, then triggers answer-based generation.
 *
 * Only one-to-one number matches are proposed automatically. The student can
 * assign or clear any row; a cleared/unconfirmed row is never used to generate.
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
  const [entries, setEntries] = useState<Array<{ number?: string; text: string }>>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [unmatched, setUnmatched] = useState(0)
  const [selections, setSelections] = useState<Selections>({})
  const [documentName, setDocumentName] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      setDocumentName(mapping.document?.name ?? null)
      setDocumentStatus(mapping.document?.status ?? null)

      const nextSelections: Selections = {}
      const nextReasons: Record<string, string> = {}
      for (const assignment of mapping.result.assignments) {
        nextReasons[assignment.questionId] = assignment.reason
        if (assignment.status === 'matched') nextSelections[assignment.questionId] = assignment.answerIndex
      }
      setSelections(nextSelections)
      setReasons(nextReasons)
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
    try {
      const matched = await save()
      if (matched === 0) {
        setNotice(t('homework.answer.unmatched', { count: 0 }))
        return
      }
      const result = await service.generateAnswerContent(set.id)
      onChanged()
      // Reload first: `load()` clears the notice, so set it afterwards.
      await load()
      setNotice(
        result.failed > 0
          ? t('homework.answer.generatedPartial', { generated: result.generated, failed: result.failed })
          : t('homework.answer.generated', { generated: result.generated }),
      )
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
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

  const ready = documentStatus === 'ready'
  const answerLabel = (entry: { number?: string; text: string }, index: number): string => {
    const head = entry.text.replace(/\s+/g, ' ').slice(0, 60)
    return `${entry.number ? `#${entry.number} ` : `#${index + 1} `}${head}`
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {t('homework.answer.title')}
          </DialogTitle>
          <DialogDescription>{t('homework.answer.subtitle')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            {notice}
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
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
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium">{t('homework.answer.previewTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('homework.answer.previewHint')}</p>
                </div>

                {entries.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('homework.answer.emptyEntries')}</p>
                )}

                <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                  {questions.map((question, position) => {
                    const value = selections[question.id]
                    const reason = reasons[question.id]
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
                            {value === undefined && reason && REASON_KEYS[reason] && (
                              <p className="text-xs text-amber-600 dark:text-amber-400">
                                {t(REASON_KEYS[reason]!)}
                              </p>
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

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRequestUpload} disabled={busy}>
                {t('homework.answer.replace')}
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.close')}
          </Button>
          {set.answerDocumentId && ready && (
            <>
              <Button variant="outline" onClick={() => void handleSave()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('homework.answer.confirm')}
              </Button>
              <Button onClick={() => void handleSaveAndGenerate()} disabled={busy}>
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

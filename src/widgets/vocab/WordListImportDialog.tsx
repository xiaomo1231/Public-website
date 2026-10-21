import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
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
import { Progress } from '@/shared/ui/Progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { useDocuments } from '@/features/documents/useDocuments'
import { toast } from '@/features/toast/toastStore'
import { buildAIServices } from '@/services/aiServices'
import { TextbookWordListService, type WordListCandidate } from '@/services/textbookWordList'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

/** Rows shown per page of the confirmation list (long textbook lists have 1000+ words). */
export const WORD_LIST_PAGE_SIZE = 100

export interface WordListImportDialogProps {
  projectId: string
  /** The document to read; when absent the student picks one of the course's processed files. */
  documentId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the confirmed entries were saved. */
  onImported?: () => void
}

/**
 * 「导入课本词表」: read a textbook's word list with the AI, show every entry
 * (grouped by lesson, meaning editable, untick to skip), and merge the
 * confirmed ones into the course's vocabulary book.
 */
export function WordListImportDialog({
  projectId,
  documentId,
  open,
  onOpenChange,
  onImported,
}: WordListImportDialogProps): JSX.Element {
  const { t } = useTranslation()
  const { documents } = useDocuments(open && !documentId ? projectId : undefined)
  const ready = documents.filter((doc) => doc.status === 'ready')
  const [chosen, setChosen] = useState<string>(documentId ?? '')
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'saving'>('idle')
  const [progress, setProgress] = useState(0)
  const [rows, setRows] = useState<WordListCandidate[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [failedParts, setFailedParts] = useState(0)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      abort.current?.abort()
      setPhase('idle')
      setRows([])
      setSkipped(new Set())
      setPage(0)
      setProgress(0)
      setFailedParts(0)
    } else if (documentId) {
      setChosen(documentId)
    }
  }, [open, documentId])

  const read = async () => {
    if (!chosen) return
    const controller = new AbortController()
    abort.current = controller
    setPhase('reading')
    setProgress(0)
    try {
      const bundle = await buildAIServices()
      const result = await new TextbookWordListService({ ai: bundle?.ai ?? null }).split(
        projectId,
        chosen,
        {
          signal: controller.signal,
          onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
        },
      )
      setRows(result.candidates)
      setFailedParts(result.failedParts)
      setSkipped(new Set())
      setPage(0)
      setPhase('review')
    } catch (err) {
      if (controller.signal.aborted) return
      toast({ variant: 'error', title: t('wordList.failed'), description: friendlyAIError(err) })
      setPhase('idle')
    }
  }

  const save = async () => {
    setPhase('saving')
    try {
      const result = await new TextbookWordListService().merge(
        projectId,
        rows.filter((row) => !skipped.has(row.id)),
      )
      toast({
        variant: 'success',
        title: t('wordList.saved', { added: result.added, updated: result.updated }),
      })
      onImported?.()
      onOpenChange(false)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('wordList.saveFailed'),
        description: friendlyAIError(err),
      })
      setPhase('review')
    }
  }

  const pages = Math.max(1, Math.ceil(rows.length / WORD_LIST_PAGE_SIZE))
  const visible = rows.slice(page * WORD_LIST_PAGE_SIZE, (page + 1) * WORD_LIST_PAGE_SIZE)
  const included = rows.length - skipped.size
  // Rows of this page grouped by lesson, in textbook order.
  const groups = useMemo(() => {
    const result: Array<{ lesson: string; rows: WordListCandidate[] }> = []
    for (const row of visible) {
      const lesson = row.lesson ?? ''
      const last = result[result.length - 1]
      if (last && last.lesson === lesson) last.rows.push(row)
      else result.push({ lesson, rows: [row] })
    }
    return result
  }, [visible])

  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const editGloss = (id: string, gloss: string) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, gloss } : row)))

  return (
    <Dialog open={open} onOpenChange={(next) => phase !== 'saving' && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('wordList.title')}</DialogTitle>
          <DialogDescription>{t('wordList.description')}</DialogDescription>
        </DialogHeader>

        {(phase === 'idle' || phase === 'reading') && (
          <div className="space-y-4">
            {!documentId && (
              <div className="space-y-2">
                <Label htmlFor="word-list-document">{t('wordList.document')}</Label>
                <Select value={chosen} onValueChange={setChosen} disabled={phase === 'reading'}>
                  <SelectTrigger id="word-list-document">
                    <SelectValue placeholder={t('wordList.documentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {ready.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ready.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('wordList.noDocuments')}</p>
                )}
              </div>
            )}
            {phase === 'reading' && (
              <div className="space-y-1" aria-live="polite">
                <Progress value={progress} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {t('wordList.reading', { percent: progress })}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('wordList.privacy')}</p>
          </div>
        )}

        {(phase === 'review' || phase === 'saving') && (
          <div className="space-y-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('wordList.none')}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="data-num text-muted-foreground">
                    {t('wordList.count', { included, total: rows.length })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSkipped(new Set())}>
                    {t('wordList.selectAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSkipped(new Set(rows.map((row) => row.id)))}
                  >
                    {t('wordList.selectNone')}
                  </Button>
                </div>
                {failedParts > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('wordList.partsFailed', { count: failedParts })}
                  </p>
                )}
                <div className="max-h-[55vh] overflow-y-auto border-y border-border lab:border">
                  {groups.map((group, g) => (
                    <section key={`${group.lesson}-${g}`} aria-label={group.lesson || undefined}>
                      {group.lesson && (
                        <h3 className="sticky top-0 z-[1] bg-background px-2 py-1.5 text-xs font-semibold text-muted-foreground lecture:font-heading lab:font-mono lab:uppercase">
                          {group.lesson}
                        </h3>
                      )}
                      <ul className="divide-y divide-border/60">
                        {group.rows.map((row) => {
                          const include = !skipped.has(row.id)
                          const head = row.article ? `${row.article} ${row.term}` : row.term
                          return (
                            <li key={row.id} className="flex items-center gap-3 px-2 py-1.5">
                              <input
                                type="checkbox"
                                className="focus-ring h-4 w-4 shrink-0 accent-primary"
                                checked={include}
                                onChange={() => toggle(row.id)}
                                aria-label={t('wordList.include', { term: head })}
                              />
                              <span
                                translate="no"
                                className="notranslate w-44 shrink-0 truncate text-sm font-medium"
                                title={row.context?.text}
                              >
                                {head}
                                {row.plural && (
                                  <span className="ml-1 font-normal text-muted-foreground">
                                    , die {row.plural}
                                  </span>
                                )}
                              </span>
                              <Input
                                value={row.gloss}
                                disabled={!include || phase === 'saving'}
                                onChange={(event) => editGloss(row.id, event.target.value)}
                                aria-label={t('wordList.gloss', { term: head })}
                                className="h-8"
                              />
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
                {pages > 1 && (
                  <nav
                    aria-label={t('wordList.pages')}
                    className="flex items-center justify-center gap-2 text-sm"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      {t('common.previous')}
                    </Button>
                    <span className="data-num text-muted-foreground">
                      {page + 1} / {pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t('common.next')}
                    </Button>
                  </nav>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={phase === 'saving'}
          >
            {t('common.cancel')}
          </Button>
          {phase === 'review' || phase === 'saving' ? (
            <Button
              onClick={() => void save()}
              disabled={
                phase === 'saving' ||
                included === 0 ||
                rows.some((r) => !skipped.has(r.id) && !r.gloss.trim())
              }
            >
              {phase === 'saving' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('wordList.confirm', { count: included })}
            </Button>
          ) : (
            <Button onClick={() => void read()} disabled={!chosen || phase === 'reading'}>
              {phase === 'reading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
              {t('wordList.read')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

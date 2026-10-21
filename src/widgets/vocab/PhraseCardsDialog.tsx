import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessagesSquare } from 'lucide-react'
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
import { Progress } from '@/shared/ui/Progress'
import { toast } from '@/features/toast/toastStore'
import { buildAIServices } from '@/services/aiServices'
import { PHRASE_KINDS, PhraseCardService, type PhraseCandidate } from '@/services/phraseCards'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation, type TranslationKey } from '@/i18n'

const PAGE_SIZE = 100

const KIND_LABEL_KEYS: Record<PhraseCandidate['kind'], TranslationKey> = {
  question: 'phrases.kind.question',
  answer: 'phrases.kind.answer',
  expression: 'phrases.kind.expression',
}

export interface PhraseCardsDialogProps {
  projectId: string
  /** The language the course teaches (for `lang` on the phrases). */
  language?: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

/**
 * Phrase cards from the textbook's dialogues: the AI picks phrases, the
 * student checks them (edit the prompt, untick to skip, optionally add the
 * reverse cards) and the confirmed ones become review cards.
 */
export function PhraseCardsDialog({
  projectId,
  language,
  open,
  onOpenChange,
  onSaved,
}: PhraseCardsDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'saving'>('idle')
  const [progress, setProgress] = useState(0)
  const [rows, setRows] = useState<PhraseCandidate[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [reverse, setReverse] = useState(false)
  const [page, setPage] = useState(0)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) return
    abort.current?.abort()
    setPhase('idle')
    setRows([])
    setSkipped(new Set())
    setPage(0)
    setReverse(false)
  }, [open])

  const read = async () => {
    const controller = new AbortController()
    abort.current = controller
    setPhase('reading')
    setProgress(0)
    try {
      const bundle = await buildAIServices()
      const found = await new PhraseCardService({ ai: bundle?.ai ?? null }).extract(projectId, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      })
      setRows(found)
      setPhase('review')
    } catch (err) {
      if (controller.signal.aborted) return
      toast({ variant: 'error', title: t('phrases.failed'), description: friendlyAIError(err) })
      setPhase('idle')
    }
  }

  const save = async () => {
    setPhase('saving')
    try {
      const added = await new PhraseCardService().save(
        projectId,
        rows.filter((row) => !skipped.has(row.id)),
        { reverse },
      )
      toast({ variant: 'success', title: t('phrases.saved', { count: added }) })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast({ variant: 'error', title: t('phrases.saveFailed'), description: friendlyAIError(err) })
      setPhase('review')
    }
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const included = rows.length - skipped.size
  const groups = useMemo(
    () =>
      PHRASE_KINDS.map((kind) => ({
        kind,
        rows: visible.filter((row) => row.kind === kind),
      })).filter((group) => group.rows.length > 0),
    [visible],
  )
  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={(next) => phase !== 'saving' && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('phrases.title')}</DialogTitle>
          <DialogDescription>{t('phrases.description')}</DialogDescription>
        </DialogHeader>

        {phase === 'reading' && (
          <div className="space-y-1" aria-live="polite">
            <Progress value={progress} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              {t('phrases.reading', { percent: progress })}
            </p>
          </div>
        )}

        {(phase === 'review' || phase === 'saving') &&
          (rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('phrases.none')}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="data-num text-muted-foreground">
                  {t('wordList.count', { included, total: rows.length })}
                </span>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="focus-ring h-4 w-4 accent-primary"
                    checked={reverse}
                    onChange={(event) => setReverse(event.target.checked)}
                  />
                  {t('phrases.reverse')}
                </label>
              </div>
              <div className="max-h-[55vh] overflow-y-auto border-y border-border lab:border">
                {groups.map((group) => (
                  <section key={group.kind} aria-label={t(KIND_LABEL_KEYS[group.kind])}>
                    <h3 className="sticky top-0 z-[1] bg-background px-2 py-1.5 text-xs font-semibold text-muted-foreground lecture:font-heading lab:font-mono lab:uppercase">
                      {t(KIND_LABEL_KEYS[group.kind])}
                    </h3>
                    <ul className="divide-y divide-border/60">
                      {group.rows.map((row) => {
                        const include = !skipped.has(row.id)
                        return (
                          <li key={row.id} className="flex items-start gap-3 px-2 py-2">
                            <input
                              type="checkbox"
                              className="focus-ring mt-2 h-4 w-4 shrink-0 accent-primary"
                              checked={include}
                              onChange={() => toggle(row.id)}
                              aria-label={t('wordList.include', { term: row.phrase })}
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <p
                                lang={language}
                                translate="no"
                                className="notranslate text-sm font-medium"
                              >
                                {row.phrase}
                                {row.page !== undefined && (
                                  <span className="data-num ml-2 text-xs font-normal text-muted-foreground">
                                    {t('phrases.page', { page: row.page })}
                                  </span>
                                )}
                              </p>
                              <Input
                                value={row.prompt}
                                disabled={!include || phase === 'saving'}
                                aria-label={t('phrases.promptLabel', { phrase: row.phrase })}
                                className="h-8"
                                onChange={(event) =>
                                  setRows((prev) =>
                                    prev.map((item) =>
                                      item.id === row.id
                                        ? { ...item, prompt: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </div>
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
            </div>
          ))}

        {phase === 'idle' && (
          <p className="text-xs text-muted-foreground">{t('phrases.privacy')}</p>
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
                rows.some((row) => !skipped.has(row.id) && !row.prompt.trim())
              }
            >
              {phase === 'saving' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('phrases.confirm', { count: included })}
            </Button>
          ) : (
            <Button onClick={() => void read()} disabled={phase === 'reading'}>
              {phase === 'reading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessagesSquare className="h-4 w-4" />
              )}
              {t('phrases.read')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

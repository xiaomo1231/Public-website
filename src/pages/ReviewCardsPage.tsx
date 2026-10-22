import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Layers,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { RichText } from '@/shared/ui/RichText'
import { Textarea } from '@/shared/ui/Textarea'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { PhraseCardsDialog } from '@/widgets/vocab/PhraseCardsDialog'
import { useProject } from '@/features/project/useProjects'
import { targetLanguageOf } from '@/shared/lib/language'
import { ReviewCardService, type ReviewStats } from '@/services/reviewCardService'
import {
  DAY_MS,
  advanceSessionQueue,
  previewIntervals,
  type ReviewCard,
  type ReviewGrade,
} from '@/entities/reviewCard/types'
import { toast } from '@/features/toast/toastStore'
import { ProgressiveList } from '@/shared/ui/ProgressiveList'
import { formatNumber, useTranslation, type TranslationKey } from '@/i18n'
import { cn } from '@/shared/lib/utils'

type T = ReturnType<typeof useTranslation>['t']

const GRADES: Array<{
  grade: ReviewGrade
  labelKey: TranslationKey
  variant: 'outline' | 'default'
}> = [
  { grade: 'again', labelKey: 'cards.again', variant: 'outline' },
  { grade: 'hard', labelKey: 'cards.hard', variant: 'outline' },
  { grade: 'good', labelKey: 'cards.good', variant: 'default' },
  { grade: 'easy', labelKey: 'cards.easy', variant: 'outline' },
]

/** "10 分钟", "3 天", "2 个月" — how far a grade pushes the card out. */
function formatSpan(ms: number, t: T): string {
  if (ms < 60 * 60000) return t('cards.spanMinutes', { count: Math.max(1, Math.round(ms / 60000)) })
  const hours = Math.round(ms / (60 * 60000))
  if (hours < 24) return t('cards.spanHours', { count: hours })
  const days = Math.max(1, Math.round(ms / DAY_MS))
  if (days < 31) return t('cards.spanDays', { count: days })
  if (days < 365) return t('cards.spanMonths', { count: Math.round(days / 30) })
  return t('cards.spanYears', { count: Math.round((days / 365) * 10) / 10 })
}

function dueLabel(card: ReviewCard, now: number, t: T): string {
  return card.due <= now
    ? t('cards.dueNow')
    : t('cards.dueIn', { span: formatSpan(card.due - now, t) })
}

export function ReviewCardsPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const service = useMemo(() => new ReviewCardService(), [])
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [generating, setGenerating] = useState(false)
  /** Concepts with a definition: without any, generating offers nothing. */
  const [conceptCount, setConceptCount] = useState<number | null>(null)
  // Review session: the queue is fixed when it starts; "again" re-queues a card.
  const [queue, setQueue] = useState<ReviewCard[] | null>(null)
  /** Times each card was re-queued by "again" in the current session. */
  const repeatsRef = useRef<Map<string, number>>(new Map())
  const [reviewed, setReviewed] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [grading, setGrading] = useState(false)
  const [editing, setEditing] = useState<ReviewCard | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ReviewCard | null>(null)
  // A language course can turn its textbook dialogues into phrase cards.
  const { project } = useProject(projectId)
  const targetLanguage = targetLanguageOf(project)
  const [phrasesOpen, setPhrasesOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) return
    const [list, nextStats, concepts] = await Promise.all([
      service.list(projectId),
      service.stats(projectId),
      service.conceptCount(projectId).catch(() => null),
    ])
    setCards(list.sort((a, b) => a.due - b.due))
    setStats(nextStats)
    setConceptCount(concepts)
  }, [projectId, service])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    refresh()
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh, reloadKey])

  const current = queue?.[0] ?? null

  const startReview = async () => {
    if (!projectId) return
    const due = await service.due(projectId)
    repeatsRef.current = new Map()
    setQueue(due.sort((a, b) => a.due - b.due))
    setReviewed(0)
    setRevealed(false)
  }

  const grade = useCallback(
    async (value: ReviewGrade) => {
      if (!current || grading) return
      setGrading(true)
      try {
        const next = await service.review(current.id, value)
        // "again" re-queues the card, but only a couple of times per session.
        const advanced = advanceSessionQueue(queue ?? [], next, value, repeatsRef.current)
        repeatsRef.current = advanced.repeats
        setQueue(advanced.queue)
        setReviewed((n) => n + 1)
        setRevealed(false)
        await refresh()
      } catch (err) {
        toast({
          variant: 'error',
          title: t('cards.reviewFailed'),
          description: (err as Error).message,
        })
      } finally {
        setGrading(false)
      }
    },
    [current, grading, queue, refresh, service, t],
  )

  // Space reveals the answer; 1–4 rate it.
  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault()
        setRevealed(true)
      } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        void grade(GRADES[Number(event.key) - 1]!.grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, revealed, grade])

  const generate = async () => {
    if (!projectId) return
    setGenerating(true)
    try {
      const added = await service.generateFromConcepts(projectId)
      toast({
        variant: 'success',
        title: added > 0 ? t('cards.generated', { count: added }) : t('cards.generatedNone'),
      })
      await refresh()
    } catch (err) {
      toast({ variant: 'error', title: t('cards.addFailed'), description: (err as Error).message })
    } finally {
      setGenerating(false)
    }
  }

  const save = async (front: string, back: string) => {
    if (!projectId || !editing) return
    if (editing === 'new') await service.addManual(projectId, front, back)
    else await service.update(editing.id, front, back)
    toast({ variant: 'success', title: t('cards.saved') })
    setEditing(null)
    await refresh()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    await service.remove(deleting.id)
    setQueue((q) => q?.filter((card) => card.id !== deleting.id) ?? null)
    setDeleting(null)
    toast({ variant: 'success', title: t('cards.deleted') })
    await refresh()
  }

  if (!projectId) return <div />

  const now = Date.now()
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? cards.filter(
        (card) =>
          card.front.toLowerCase().includes(needle) || card.back.toLowerCase().includes(needle),
      )
    : cards
  const sessionTotal = queue ? reviewed + queue.length : 0

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('cards.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Layers className="h-4 w-4" />
            {t('cards.title')}
          </div>
        }
        description={t('cards.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="cards" />}
        actions={
          <div className="flex flex-wrap gap-2">
            {targetLanguage && (
              <Button variant="outline" onClick={() => setPhrasesOpen(true)}>
                <MessagesSquare className="h-4 w-4" />
                {t('phrases.open')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void generate()}
              disabled={generating || conceptCount === 0}
              title={conceptCount === 0 ? t('cards.noConcepts') : undefined}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t('cards.generate')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              {t('cards.add')}
            </Button>
          </div>
        }
      />
      <PageContent className="space-y-6">
        {loading ? (
          <LoadingState label={t('cards.loading')} />
        ) : error ? (
          <ErrorState
            title={t('cards.loadFailed')}
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-10 w-10" />}
            title={t('cards.empty')}
            description={conceptCount ? t('cards.emptyHint') : t('cards.emptyNoConceptsHint')}
            action={
              // Only actions that work: generating needs concepts with a definition.
              conceptCount ? (
                <Button onClick={() => void generate()} disabled={generating}>
                  <Sparkles className="h-4 w-4" />
                  {t('cards.generate')}
                </Button>
              ) : (
                <Button onClick={() => setEditing('new')}>
                  <Plus className="h-4 w-4" />
                  {t('cards.add')}
                </Button>
              )
            }
          />
        ) : (
          <>
            {queue ? (
              <ReviewSession
                card={current}
                done={reviewed}
                total={sessionTotal}
                revealed={revealed}
                grading={grading}
                onReveal={() => setRevealed(true)}
                onGrade={(g) => void grade(g)}
                onExit={() => setQueue(null)}
                t={t}
              />
            ) : (
              stats && (
                <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-b lecture:border-t-[1.5px] lecture:border-b-border lecture:border-t-foreground lecture:bg-transparent lecture:shadow-none">
                  <CardContent className="grid gap-6 p-6 lecture:px-0 lecture:py-4 lab:gap-0 lab:p-0 sm:grid-cols-4 sm:items-center sm:lab:divide-x xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] [&>*]:lab:px-3.5 [&>*]:lab:py-3">
                    <Stat value={stats.due} label={t('cards.statDue')} strong />
                    <Stat value={stats.total} label={t('cards.statTotal')} />
                    <Stat value={stats.fresh} label={t('cards.statFresh')} />
                    <Stat value={stats.mature} label={t('cards.statMature')} />
                    {/* Own row below the four stats until xl, so the "next card due…"
                        sentence never squeezes them at tablet widths. */}
                    <div className="min-w-0 sm:col-span-4 sm:lab:!border-l-0 sm:lab:border-t xl:col-span-1 xl:lab:!border-l xl:lab:border-t-0">
                      {stats.due > 0 ? (
                        <Button onClick={() => void startReview()}>
                          {t('cards.startReview', { count: stats.due })}
                        </Button>
                      ) : (
                        <p className="break-words text-sm text-muted-foreground">
                          {cards[0]
                            ? t('cards.noneDue', { span: formatSpan(cards[0].due - now, t) })
                            : null}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            )}

            <Card className="lecture:rounded-none lecture:border-0 lecture:bg-transparent lecture:shadow-none">
              <CardHeader className="gap-3 lecture:px-0 lab:border-b lab:px-3.5 lab:py-2.5 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                <div>
                  <CardTitle className="text-base lecture:font-heading lecture:text-[21px] lecture:font-bold lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground">
                    {t('cards.allCards')}
                  </CardTitle>
                  <CardDescription>{t('cards.allCardsHint')}</CardDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('cards.search')}
                    aria-label={t('cards.search')}
                    className="pl-9"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0 lecture:border-t">
                {visible.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                    {t('cards.noMatch')}
                  </p>
                ) : (
                  <ProgressiveList
                    items={visible}
                    pageSize={100}
                    className="divide-y divide-border/70 lecture:divide-border"
                    renderItem={(card) => (
                      <div
                        key={card.id}
                        className="flex items-start gap-3 px-6 py-3 lecture:px-0 lab:px-3.5 lab:py-2.5"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <RichText
                            text={card.front}
                            format="markdown"
                            className="space-y-1"
                            paragraphClassName="text-sm font-medium leading-relaxed lecture:text-[15px]"
                          />
                          {/* A preview: about two lines, the full back shows in review / edit. */}
                          <RichText
                            text={card.back}
                            format="markdown"
                            className="max-h-[3.25rem] space-y-1 overflow-hidden"
                            paragraphClassName="text-sm leading-relaxed text-muted-foreground"
                          />
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">
                              {t(`cards.source.${card.source}` as TranslationKey)}
                            </Badge>
                            <span className="tabular-nums lab:font-mono">
                              {dueLabel(card, now, t)}
                            </span>
                            {card.lapses > 0 && (
                              <span className="tabular-nums lab:font-mono">
                                {t('cards.lapses', { count: card.lapses })}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('cards.edit')}
                          onClick={() => setEditing(card)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('cards.delete')}
                          onClick={() => setDeleting(card)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageContent>

      <CardEditorDialog editing={editing} onClose={() => setEditing(null)} onSave={save} t={t} />
      {projectId && targetLanguage && (
        <PhraseCardsDialog
          projectId={projectId}
          language={targetLanguage}
          open={phrasesOpen}
          onOpenChange={setPhrasesOpen}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('cards.deleteTitle')}
        description={deleting?.front}
        confirmLabel={t('cards.delete')}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </PageContainer>
  )
}

function ReviewSession({
  card,
  done,
  total,
  revealed,
  grading,
  onReveal,
  onGrade,
  onExit,
  t,
}: {
  card: ReviewCard | null
  done: number
  total: number
  revealed: boolean
  grading: boolean
  onReveal: () => void
  onGrade: (grade: ReviewGrade) => void
  onExit: () => void
  t: T
}): JSX.Element {
  if (!card) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <p className="text-lg font-medium">{t('cards.sessionDone')}</p>
          <p className="text-sm text-muted-foreground">
            {t('cards.sessionDoneHint', { count: done })}
          </p>
          <Button onClick={onExit}>{t('cards.backToList')}</Button>
        </CardContent>
      </Card>
    )
  }
  const spans = previewIntervals(card, Date.now())
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums lab:font-mono">{t('cards.progress', { done, total })}</span>
          <Progress value={total ? (done / total) * 100 : 0} className="h-1.5 flex-1" />
          <Button variant="ghost" size="sm" onClick={onExit}>
            {t('cards.endSession')}
          </Button>
        </div>
        <div className="min-h-24 rounded-lg border border-border/70 bg-muted/30 px-5 py-6 lecture:bg-card lab:bg-background">
          {/* The prompt is short and centred; the answer reads left-aligned at a readable width. */}
          <RichText
            text={card.front}
            format="markdown"
            className="space-y-2 text-center"
            paragraphClassName="text-xl font-medium leading-snug lecture:font-heading lecture:text-2xl lecture:font-bold"
          />
          {revealed && (
            <>
              <div className="mx-auto my-4 h-px w-16 bg-border" />
              <RichText
                text={card.back}
                format="markdown"
                className="mx-auto max-w-[70ch] space-y-3 text-left"
                paragraphClassName="text-base leading-relaxed"
              />
            </>
          )}
        </div>
        {revealed ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map(({ grade, labelKey, variant }, i) => (
              <Button
                key={grade}
                variant={variant}
                disabled={grading}
                onClick={() => onGrade(grade)}
                className="h-auto flex-col gap-0.5 py-2"
              >
                <span>
                  {t(labelKey)} <span className="text-xs opacity-60">{i + 1}</span>
                </span>
                <span className="text-xs font-normal opacity-75">
                  {formatSpan(spans[grade], t)}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <Button className="w-full" onClick={onReveal}>
            {t('cards.reveal')}
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">{t('cards.keyboardHint')}</p>
      </CardContent>
    </Card>
  )
}

function CardEditorDialog({
  editing,
  onClose,
  onSave,
  t,
}: {
  editing: ReviewCard | 'new' | null
  onClose: () => void
  onSave: (front: string, back: string) => Promise<void>
  t: T
}): JSX.Element {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) return
    setFront(editing === 'new' ? '' : editing.front)
    setBack(editing === 'new' ? '' : editing.back)
    setError(null)
  }, [editing])

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(front, back)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing === 'new' ? t('cards.add') : t('cards.edit')}</DialogTitle>
          <DialogDescription>{t('cards.editorHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="card-front">{t('cards.front')}</Label>
            <Input
              id="card-front"
              value={front}
              onChange={(event) => setFront(event.target.value)}
              placeholder={t('cards.frontPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-back">{t('cards.back')}</Label>
            <Textarea
              id="card-back"
              value={back}
              onChange={(event) => setBack(event.target.value)}
              rows={5}
              placeholder={t('cards.backPlaceholder')}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !front.trim() || !back.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  value,
  label,
  strong,
}: {
  value: number
  label: string
  strong?: boolean
}): JSX.Element {
  const { language } = useTranslation()
  return (
    <div className="sm:lecture:[&:not(:first-child)]:border-l sm:lecture:[&:not(:first-child)]:pl-6">
      <div
        className={cn(
          'text-3xl font-semibold tabular-nums lecture:font-heading lecture:font-bold lab:font-mono lab:text-[22px] lab:font-medium',
          strong && 'text-theme-primary lecture:text-foreground',
        )}
      >
        {formatNumber(value, language)}
      </div>
      <div className="text-xs text-muted-foreground lecture:text-[13px] lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-wider">
        {label}
      </div>
    </div>
  )
}

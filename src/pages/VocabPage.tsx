import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookA, BookOpenCheck, Flame, GraduationCap, Loader2, Play, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { cn } from '@/shared/lib/utils'
import { StudySession } from '@/widgets/vocab/StudySession'
import { ExportMenu, ImportDialog, WordListDialog } from '@/widgets/vocab/VocabDialogs'
import { MAX_DAILY_NEW, VocabService, type BookSummary, type VocabStats } from '@/services/vocabService'
import { CourseVocabService } from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import { buildAIServices } from '@/services/aiServices'
import { useProjects } from '@/features/project/useProjects'
import { RECOMMENDED_BOOK, type ReviewModePreference, type SessionItem, type VocabCard, type VocabSettings, type WordView } from '@/entities/vocab/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation, type TranslationKey } from '@/i18n'

type T = ReturnType<typeof useTranslation>['t']

const REVIEW_MODES: Array<{ value: ReviewModePreference; labelKey: TranslationKey }> = [
  { value: 'auto', labelKey: 'vocab.reviewMode.auto' },
  { value: 'recognize', labelKey: 'vocab.reviewMode.recognize' },
  { value: 'spell', labelKey: 'vocab.reviewMode.spell' },
  { value: 'dictation', labelKey: 'vocab.reviewMode.dictation' },
]

const bookName = (book: BookSummary, t: T) => (book.nameKey ? t(book.nameKey) : book.name)

export function VocabPage(): JSX.Element {
  const { t } = useTranslation()
  const service = useMemo(() => new VocabService(), [])
  const [settings, setSettings] = useState<VocabSettings | null>(null)
  const [stats, setStats] = useState<VocabStats | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [session, setSession] = useState<SessionItem[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [viewing, setViewing] = useState<BookSummary | null>(null)
  const [deleting, setDeleting] = useState<BookSummary | null>(null)

  const refresh = useCallback(async () => {
    const [s, st, bs] = await Promise.all([service.settings(), service.stats(), service.books()])
    setSettings(s)
    setStats(st)
    setBooks(bs)
  }, [service])

  useEffect(() => {
    setError(false)
    refresh().catch(() => setError(true))
  }, [refresh, reloadKey])

  const refreshStats = useCallback(() => {
    void service.stats().then(setStats)
  }, [service])

  const chooseBook = async (bookId: string) => {
    try {
      setSettings(await service.updateSettings({ bookId }))
      toast({ variant: 'success', title: t('vocab.bookChosen') })
      await refresh()
    } catch (err) {
      toast({ variant: 'error', title: t('vocab.chooseBookFailed'), description: (err as Error).message })
    }
  }

  const start = async (kind: 'today' | 'mistakes') => {
    setStarting(true)
    try {
      const items = kind === 'today' ? await service.session() : await service.mistakeSession()
      if (items.length === 0) {
        toast({ variant: 'info', title: kind === 'today' ? t('vocab.nothingToday') : t('vocab.noMistakes') })
        return
      }
      setSession(items)
    } catch (err) {
      // e.g. the dictionary (public/vocab/dictionary.json) failed to load.
      toast({ variant: 'error', title: t('vocab.startFailed'), description: (err as Error).message })
    } finally {
      setStarting(false)
    }
  }

  if (error) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('vocab.loadFailed')}
            description={t('vocab.loadFailedHint')}
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  const current = books.find((book) => book.id === settings?.bookId)
  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <BookA className="h-4 w-4" />
            {t('vocab.title')}
          </span>
        }
        description={t('vocab.subtitle')}
        actions={
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{t('vocab.importTitle')}</span>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        {!settings || !stats ? (
          <LoadingState label={t('vocab.loading')} />
        ) : session ? (
          <StudySession
            items={session}
            bookId={settings.bookId}
            service={service}
            onProgress={refreshStats}
            onExit={() => {
              setSession(null)
              void refresh()
            }}
          />
        ) : !settings.bookId ? (
          <BookChooser books={books} onChoose={(id) => void chooseBook(id)} t={t} />
        ) : (
          <>
            <TodayCard
              stats={stats}
              settings={settings}
              current={current}
              starting={starting}
              onStart={() => void start('today')}
              onSettings={async (patch) => {
                setSettings(await service.updateSettings(patch))
                refreshStats()
              }}
              t={t}
            />
            <Tabs defaultValue="books">
              <TabsList>
                <TabsTrigger value="books">{t('vocab.tab.books')}</TabsTrigger>
                <TabsTrigger value="course">{t('vocab.tab.course')}</TabsTrigger>
                <TabsTrigger value="mistakes">{t('vocab.tab.mistakes')}</TabsTrigger>
                <TabsTrigger value="stats">{t('vocab.tab.stats')}</TabsTrigger>
              </TabsList>
              <TabsContent value="books" className="pt-4">
                <BookList
                  books={books.filter((book) => book.kind !== 'course')}
                  currentId={settings.bookId}
                  service={service}
                  onChoose={(id) => void chooseBook(id)}
                  onView={setViewing}
                  onDelete={setDeleting}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="course" className="pt-4">
                <CourseVocabPanel
                  books={books.filter((book) => book.kind === 'course')}
                  currentId={settings.bookId}
                  service={service}
                  onChoose={(id) => void chooseBook(id)}
                  onView={setViewing}
                  onChanged={() => void refresh()}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="mistakes" className="pt-4">
                <MistakePanel service={service} starting={starting} onPractice={() => void start('mistakes')} t={t} />
              </TabsContent>
              <TabsContent value="stats" className="pt-4">
                <StatsPanel stats={stats} service={service} t={t} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </PageContent>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        service={service}
        onImported={(bookId) => {
          void (settings?.bookId ? refresh() : chooseBook(bookId))
        }}
      />
      <WordListDialog
        bookId={viewing?.id ?? null}
        title={viewing ? bookName(viewing, t) : ''}
        editable={viewing ? viewing.kind !== 'exam' : false}
        service={service}
        onClose={() => setViewing(null)}
        onChanged={() => void refresh()}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('vocab.deleteBookTitle')}
        description={deleting ? t('vocab.deleteBookHint', { name: bookName(deleting, t) }) : ''}
        confirmLabel={t('vocab.deleteBook')}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          await service.deleteBook(deleting.id)
          setDeleting(null)
          await refresh()
        }}
      />
    </PageContainer>
  )
}

function BookChooser({ books, onChoose, t }: { books: BookSummary[]; onChoose: (id: string) => void; t: T }): JSX.Element {
  const exam = books.filter((book) => book.kind === 'exam')
  const own = books.filter((book) => book.kind !== 'exam')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('vocab.chooseTitle')}</CardTitle>
        <CardDescription>{t('vocab.chooseHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...exam, ...own].map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onChoose(book.id)}
            className={cn(
              'focus-ring space-y-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent/60',
              book.id === RECOMMENDED_BOOK && 'border-theme-primary/60 bg-theme-primary-soft/40',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {bookName(book, t)}
              {book.id === RECOMMENDED_BOOK && <Badge>{t('vocab.recommended')}</Badge>}
            </span>
            <span className="block text-xs text-muted-foreground">{t('vocab.wordCount', { count: book.wordCount })}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

function TodayCard({
  stats,
  settings,
  current,
  starting,
  onStart,
  onSettings,
  t,
}: {
  stats: VocabStats
  settings: VocabSettings
  current: BookSummary | undefined
  starting: boolean
  onStart: () => void
  onSettings: (patch: Partial<VocabSettings>) => Promise<void>
  t: T
}): JSX.Element {
  const [daily, setDaily] = useState(String(settings.dailyNew))
  useEffect(() => setDaily(String(settings.dailyNew)), [settings.dailyNew])
  const newLeft = Math.max(0, stats.dailyNew - stats.newToday)
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="grid gap-6 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-center">
          <Stat value={stats.due} label={t('vocab.stat.due')} strong />
          <Stat value={`${stats.newToday}/${stats.dailyNew}`} label={t('vocab.stat.newToday')} />
          <div>
            <div className="flex items-center gap-1.5 text-3xl font-semibold tabular-nums">
              <Flame className={cn('h-6 w-6', stats.streak > 0 ? 'text-amber-500' : 'text-muted-foreground')} />
              {stats.streak}
            </div>
            <div className="text-xs text-muted-foreground">{t('vocab.stat.streak')}</div>
          </div>
          <Button onClick={onStart} disabled={starting || (stats.due === 0 && newLeft === 0)}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {stats.due === 0 && newLeft === 0 ? t('vocab.allDone') : t('vocab.start', { review: stats.due, fresh: newLeft })}
          </Button>
        </div>
        <div className="grid gap-4 border-t border-border/70 pt-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>{t('vocab.currentBook')}</Label>
            <p className="text-sm">
              {current ? (current.nameKey ? t(current.nameKey) : current.name) : '—'}
              {current && <span className="ml-2 text-xs text-muted-foreground">{t('vocab.bookProgress', { learned: current.learned, total: current.wordCount })}</span>}
            </p>
            {current && <Progress value={current.wordCount ? (current.learned / current.wordCount) * 100 : 0} className="h-1" />}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vocab-daily">{t('vocab.dailyNew')}</Label>
            <Input
              id="vocab-daily"
              type="number"
              min={1}
              max={MAX_DAILY_NEW}
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
              onBlur={() => {
                const value = Number(daily)
                if (Number.isFinite(value) && value >= 1 && value !== settings.dailyNew) void onSettings({ dailyNew: value })
                else setDaily(String(settings.dailyNew))
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vocab-mode">{t('vocab.reviewModeLabel')}</Label>
            <Select value={settings.reviewMode} onValueChange={(value) => void onSettings({ reviewMode: value as ReviewModePreference })}>
              <SelectTrigger id="vocab-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {t(mode.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ value, label, strong }: { value: number | string; label: string; strong?: boolean }): JSX.Element {
  return (
    <div>
      <div className={cn('text-3xl font-semibold tabular-nums', strong && 'text-theme-primary')}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function BookRow({
  book,
  current,
  service,
  onChoose,
  onView,
  onDelete,
  t,
}: {
  book: BookSummary
  current: boolean
  service: VocabService
  onChoose: (id: string) => void
  onView: (book: BookSummary) => void
  onDelete?: (book: BookSummary) => void
  t: T
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {bookName(book, t)}
          {current && <Badge variant="outline">{t('vocab.current')}</Badge>}
          {book.id === RECOMMENDED_BOOK && !current && <Badge variant="outline">{t('vocab.recommended')}</Badge>}
        </p>
        <div className="flex items-center gap-2">
          <Progress value={book.wordCount ? (book.learned / book.wordCount) * 100 : 0} className="h-1 max-w-48 flex-1" />
          <span className="text-xs tabular-nums text-muted-foreground">{t('vocab.bookProgress', { learned: book.learned, total: book.wordCount })}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => onView(book)}>
          {t('vocab.viewWords')}
        </Button>
        <ExportMenu service={service} target={{ bookId: book.id }} disabled={book.wordCount === 0} />
        {!current && (
          <Button variant="outline" size="sm" onClick={() => onChoose(book.id)} disabled={book.wordCount === 0}>
            {t('vocab.useBook')}
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" aria-label={t('vocab.deleteBook')} onClick={() => onDelete(book)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function BookList({
  books,
  currentId,
  service,
  onChoose,
  onView,
  onDelete,
  t,
}: {
  books: BookSummary[]
  currentId: string | null
  service: VocabService
  onChoose: (id: string) => void
  onView: (book: BookSummary) => void
  onDelete: (book: BookSummary) => void
  t: T
}): JSX.Element {
  return (
    <Card>
      <CardContent className="divide-y divide-border/70 p-0">
        {books.map((book) => (
          <BookRow
            key={book.id}
            book={book}
            current={book.id === currentId}
            service={service}
            onChoose={onChoose}
            onView={onView}
            {...(book.kind === 'custom' ? { onDelete } : {})}
            t={t}
          />
        ))}
      </CardContent>
      <p className="px-6 pb-4 text-xs text-muted-foreground">{t('vocab.dictionarySource')}</p>
    </Card>
  )
}

function CourseVocabPanel({
  books,
  currentId,
  service,
  onChoose,
  onView,
  onChanged,
  t,
}: {
  books: BookSummary[]
  currentId: string | null
  service: VocabService
  onChoose: (id: string) => void
  onView: (book: BookSummary) => void
  onChanged: () => void
  t: T
}): JSX.Element {
  const { projects, loading } = useProjects()
  const [running, setRunning] = useState<string | null>(null)

  const extract = async (projectId: string) => {
    setRunning(projectId)
    try {
      const bundle = await buildAIServices()
      const result = await new CourseVocabService({ projects: new ProjectService(), ai: bundle?.ai ?? null }).extract(projectId)
      toast({
        variant: 'success',
        title: t('vocab.course.done', { total: result.total, added: result.added }),
        description: !bundle
          ? t('vocab.course.noAi', { count: result.unglossed })
          : result.unglossed
            ? t('vocab.course.unglossed', { count: result.unglossed })
            : t('vocab.course.glossed', { count: result.glossed }),
      })
      onChanged()
    } catch (err) {
      toast({ variant: 'error', title: t('vocab.course.failed'), description: friendlyAIError(err) })
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <LoadingState label={t('vocab.loading')} />
  if (projects.length === 0) {
    return <EmptyState icon={<GraduationCap className="h-10 w-10" />} title={t('vocab.course.noProjects')} description={t('vocab.course.noProjectsHint')} />
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('vocab.course.title')}</CardTitle>
        <CardDescription>{t('vocab.course.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/70 p-0">
        {projects.map((project) => {
          const book = books.find((item) => item.projectId === project.id)
          return (
            <div key={project.id}>
              <div className="flex flex-wrap items-center gap-3 px-6 py-3">
                <p className="min-w-0 flex-1 text-sm font-medium">{project.name}</p>
                <Button variant="outline" size="sm" disabled={running !== null} onClick={() => void extract(project.id)}>
                  {running === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {book ? t('vocab.course.update') : t('vocab.course.extract')}
                </Button>
              </div>
              {book && (
                <BookRow book={book} current={book.id === currentId} service={service} onChoose={onChoose} onView={onView} t={t} />
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function MistakePanel({ service, starting, onPractice, t }: { service: VocabService; starting: boolean; onPractice: () => void; t: T }): JSX.Element {
  const [items, setItems] = useState<Array<{ view: WordView; card: VocabCard }> | null>(null)
  const load = useCallback(() => void service.mistakes().then(setItems), [service])
  useEffect(load, [load])
  if (!items) return <LoadingState label={t('vocab.loading')} />
  if (items.length === 0) {
    return <EmptyState icon={<BookOpenCheck className="h-10 w-10" />} title={t('vocab.noMistakes')} description={t('vocab.noMistakesHint')} />
  }
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="text-base">{t('vocab.mistakesTitle', { count: items.length })}</CardTitle>
          <CardDescription>{t('vocab.mistakesHint')}</CardDescription>
        </div>
        <div className="flex gap-2">
          <ExportMenu service={service} target="mistakes" />
          <Button size="sm" onClick={onPractice} disabled={starting}>
            <Play className="h-4 w-4" />
            {t('vocab.practiceMistakes')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border/70 p-0">
        {items.map(({ view, card }) => (
          <div key={view.word} className="flex items-start gap-3 px-6 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span translate="no" className="notranslate font-medium">
                  {view.word}
                </span>
                <span className="ml-2 text-xs text-destructive">{t('vocab.mistakeCount', { count: card.mistakes })}</span>
              </p>
              <p className="text-sm text-muted-foreground">{view.meanings.join('；') || t('vocab.noMeaning')}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('vocab.clearMistake')}
              onClick={async () => {
                await service.clearMistakes(view.word)
                load()
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function StatsPanel({ stats, service, t }: { stats: VocabStats; service: VocabService; t: T }): JSX.Element {
  const max = Math.max(1, ...stats.forecast)
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <CardTitle className="text-base">{t('vocab.tab.stats')}</CardTitle>
        <ExportMenu service={service} target="learned" disabled={stats.learned === 0} />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-4">
          <Stat value={stats.learned} label={t('vocab.stat.learned')} />
          <Stat value={stats.mature} label={t('vocab.stat.mature')} />
          <Stat value={stats.reviewsToday} label={t('vocab.stat.reviewsToday')} />
          <Stat value={stats.streak} label={t('vocab.stat.streak')} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('vocab.forecast')}</p>
          <div className="flex h-28 items-end gap-2">
            {stats.forecast.map((count, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                <div className="w-full rounded-t bg-theme-primary/70" style={{ height: `${Math.max(2, (count / max) * 80)}px` }} />
                <span className="text-[11px] text-muted-foreground">{i === 0 ? t('vocab.today') : t('vocab.inDays', { count: i })}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

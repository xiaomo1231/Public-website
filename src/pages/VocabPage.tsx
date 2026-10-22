import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BookA,
  BookOpen,
  BookOpenCheck,
  FileText,
  GraduationCap,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
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
import { useThemeStore } from '@/features/theme/themeStore'
import { StudySession } from '@/widgets/vocab/StudySession'
import { ExportMenu, ImportDialog, WordListDialog } from '@/widgets/vocab/VocabDialogs'
import { WordListImportDialog } from '@/widgets/vocab/WordListImportDialog'
import { languageName, targetLanguageOf } from '@/shared/lib/language'
import {
  MAX_DAILY_NEW,
  VocabService,
  type BookSummary,
  type VocabStats,
} from '@/services/vocabService'
import { CourseVocabService } from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import { buildAIServices } from '@/services/aiServices'
import { withUsageKind } from '@/services/aiService'
import { useProjects } from '@/features/project/useProjects'
import {
  RECOMMENDED_BOOK,
  type ReviewModePreference,
  type SessionItem,
  type VocabCard,
  type VocabSettings,
  type WordView,
} from '@/entities/vocab/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { formatNumber, useTranslation, type TranslationKey } from '@/i18n'

type T = ReturnType<typeof useTranslation>['t']

const REVIEW_MODES: Array<{ value: ReviewModePreference; labelKey: TranslationKey }> = [
  { value: 'auto', labelKey: 'vocab.reviewMode.auto' },
  { value: 'recognize', labelKey: 'vocab.reviewMode.recognize' },
  { value: 'spell', labelKey: 'vocab.reviewMode.spell' },
  { value: 'dictation', labelKey: 'vocab.reviewMode.dictation' },
]

const bookName = (book: BookSummary, t: T) => (book.nameKey ? t(book.nameKey) : book.name)

/** Lecture sets panels straight on the page, separated by rules; lab keeps the hairline box. */
const FLAT_IN_LECTURE =
  'lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:shadow-none'
const PANEL_HEAD = 'lecture:px-0 lab:border-b lab:px-3.5 lab:py-3'
const PANEL_TITLE =
  'text-base lecture:font-heading lecture:text-lg lecture:font-bold lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground'

export function VocabPage(): JSX.Element {
  const { t } = useTranslation()
  const service = useMemo(() => new VocabService(), [])
  const [settings, setSettings] = useState<VocabSettings | null>(null)
  const [stats, setStats] = useState<VocabStats | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [session, setSession] = useState<SessionItem[] | null>(null)
  const [sessionKind, setSessionKind] = useState<'today' | 'mistakes'>('today')
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
    // A failed read keeps the last numbers on screen.
    void service
      .stats()
      .then(setStats)
      .catch(() => undefined)
  }, [service])

  const chooseBook = async (bookId: string) => {
    try {
      setSettings(await service.updateSettings({ bookId }))
      toast({ variant: 'success', title: t('vocab.bookChosen') })
      await refresh()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('vocab.chooseBookFailed'),
        description: (err as Error).message,
      })
    }
  }

  const start = async (kind: 'today' | 'mistakes') => {
    setStarting(true)
    try {
      const items = kind === 'today' ? await service.session() : await service.mistakeSession()
      if (items.length === 0) {
        toast({
          variant: 'info',
          title: kind === 'today' ? t('vocab.nothingToday') : t('vocab.noMistakes'),
        })
        return
      }
      setSessionKind(kind)
      setSession(items)
    } catch (err) {
      // e.g. the dictionary (public/vocab/dictionary.json) failed to load.
      toast({
        variant: 'error',
        title: t('vocab.startFailed'),
        description: (err as Error).message,
      })
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
  // In lecture the today sentence below is the page's visible title.
  const showToday = Boolean(settings && stats && !session && settings.bookId)
  return (
    <PageContainer>
      <PageHeader
        className={
          showToday ? 'lecture:pb-0 lecture:[&_h1]:sr-only lecture:[&_h1~p]:hidden' : undefined
        }
        title={
          <span className="flex items-center gap-2">
            <BookA className="h-4 w-4 lecture:hidden" />
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
            {...(sessionKind === 'mistakes'
              ? { sourceLabel: t('vocab.tab.mistakes') }
              : current
                ? { sourceLabel: bookName(current, t) }
                : {})}
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
                try {
                  setSettings(await service.updateSettings(patch))
                } catch {
                  toast({ variant: 'error', title: t('settings.saveFailed') })
                  return
                }
                refreshStats()
              }}
              service={service}
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
                <MistakePanel
                  service={service}
                  starting={starting}
                  onPractice={() => void start('mistakes')}
                  t={t}
                />
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

function BookChooser({
  books,
  onChoose,
  t,
}: {
  books: BookSummary[]
  onChoose: (id: string) => void
  t: T
}): JSX.Element {
  const exam = books.filter((book) => book.kind === 'exam')
  const own = books.filter((book) => book.kind !== 'exam')
  return (
    <Card className={FLAT_IN_LECTURE}>
      <CardHeader className={PANEL_HEAD}>
        <CardTitle className={PANEL_TITLE}>{t('vocab.chooseTitle')}</CardTitle>
        <CardDescription>{t('vocab.chooseHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lecture:px-0 lab:p-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
            <span className="block text-xs text-muted-foreground">
              {t('vocab.wordCount', { count: book.wordCount, n: formatNumber(book.wordCount) })}
            </span>
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
  service,
  t,
}: {
  stats: VocabStats
  service: VocabService
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
  const allDone = stats.due === 0 && newLeft === 0
  const [mistakeCount, setMistakeCount] = useState<number | null>(null)
  // The mistake count is only shown in the lab readout; lecture skips the load.
  const lab = useThemeStore((s) => s.uiStyle) === 'lab'
  useEffect(() => {
    if (!lab) return
    let alive = true
    void service
      .mistakes()
      .then((items) => alive && setMistakeCount(items.length))
      .catch(() => alive && setMistakeCount(null))
    return () => {
      alive = false
    }
  }, [service, stats, lab])
  const { language } = useTranslation()
  // Two-digit readouts ("07"); larger values get locale grouping (14,912).
  const pad = (value: number) =>
    value < 10 ? String(value).padStart(2, '0') : formatNumber(value, language)
  return (
    <Card className="lecture:rounded-none lecture:border-0 lecture:bg-transparent lecture:shadow-none lab:border-0 lab:bg-transparent">
      <CardContent className="space-y-5 p-6 lecture:p-0 lab:p-0">
        {/* Lecture: today's work as one sentence, set as the page's serif title. */}
        <div className="hidden space-y-2 lecture:block">
          <p aria-hidden className="text-xs tracking-[0.14em] text-primary">
            {t('vocab.title')}
          </p>
          <h2 className="font-heading text-[30px] font-bold leading-snug text-foreground">
            {allDone
              ? t('vocab.allDone')
              : t('vocab.todaySentence', {
                  // Zero parts are left out; at least one is non-zero here.
                  parts: [
                    stats.due > 0 ? t('vocab.todayReview', { count: stats.due }) : null,
                    newLeft > 0 ? t('vocab.todayNew', { count: newLeft }) : null,
                  ]
                    .filter(Boolean)
                    .join(t('vocab.todayJoin')),
                })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[
              current ? bookName(current, t) : null,
              current
                ? t('vocab.bookProgress', { learned: current.learned, total: current.wordCount })
                : null,
              t('vocab.streakDays', { count: stats.streak }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {/* Lab: a readout strip. */}
        <div className="hidden border bg-card lab:grid lab:grid-cols-2 sm:lab:grid-cols-4">
          <Readout label={t('vocab.stat.due')} value={pad(stats.due)} />
          <Readout
            label={t('vocab.stat.newToday')}
            value={pad(stats.newToday)}
            total={stats.dailyNew}
          >
            <Progress
              value={stats.dailyNew ? (stats.newToday / stats.dailyNew) * 100 : 0}
              className="mt-2.5 h-1"
            />
          </Readout>
          <Readout label={t('vocab.stat.streak')} value={pad(stats.streak)} />
          <Readout
            label={t('vocab.tab.mistakes')}
            value={mistakeCount === null ? '—' : pad(mistakeCount)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onStart}
            disabled={starting || allDone}
            className="lecture:h-10 lecture:px-5"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {allDone ? t('vocab.allDone') : t('vocab.start', { review: stats.due, fresh: newLeft })}
          </Button>
          {stats.dueAllBooks > stats.due && (
            <span className="text-xs text-muted-foreground">
              {t('vocab.dueOtherBooks', { count: stats.dueAllBooks - stats.due })}
            </span>
          )}
        </div>
        <div className="grid gap-4 border-t border-border/70 pt-4 lecture:border-b lecture:pb-4 lab:border lab:bg-card lab:p-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>{t('vocab.currentBook')}</Label>
            <p className="text-sm">
              {current ? (current.nameKey ? t(current.nameKey) : current.name) : '—'}
              {current && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('vocab.bookProgress', { learned: current.learned, total: current.wordCount })}
                </span>
              )}
            </p>
            {current && (
              <Progress
                value={current.wordCount ? (current.learned / current.wordCount) * 100 : 0}
                className="h-1"
              />
            )}
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
                if (Number.isFinite(value) && value >= 1 && value !== settings.dailyNew)
                  void onSettings({ dailyNew: value })
                else setDaily(String(settings.dailyNew))
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vocab-mode">{t('vocab.reviewModeLabel')}</Label>
            <Select
              value={settings.reviewMode}
              onValueChange={(value) =>
                void onSettings({ reviewMode: value as ReviewModePreference })
              }
            >
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

function Stat({
  value,
  label,
  strong,
}: {
  value: number | string
  label: string
  strong?: boolean
}): JSX.Element {
  const { language } = useTranslation()
  return (
    <div className="lecture:border-l lecture:pl-4 lecture:first:border-l-0 lecture:first:pl-0">
      <div
        className={cn(
          'text-3xl font-semibold tabular-nums lecture:font-heading lecture:font-bold lab:font-mono lab:text-[22px] lab:font-medium',
          strong && 'text-theme-primary lecture:text-foreground',
        )}
      >
        {typeof value === 'number' ? formatNumber(value, language) : value}
      </div>
      <div className="text-xs text-muted-foreground lecture:text-[13px] lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-wider">
        {label}
      </div>
    </div>
  )
}

/** One cell of the lab readout strip: mono label, mono value, optional detail. */
function Readout({
  label,
  value,
  total,
  children,
}: {
  label: string
  value: string
  total?: number
  children?: ReactNode
}): JSX.Element {
  const { language } = useTranslation()
  return (
    <div className="border-b border-r px-3.5 py-3 sm:border-b-0 sm:last:!border-r-0 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r [&:nth-child(n+3)]:border-b-0">
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-[22px] font-medium tabular-nums">
        {value}
        {total !== undefined && (
          <small className="text-xs text-muted-foreground">/{formatNumber(total, language)}</small>
        )}
      </p>
      {children}
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
    <div className="flex flex-wrap items-center gap-3 px-6 py-3 lecture:px-0 lab:px-3.5 lab:py-2.5">
      <div className="min-w-0 flex-1 space-y-1 sm:lab:grid sm:lab:grid-cols-[minmax(0,1fr)_6rem_10rem] sm:lab:items-center sm:lab:gap-3 sm:lab:space-y-0">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium lecture:font-heading lecture:text-base">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{bookName(book, t)}</span>
          {current && (
            <Badge
              variant="outline"
              className="shrink-0 lab:border-primary/40 lab:font-mono lab:text-primary"
            >
              {t('vocab.current')}
            </Badge>
          )}
          {book.id === RECOMMENDED_BOOK && !current && (
            <Badge variant="outline" className="shrink-0">
              {t('vocab.recommended')}
            </Badge>
          )}
        </p>
        <span className="hidden font-mono text-[13px] tabular-nums text-muted-foreground sm:lab:block">
          {t('vocab.wordCount', { count: book.wordCount, n: formatNumber(book.wordCount) })}
        </span>
        <div className="flex items-center gap-2 lab:flex-col-reverse lab:items-stretch lab:gap-1">
          <Progress
            value={book.wordCount ? (book.learned / book.wordCount) * 100 : 0}
            className="h-1 max-w-48 flex-1 lab:max-w-none lab:flex-none lab:rounded-none"
          />
          <span className="text-xs tabular-nums text-muted-foreground lab:font-mono">
            {t('vocab.bookProgress', { learned: book.learned, total: book.wordCount })}
          </span>
        </div>
      </div>
      {/* lab: a fixed-width, right-aligned action cell keeps the table columns lined up. */}
      <div className="flex flex-wrap gap-1.5 sm:lab:min-w-[18.5rem] sm:lab:justify-end">
        <Button variant="ghost" size="sm" onClick={() => onView(book)}>
          {t('vocab.viewWords')}
        </Button>
        <ExportMenu
          service={service}
          target={{ bookId: book.id }}
          disabled={book.wordCount === 0}
        />
        {!current && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChoose(book.id)}
            disabled={book.wordCount === 0}
          >
            {t('vocab.useBook')}
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('vocab.deleteBook')}
            onClick={() => onDelete(book)}
          >
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
    <Card className={FLAT_IN_LECTURE}>
      <CardHeader className={PANEL_HEAD}>
        <CardTitle className={PANEL_TITLE}>{t('vocab.tab.books')}</CardTitle>
        <CardDescription>{t('vocab.booksHint')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/70 p-0 lecture:divide-border">
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
      <p className="px-6 pb-4 pt-3 text-xs text-muted-foreground lecture:px-0 lab:px-3.5">
        {t('vocab.dictionarySource')}
      </p>
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
  const { language } = useTranslation()
  const [running, setRunning] = useState<string | null>(null)
  /** The language course whose textbook word list is being imported. */
  const [importFor, setImportFor] = useState<string | null>(null)
  /** Gloss batches done / planned for the running (or last paused) course. */
  const [gloss, setGloss] = useState<{
    projectId: string
    done: number
    total: number
    paused: boolean
    /** `exam`: 考卷高频术语 (parts read), otherwise course words (gloss batches). */
    kind?: 'exam'
  } | null>(null)
  const generation = useGenerationRun()

  /** 从考卷提取高频术语: AI-picked key terms of the course's exam papers. */
  const extractExam = async (projectId: string) => {
    setRunning(projectId)
    const run = generation.start()
    setGloss({ projectId, done: 0, total: 0, paused: false, kind: 'exam' })
    try {
      const bundle = await buildAIServices()
      const result = await new CourseVocabService({
        projects: new ProjectService(),
        ai: withUsageKind(bundle?.ai ?? null, 'vocab'),
      }).extractExamTerms(projectId, {
        control: run,
        onProgress: ({ done, total }) =>
          setGloss({ projectId, done, total, paused: false, kind: 'exam' }),
      })
      run.finish()
      onChanged()
      if (result.paused) {
        setGloss((prev) => (prev ? { ...prev, paused: true } : prev))
        return
      }
      setGloss(null)
      toast({
        variant: result.failed ? 'warning' : 'success',
        title: t('vocab.examTerms.done', { added: result.added, updated: result.updated }),
        ...(result.failed
          ? {
              description: `${t('vocab.examTerms.failedParts', { count: result.failed })} ${friendlyAIError(result.error)}`,
            }
          : {}),
      })
    } catch (err) {
      run.finish()
      setGloss(null)
      toast({
        variant: 'error',
        title: t('vocab.examTerms.failed'),
        description: friendlyAIError(err),
      })
    } finally {
      setRunning(null)
    }
  }

  const extract = async (projectId: string) => {
    setRunning(projectId)
    const run = generation.start()
    setGloss({ projectId, done: 0, total: 0, paused: false })
    try {
      const bundle = await buildAIServices()
      const result = await new CourseVocabService({
        projects: new ProjectService(),
        ai: withUsageKind(bundle?.ai ?? null, 'vocab'),
      }).extract(projectId, {
        control: run,
        onProgress: ({ done, total }) => setGloss({ projectId, done, total, paused: false }),
      })
      run.finish()
      if (result.paused) {
        // The batches glossed so far are saved; 继续 glosses only the rest.
        setGloss((prev) => (prev ? { ...prev, paused: true } : prev))
        onChanged()
        return
      }
      setGloss(null)
      toast({
        variant: 'success',
        title: t('vocab.course.done', { total: result.total, added: result.added }),
        description: !bundle
          ? t('vocab.course.noAi', { count: result.unglossed })
          : result.unglossed
            ? result.glossError !== undefined
              ? `${t('vocab.course.unglossed', { count: result.unglossed })} ${friendlyAIError(result.glossError)}`
              : t('vocab.course.unglossed', { count: result.unglossed })
            : t('vocab.course.glossed', { count: result.glossed }),
      })
      onChanged()
    } catch (err) {
      run.finish()
      setGloss(null)
      toast({
        variant: 'error',
        title: t('vocab.course.failed'),
        description: friendlyAIError(err),
      })
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <LoadingState label={t('vocab.loading')} />
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap className="h-10 w-10" />}
        title={t('vocab.course.noProjects')}
        description={t('vocab.course.noProjectsHint')}
      />
    )
  }
  return (
    <Card className={FLAT_IN_LECTURE}>
      <CardHeader className={PANEL_HEAD}>
        <CardTitle className={PANEL_TITLE}>{t('vocab.course.title')}</CardTitle>
        <CardDescription>{t('vocab.course.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/70 p-0">
        {projects.map((project) => {
          const book = books.find((item) => item.projectId === project.id)
          return (
            <div key={project.id}>
              <div className="flex flex-wrap items-center gap-3 px-6 py-3 lecture:px-0 lab:px-3.5">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium lecture:font-heading lecture:text-base lecture:font-bold">
                    {project.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('vocab.course.sourceLanguage', {
                      language: languageName(targetLanguageOf(project) ?? 'en', language),
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running !== null}
                  onClick={() => void extract(project.id)}
                >
                  {running === project.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {book ? t('vocab.course.update') : t('vocab.course.extract')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running !== null}
                  onClick={() => void extractExam(project.id)}
                  title={t('vocab.examTerms.hint')}
                >
                  <FileText className="h-4 w-4" />
                  {t('vocab.examTerms.open')}
                </Button>
                {targetLanguageOf(project) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => setImportFor(project.id)}
                  >
                    <BookOpen className="h-4 w-4" />
                    {t('wordList.open')}
                  </Button>
                )}
              </div>
              {gloss?.projectId === project.id && (gloss.total > 0 || gloss.paused) && (
                <div className="flex flex-wrap items-center gap-3 px-6 pb-3 lecture:px-0 lab:px-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Progress
                      value={gloss.total > 0 ? Math.round((gloss.done / gloss.total) * 100) : 0}
                      className="h-1.5"
                      aria-label={t(
                        gloss.kind === 'exam' ? 'vocab.examTerms.reading' : 'vocab.course.glossing',
                      )}
                    />
                    <p className="data-num text-xs text-muted-foreground">
                      {t(
                        gloss.kind === 'exam'
                          ? 'vocab.examTerms.progress'
                          : 'vocab.course.glossProgress',
                        { done: gloss.done, total: gloss.total },
                      )}
                    </p>
                  </div>
                  <GenerationControls
                    kind="parts"
                    state={gloss.paused ? 'paused' : generation.state}
                    done={gloss.done}
                    total={gloss.total}
                    stopRequested={generation.run?.stopRequested ?? false}
                    onPause={generation.requestPause}
                    onStopNow={generation.stopNow}
                    {...(running === null
                      ? {
                          onResume: () =>
                            void (gloss.kind === 'exam'
                              ? extractExam(project.id)
                              : extract(project.id)),
                        }
                      : {})}
                  />
                </div>
              )}
              {book && (
                <BookRow
                  book={book}
                  current={book.id === currentId}
                  service={service}
                  onChoose={onChoose}
                  onView={onView}
                  t={t}
                />
              )}
            </div>
          )
        })}
      </CardContent>
      {importFor && (
        <WordListImportDialog
          projectId={importFor}
          open
          onOpenChange={(open) => !open && setImportFor(null)}
          onImported={onChanged}
        />
      )}
    </Card>
  )
}

function MistakePanel({
  service,
  starting,
  onPractice,
  t,
}: {
  service: VocabService
  starting: boolean
  onPractice: () => void
  t: T
}): JSX.Element {
  const [items, setItems] = useState<Array<{ view: WordView; card: VocabCard }> | null>(null)
  const load = useCallback(
    () =>
      void service
        .mistakes()
        .then(setItems)
        .catch(() => {
          setItems([])
          toast({
            variant: 'error',
            title: t('vocab.loadFailed'),
            description: t('vocab.loadFailedHint'),
          })
        }),
    [service, t],
  )
  useEffect(load, [load])
  if (!items) return <LoadingState label={t('vocab.loading')} />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BookOpenCheck className="h-10 w-10" />}
        title={t('vocab.noMistakes')}
        description={t('vocab.noMistakesHint')}
      />
    )
  }
  return (
    <Card className={FLAT_IN_LECTURE}>
      <CardHeader
        className={cn(
          PANEL_HEAD,
          'gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0',
        )}
      >
        <div>
          <CardTitle className={PANEL_TITLE}>
            {t('vocab.mistakesTitle', { count: items.length })}
          </CardTitle>
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
          <div
            key={view.word}
            className="flex items-start gap-3 px-6 py-2.5 lecture:px-0 lab:px-3.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span translate="no" className="notranslate font-medium">
                  {view.word}
                </span>
                <span className="ml-2 text-xs tabular-nums text-destructive lab:font-mono">
                  {t('vocab.mistakeCount', { count: card.mistakes })}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {view.meanings.join('；') || t('vocab.noMeaning')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('vocab.clearMistake')}
              onClick={async () => {
                try {
                  await service.clearMistakes(view.word)
                } catch {
                  toast({ variant: 'error', title: t('vocab.deleteFailed') })
                }
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

function StatsPanel({
  stats,
  service,
  t,
}: {
  stats: VocabStats
  service: VocabService
  t: T
}): JSX.Element {
  const max = Math.max(1, ...stats.forecast)
  return (
    <Card className={FLAT_IN_LECTURE}>
      <CardHeader
        className={cn(
          PANEL_HEAD,
          'gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0',
        )}
      >
        <CardTitle className={PANEL_TITLE}>{t('vocab.tab.stats')}</CardTitle>
        <ExportMenu service={service} target="learned" disabled={stats.learned === 0} />
      </CardHeader>
      <CardContent className="space-y-6 lecture:px-0 lab:p-3.5">
        <div className="grid gap-6 sm:grid-cols-5">
          <Stat value={stats.learned} label={t('vocab.stat.learned')} />
          <Stat value={stats.mature} label={t('vocab.stat.mature')} />
          <Stat value={stats.leeches} label={t('vocab.stat.leeches')} />
          <Stat value={stats.reviewsToday} label={t('vocab.stat.reviewsToday')} />
          <Stat value={stats.streak} label={t('vocab.stat.streak')} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium lecture:font-heading lecture:text-base lecture:font-bold lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground">
            {t('vocab.forecast')}
          </p>
          <div className="flex h-28 items-end gap-2">
            {stats.forecast.map((count, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs tabular-nums text-muted-foreground lab:font-mono">
                  {count}
                </span>
                <div
                  className="w-full rounded-t bg-theme-primary/70 lab:rounded-none"
                  style={{ height: `${Math.max(2, (count / max) * 80)}px` }}
                />
                <span className="text-[11px] text-muted-foreground">
                  {i === 0 ? t('vocab.today') : t('vocab.inDays', { count: i })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

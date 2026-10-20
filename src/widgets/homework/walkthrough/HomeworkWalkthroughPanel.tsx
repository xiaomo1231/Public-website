import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  AlertTriangle,
  BookOpenText,
  Loader2,
  MessageSquareText,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type {
  LinearSystemCheck,
  WalkthroughNote,
  WalkthroughPlanEntry,
} from '@/entities/homework/walkthrough'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import { questionLabel } from '@/services/homeworkWalkthroughService'
import { useWalkthrough } from '@/features/homework/useWalkthrough'
import { openNote } from '@/features/homework/floatingQA'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Math as TeX } from '@/shared/ui/Math'
import { Progress } from '@/shared/ui/Progress'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { FloatingQALayer } from './FloatingQALayer'
import { WalkthroughNotesDialog } from './WalkthroughNotesDialog'
import { WalkthroughPrint, type PrintableSection } from './WalkthroughPrint'
import { caretAt, locatePassage, markPassages, revealPassage } from './passage'

type T = ReturnType<typeof useTranslation>['t']

/** Assignments whose spoiler notice was dismissed during this visit. */
const opened = new Set<string>()

export interface HomeworkWalkthroughPanelProps {
  set: HomeworkSet
  /** In practice mode the walkthrough is behind a "contains the answers" notice. */
  mode: 'practice' | 'review'
}

/**
 * The assignment's complete walkthrough, read like a handout. Selecting text
 * and choosing Explain / Ask opens a floating question window (see
 * SelectionTranslator); saved questions are marked in the text and listed per
 * section and in "My questions".
 */
export function HomeworkWalkthroughPanel({ set, mode }: HomeworkWalkthroughPanelProps): JSX.Element {
  const { t, language: uiLanguage } = useTranslation()
  const { state, notes, progress, loading, error, generate } = useWalkthrough(set.id)
  const [revealed, setRevealed] = useState(() => mode === 'review' || opened.has(set.id))
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmRedo, setConfirmRedo] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [located, setLocated] = useState<ReadonlySet<string>>(new Set())
  const noteRanges = useRef(new Map<string, Range>())
  const running = Boolean(progress)
  const qaLanguage = uiLanguage === 'zh-CN' ? 'zh' : 'en'

  const labels = useMemo(
    () => new Map((state?.questions ?? []).map((question, index) => [question.id, questionLabel(question, index)])),
    [state?.questions],
  )

  const entries = state?.plan ?? []
  const readyCount = entries.filter((entry) => entry.section?.status === 'ready').length
  /** Sections with something to show (a walkthrough or the reason there is none). */
  const writtenCount = entries.filter((entry) => entry.section && entry.section.status !== 'failed').length
  const needsWork = entries.filter((entry) => entry.needsWork).length

  // Mark saved passages; remember which ones are still in the text.
  useEffect(() => {
    if (!revealed) return
    const ranges = new Map<string, Range>()
    for (const note of notes) {
      const range = locatePassage(note.sectionId, note.anchor)
      if (range) ranges.set(note.id, range)
    }
    noteRanges.current = ranges
    markPassages('walkthrough-note', [...ranges.values()])
    setLocated(new Set(ranges.keys()))
    return () => markPassages('walkthrough-note', [])
  }, [notes, state, revealed])

  function onArticleClick(event: MouseEvent): void {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    const caret = caretAt(event.clientX, event.clientY)
    if (!caret) return
    for (const [noteId, range] of noteRanges.current) {
      try {
        if (range.isPointInRange(caret.node, caret.offset)) {
          const note = notes.find((item) => item.id === noteId)
          if (note) openNote(note, set.title, qaLanguage)
          return
        }
      } catch {
        /* a node from another document: not ours */
      }
    }
  }

  async function run(force: boolean): Promise<void> {
    const result = await generate(force)
    if (!result) return
    if (result.fatalError) toast({ variant: 'error', title: t('homework.walkthrough.stopped'), description: result.fatalError })
    else if (result.failed > 0) toast({ variant: 'warning', title: t('homework.walkthrough.someFailed', { count: result.failed }) })
    else toast({ variant: 'success', title: t('homework.walkthrough.done') })
  }

  function openFromList(note: WalkthroughNote): void {
    setNotesOpen(false)
    openNote(note, set.title, qaLanguage)
    revealPassage(note.sectionId, note.anchor)
  }

  if (!revealed) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t('homework.walkthrough.spoilerTitle')}
          </CardTitle>
          <CardDescription>{t('homework.walkthrough.spoilerBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              opened.add(set.id)
              setRevealed(true)
            }}
          >
            <BookOpenText className="h-4 w-4" />
            {t('homework.walkthrough.spoilerOpen')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (loading || !state) return <LoadingState label={t('common.loading')} />

  const printable: PrintableSection[] = entries
    .filter((entry) => entry.section?.status === 'ready')
    .map((entry) => ({
      id: entry.id,
      title: sectionTitle(entry, labels, t),
      conclusion: entry.section!.conclusion,
      body: entry.section!.body,
      suggestions: entry.section!.suggestions,
    }))

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <BookOpenText className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{t('homework.walkthrough.title')}</span>
          <Badge variant="outline">{t(`homework.walkthrough.language.${state.language}` as TranslationKey)}</Badge>
          {writtenCount > 0 && needsWork > 0 && !running && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
              {t('homework.walkthrough.needsWork', { count: needsWork })}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)}>
              <MessageSquareText className="h-4 w-4" />
              {t('walkthroughQA.myQuestions', { count: notes.length })}
            </Button>
            <Button variant="outline" size="sm" disabled={readyCount === 0} onClick={() => setPrinting(true)}>
              <Printer className="h-4 w-4" />
              {t('homework.walkthrough.print')}
            </Button>
            {writtenCount > 0 && needsWork > 0 && (
              <Button size="sm" disabled={running} onClick={() => void run(false)}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('homework.walkthrough.update')}
              </Button>
            )}
            {writtenCount > 0 && (
              <Button variant="ghost" size="sm" disabled={running} onClick={() => setConfirmRedo(true)}>
                <RotateCcw className="h-4 w-4" />
                {t('homework.walkthrough.regenerateAll')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {progress && (
        <Card className="border-border/70">
          <CardContent className="space-y-2 p-4">
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('homework.walkthrough.progress', { done: progress.done, total: progress.total })}
            </p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            <p className="text-xs text-muted-foreground">{t('homework.walkthrough.progressHint')}</p>
          </CardContent>
        </Card>
      )}

      {writtenCount === 0 && !running ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('homework.walkthrough.emptyTitle')}</CardTitle>
            <CardDescription>
              {t('homework.walkthrough.emptyBody', { count: state.questions.length, requests: state.questions.length + 1 })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {entries.some((entry) => entry.section?.status === 'failed') && (
              <p className="text-sm text-destructive">{t('homework.walkthrough.lastFailed')}</p>
            )}
            <Button onClick={() => void run(false)} disabled={state.questions.length === 0}>
              <Sparkles className="h-4 w-4" />
              {t('homework.walkthrough.generate')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label={t('homework.walkthrough.toc')} className="hidden lg:block">
            <ol className="sticky top-4 space-y-1 text-sm">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`#wt-${entry.id}`}
                    onClick={(event) => {
                      event.preventDefault()
                      document.getElementById(`wt-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className={cn(
                      'focus-ring block truncate rounded px-2 py-1 hover:bg-muted',
                      entry.section?.status === 'ready' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {sectionTitle(entry, labels, t)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <Card className="min-w-0">
            <CardContent className="p-5 sm:p-8">
              <p className="mb-6 text-xs text-muted-foreground">{t('homework.walkthrough.selectHint')}</p>
              <article
                data-selection-context="walkthrough"
                data-walkthrough-project={set.projectId}
                data-walkthrough-set={set.id}
                data-selection-title={set.title}
                onClick={onArticleClick}
                className="space-y-12"
              >
                <h1 className="text-2xl font-semibold tracking-tight">{set.title}</h1>
                {entries.map((entry) => (
                  <WalkthroughSectionView
                    key={entry.id}
                    entry={entry}
                    title={sectionTitle(entry, labels, t)}
                    running={progress?.running.includes(entry.id) ?? false}
                    notes={notes.filter((note) => note.sectionId === entry.id)}
                    onOpenNote={(note) => openNote(note, set.title, qaLanguage)}
                  />
                ))}
              </article>
            </CardContent>
          </Card>
        </div>
      )}

      <FloatingQALayer setId={set.id} />

      <WalkthroughNotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        notes={notes}
        located={located}
        onOpenNote={openFromList}
      />

      <ConfirmDialog
        open={confirmRedo}
        onOpenChange={setConfirmRedo}
        title={t('homework.walkthrough.regenerateAllTitle')}
        description={t('homework.walkthrough.regenerateAllBody', { requests: state.questions.length + 1 })}
        confirmLabel={t('homework.walkthrough.regenerateAll')}
        onConfirm={() => {
          setConfirmRedo(false)
          void run(true)
        }}
      />

      {printing && (
        <WalkthroughPrint title={set.title} sections={printable} onDone={() => setPrinting(false)} />
      )}
    </div>
  )
}

function sectionTitle(entry: WalkthroughPlanEntry, labels: ReadonlyMap<string, string>, t: T): string {
  if (entry.kind === 'overview') return t('homework.walkthrough.overviewTitle')
  if (entry.kind === 'summary') return t('homework.walkthrough.summaryTitle')
  const label = labels.get(entry.question!.id) ?? '?'
  return /^[\d(（]/.test(label) ? t('homework.walkthrough.questionTitle', { label }) : label
}

interface SectionViewProps {
  entry: WalkthroughPlanEntry
  title: string
  running: boolean
  notes: WalkthroughNote[]
  onOpenNote: (note: WalkthroughNote) => void
}

function WalkthroughSectionView({ entry, title, running, notes, onOpenNote }: SectionViewProps): JSX.Element {
  const { t } = useTranslation()
  const section = entry.section
  return (
    <section
      id={`wt-${entry.id}`}
      data-walkthrough-section={entry.id}
      data-section-title={title}
      className="scroll-mt-6 space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {running && (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {t('homework.walkthrough.writing')}
          </Badge>
        )}
        {!running && entry.outdated && <Badge variant="outline">{t('homework.walkthrough.outdated')}</Badge>}
      </div>

      {entry.question && <QuestionPrompt question={entry.question} />}

      {!section ? (
        <p className="text-sm text-muted-foreground">{t('homework.walkthrough.notYet')}</p>
      ) : section.status === 'failed' ? (
        <p className="text-sm text-destructive">{t('homework.walkthrough.sectionFailed', { reason: section.error ?? '' })}</p>
      ) : section.status === 'insufficient' ? (
        <p className="text-sm text-muted-foreground">
          {t('homework.walkthrough.insufficient', { reason: section.error ?? '' })}
        </p>
      ) : (
        <>
          {section.conclusion && (
            <div className="rounded-lg border-l-4 border-primary bg-theme-primary-soft/40 px-4 py-3">
              <span className="text-sm font-semibold">{t('homework.walkthrough.conclusion')}</span>
              <RichText text={section.conclusion} format="markdown" paragraphClassName="text-[15px] leading-relaxed" />
            </div>
          )}
          <RichText text={section.body} format="markdown" className="min-w-0 space-y-3" paragraphClassName="text-[15px] leading-[1.8]" />
          {section.suggestions && section.suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-base font-semibold">{t('homework.walkthrough.suggestions')}</h3>
              <ul className="list-outside list-disc space-y-1.5 pl-5">
                {section.suggestions.map((item, index) => (
                  <li key={index}>
                    <RichText text={item} format="markdown" paragraphClassName="text-[15px] leading-relaxed" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {section.checks && section.checks.length > 0 && <ChecksView checks={section.checks} />}
        </>
      )}

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1" data-print-hidden>
          <span className="text-xs text-muted-foreground">{t('walkthroughQA.inSection')}</span>
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onOpenNote(note)}
              className="focus-ring inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted"
              title={note.title}
            >
              <MessageSquareText className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{note.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function QuestionPrompt({ question }: { question: HomeworkQuestion }): JSX.Element {
  const { t } = useTranslation()
  return (
    <details className="rounded-lg border border-border/70 bg-muted/20 px-4 py-2 text-sm">
      <summary className="cursor-pointer select-none text-muted-foreground">{t('homework.walkthrough.showQuestion')}</summary>
      <RichText
        text={formatHomeworkQuestion(question.prompt)}
        format="markdown"
        className="mt-2"
        paragraphClassName="text-sm leading-relaxed"
      />
    </details>
  )
}

function ChecksView({ checks }: { checks: LinearSystemCheck[] }): JSX.Element {
  const { t } = useTranslation()
  const wrong = checks.filter((check) => !check.rrefMatches || !check.kindMatches)
  const kindLabel = (kind: LinearSystemCheck['computedKind']) => t(`homework.walkthrough.kind.${kind}` as TranslationKey)
  return (
    <div className="space-y-2 text-sm">
      {wrong.length === 0 ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t('homework.walkthrough.checkOk', { labels: checks.map((check) => check.label).join(t('homework.walkthrough.listSeparator')) })}
        </p>
      ) : (
        wrong.map((check) => (
          <div key={check.label} className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <span>
                {!check.rrefMatches
                  ? t('homework.walkthrough.checkRref', { label: check.label })
                  : t('homework.walkthrough.checkKind', {
                      label: check.label,
                      claimed: check.claimedKind ? kindLabel(check.claimedKind) : '',
                      computed: kindLabel(check.computedKind),
                    })}
              </span>
            </p>
            {!check.rrefMatches && (
              <div className="overflow-x-auto">
                <p className="text-xs text-muted-foreground">
                  {t('homework.walkthrough.checkComputed', { kind: kindLabel(check.computedKind) })}
                </p>
                <TeX latex={check.computedRref} display />
              </div>
            )}
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">{t('homework.walkthrough.checkScope')}</p>
    </div>
  )
}

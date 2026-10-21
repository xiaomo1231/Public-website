import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  AlertTriangle,
  BookOpenText,
  Link2,
  Loader2,
  MessageSquareText,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Undo2,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type {
  LinearSystemCheck,
  WalkthroughNote,
  WalkthroughPart,
  WalkthroughPlanEntry,
} from '@/entities/homework/walkthrough'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { questionLabel } from '@/services/homeworkWalkthroughService'
import { useWalkthrough } from '@/features/homework/useWalkthrough'
import { openNote, windowTitle } from '@/features/homework/floatingQA'
import { useFloatingQA, type FloatingQAWindow } from '@/features/homework/floatingQAStore'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { RegenerateSectionDialog } from './RegenerateSectionDialog'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Math as TeX } from '@/shared/ui/Math'
import { Progress } from '@/shared/ui/Progress'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { useTranslation, type TranslationKey } from '@/i18n'
import { FloatingQALayer } from './FloatingQALayer'
import { WalkthroughNotesDialog } from './WalkthroughNotesDialog'
import { WalkthroughPrint, type PrintableSection } from './WalkthroughPrint'
import { PassageHoverCard, type PassageHoverSubject } from './PassageHoverCard'
import { usePassageHover, type PassageHoverTarget } from './usePassageHover'
import {
  caretAt,
  hitPassage,
  locatePassages,
  markPassages,
  passageRectAt,
  revealPassage,
} from './passage'

type T = ReturnType<typeof useTranslation>['t']

/** Dismissed in this visit, before the page's copy of the assignment reloads. */
const dismissed = new Set<string>()

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
export function HomeworkWalkthroughPanel({
  set,
  mode,
}: HomeworkWalkthroughPanelProps): JSX.Element {
  const { t, language: uiLanguage } = useTranslation()
  const {
    state,
    notes,
    progress,
    loading,
    error,
    generate,
    resume,
    runState,
    stopRequested,
    paused,
    requestPause,
    stopNow,
    aiReady = false,
    regenerateSection,
    restorePrevious,
  } = useWalkthrough(set.id)
  const homework = useHomeworkService()
  // The spoiler notice appears once per assignment; dismissing it is stored on
  // the assignment, so a reload or another visit opens the walkthrough directly.
  const [revealed, setRevealed] = useState(
    () => mode === 'review' || Boolean(set.walkthroughNoticeSeenAt) || dismissed.has(set.id),
  )
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmRedo, setConfirmRedo] = useState(false)
  /** The section whose 重新生成 dialog is open. */
  const [regenTarget, setRegenTarget] = useState<WalkthroughPlanEntry | null>(null)
  const [printing, setPrinting] = useState(false)
  const [located, setLocated] = useState<ReadonlySet<string>>(new Set())
  const noteRanges = useRef(new Map<string, Range>())
  /** Passages of conversations tucked into the text, by window id. */
  const linkRanges = useRef(new Map<string, Range>())
  /** Where cards that follow the page are placed (scrolls with the text). */
  const [cardLayer, setCardLayer] = useState<HTMLDivElement | null>(null)
  const allWindows = useFloatingQA((store) => store.windows)
  const tucked = useMemo(
    () => allWindows.filter((window) => window.passage.setId === set.id && window.tucked),
    [allWindows, set.id],
  )
  const tuckedKey = tucked.map((window) => window.id).join('|')
  const running = Boolean(progress)
  const qaLanguage = uiLanguage === 'zh-CN' ? 'zh' : 'en'

  const labels = useMemo(
    () =>
      new Map(
        (state?.questions ?? []).map((question, index) => [
          question.id,
          questionLabel(question, index),
        ]),
      ),
    [state?.questions],
  )

  const entries = state?.plan ?? []
  const readyCount = entries.filter((entry) => entry.section?.status === 'ready').length
  /** Sections with something to show (a walkthrough or the reason there is none). */
  const writtenCount = entries.filter(
    (entry) => entry.section && entry.section.status !== 'failed',
  ).length
  const needsWork = entries.filter((entry) => entry.needsWork).length

  // Changes only when some section's rendered text may have changed — not on
  // progress ticks or other walkthrough state updates.
  const textKey = entries
    .map((entry) => `${entry.id}:${entry.section?.status ?? ''}:${entry.section?.generatedAt ?? 0}`)
    .join('|')
    .concat(`|${uiLanguage}`)

  // Mark saved passages; remember which ones are still in the text.
  useEffect(() => {
    if (!revealed) return
    const ranges = locatePassages(notes)
    noteRanges.current = ranges
    markPassages('walkthrough-note', [...ranges.values()])
    setLocated((previous) =>
      previous.size === ranges.size && [...ranges.keys()].every((id) => previous.has(id))
        ? previous
        : new Set(ranges.keys()),
    )
    return () => markPassages('walkthrough-note', [])
  }, [notes, textKey, revealed])

  // Mark the passages of tucked conversations (a dashed link, above note marks).
  useEffect(() => {
    if (!revealed) return
    const ids = new Set(tuckedKey ? tuckedKey.split('|') : [])
    const ranges = locatePassages(
      useFloatingQA
        .getState()
        .windows.filter((window) => ids.has(window.id))
        .map((window) => ({
          id: window.id,
          sectionId: window.passage.sectionId,
          anchor: window.passage.anchor,
        })),
    )
    linkRanges.current = ranges
    markPassages('walkthrough-link', [...ranges.values()], 1)
    return () => markPassages('walkthrough-link', [])
  }, [tuckedKey, textKey, revealed])

  /** Marked passages in hit-test order: tucked conversations, then saved notes. */
  const markedPassages = useCallback((): [string, Range][] => {
    const tuckedNotes = new Set(
      useFloatingQA
        .getState()
        .windows.filter((window) => window.tucked && window.noteId)
        .map((window) => window.noteId),
    )
    return [
      ...[...linkRanges.current].map(([id, range]): [string, Range] => [`w:${id}`, range]),
      ...[...noteRanges.current]
        .filter(([id]) => !tuckedNotes.has(id))
        .map(([id, range]): [string, Range] => [`n:${id}`, range]),
    ]
  }, [])

  const resolveHover = useCallback(
    (point: { x: number; y: number }): PassageHoverTarget | null => {
      const candidates = markedPassages()
      if (candidates.length === 0) return null
      const key = hitPassage(candidates, caretAt(point.x, point.y), point)
      const range = key ? candidates.find(([candidate]) => candidate === key)?.[1] : undefined
      return key && range ? { key, anchor: passageRectAt(range, point) } : null
    },
    [markedPassages],
  )
  const passageHover = usePassageHover(resolveHover)

  /** Open a marked passage's conversation as a full window. */
  function openMarked(key: string): void {
    const id = key.slice(2)
    if (key.startsWith('w:')) {
      useFloatingQA.getState().focus(id)
      return
    }
    const note = notes.find((item) => item.id === id)
    if (note) openNote(note, set.title, qaLanguage)
  }

  function onArticleClick(event: MouseEvent): void {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    const point = { x: event.clientX, y: event.clientY }
    const key = hitPassage(markedPassages(), caretAt(point.x, point.y), point)
    if (!key) return
    passageHover.close()
    openMarked(key)
  }

  const hoverSubject: PassageHoverSubject | null = (() => {
    const key = passageHover.hover?.key
    if (!key) return null
    const id = key.slice(2)
    if (key.startsWith('w:'))
      return tucked.some((window) => window.id === id) ? { kind: 'window', windowId: id } : null
    const note = notes.find((item) => item.id === id)
    return note ? { kind: 'note', note } : null
  })()

  async function run(force: boolean | 'resume'): Promise<void> {
    const result = await (force === 'resume' ? resume() : generate(force))
    if (!result) return
    // Paused or stopped: the panel says so; finished sections are saved.
    if (result.paused && !result.fatalError) return
    if (result.fatalError)
      toast({
        variant: 'error',
        title: t('homework.walkthrough.stopped'),
        description: result.fatalError,
      })
    else if (result.failed > 0)
      toast({
        variant: 'warning',
        title: t('homework.walkthrough.someFailed', { count: result.failed }),
      })
    else toast({ variant: 'success', title: t('homework.walkthrough.done') })
  }

  async function regenerate(entry: WalkthroughPlanEntry, suggestion?: string): Promise<void> {
    if (!regenerateSection) return
    const result = await regenerateSection(entry.id, suggestion)
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.regenerateFailed') })
      return
    }
    // Paused or stopped: the section is unchanged (finished sub-parts kept).
    if (result.paused) return
    toast({ variant: 'success', title: t('homework.walkthrough.regenerated') })
  }

  async function restore(entry: WalkthroughPlanEntry): Promise<void> {
    if (!restorePrevious) return
    if (await restorePrevious(entry.id))
      toast({ variant: 'success', title: t('homework.walkthrough.restored') })
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
              dismissed.add(set.id)
              setRevealed(true)
              void homework?.markWalkthroughNoticeSeen(set.id)
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
      <Card className="border-border/70 lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:bg-transparent lecture:shadow-none">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 lecture:px-0">
          <BookOpenText className="h-4 w-4 text-muted-foreground lecture:hidden" aria-hidden />
          <span className="text-sm font-medium lecture:font-heading lecture:text-base lecture:font-bold lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider lab:text-muted-foreground">
            {t('homework.walkthrough.title')}
          </span>
          <Badge variant="outline">
            {t(`homework.walkthrough.language.${state.language}` as TranslationKey)}
          </Badge>
          {writtenCount > 0 && needsWork > 0 && !running && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-700 dark:text-amber-300"
            >
              {t('homework.walkthrough.needsWork', { count: needsWork })}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)}>
              <MessageSquareText className="h-4 w-4" />
              {t('walkthroughQA.myQuestions', { count: notes.length })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={readyCount === 0}
              onClick={() => setPrinting(true)}
            >
              <Printer className="h-4 w-4" />
              {t('homework.walkthrough.print')}
            </Button>
            {writtenCount > 0 && needsWork > 0 && (
              <Button size="sm" disabled={running} onClick={() => void run(false)}>
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('homework.walkthrough.update')}
              </Button>
            )}
            {writtenCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={running}
                onClick={() => setConfirmRedo(true)}
              >
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
              {progress.section
                ? t('homework.walkthrough.regenerating', {
                    title: regeneratingTitle(progress.section.id, entries, labels, t),
                  })
                : t('homework.walkthrough.progress', {
                    done: progress.done,
                    total: progress.total,
                  })}
            </p>
            {Object.entries(progress.parts ?? {}).map(([sectionId, part]) => (
              <p key={sectionId} className="text-xs text-muted-foreground">
                {t('homework.walkthrough.writingPartOf', {
                  title: regeneratingTitle(sectionId, entries, labels, t),
                  part,
                })}
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Progress
                className="min-w-[12rem] flex-1"
                value={progress.total ? (progress.done / progress.total) * 100 : 0}
              />
              <GenerationControls
                kind={progress.section && !progress.section.split ? 'single' : 'parts'}
                state={runState}
                stopRequested={stopRequested}
                onPause={requestPause}
                onStopNow={stopNow}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('homework.walkthrough.progressHint')}
            </p>
          </CardContent>
        </Card>
      )}

      {!progress && paused && (runState === 'paused' || runState === 'stopped') && (
        <Card className="border-border/70">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Progress
              className="min-w-[12rem] flex-1"
              value={paused.total ? (paused.done / paused.total) * 100 : 0}
            />
            <GenerationControls
              kind="parts"
              state={runState}
              done={paused.done}
              total={paused.total}
              onResume={() => void run('resume')}
            />
          </CardContent>
        </Card>
      )}

      {writtenCount === 0 && !running ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('homework.walkthrough.emptyTitle')}</CardTitle>
            <CardDescription>
              {t('homework.walkthrough.emptyBody', {
                count: state.questions.length,
                requests: state.questions.length + 1,
              })}
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
        <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lecture:lg:gap-12">
          <nav aria-label={t('homework.walkthrough.toc')} className="hidden lg:block">
            <ol className="sticky top-4 max-h-[calc(100vh-4rem)] space-y-1 overflow-y-auto text-sm lecture:space-y-0 lab:space-y-px lab:border lab:bg-card lab:p-1">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`#wt-${entry.id}`}
                    onClick={(event) => {
                      event.preventDefault()
                      const target = document.getElementById(`wt-${entry.id}`)
                      if (!target) return
                      target.scrollIntoView({
                        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                        block: 'start',
                      })
                      // Move focus too, so keyboard and screen-reader users land there.
                      target.focus({ preventScroll: true })
                    }}
                    className={cn(
                      'focus-ring block truncate rounded px-2 py-1 transition-colors duration-150 hover:bg-muted',
                      'lecture:rounded-none lecture:border-l lecture:py-1.5 lecture:pl-3 lecture:hover:border-primary lecture:hover:bg-transparent',
                      entry.section?.status === 'ready'
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden
                      className="mr-2 hidden font-mono text-[11px] tabular-nums text-muted-foreground lab:inline"
                    >
                      {sectionMarker(entry, labels)}
                    </span>
                    {sectionTitle(entry, labels, t)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <Card className="min-w-0 lecture:rounded-none lecture:border-0 lecture:bg-transparent lecture:shadow-none">
            <CardContent className="relative p-5 lecture:mx-auto lecture:max-w-[680px] lecture:px-0 sm:p-8 sm:lecture:px-0 lab:sm:px-9">
              <p className="mb-6 text-xs text-muted-foreground lab:font-mono lab:text-[11px]">
                {t('homework.walkthrough.selectHint')}
              </p>
              <article
                data-selection-context="walkthrough"
                data-walkthrough-project={set.projectId}
                data-walkthrough-set={set.id}
                data-selection-title={set.title}
                onClick={onArticleClick}
                {...passageHover.articleHandlers}
                // Focus returns here when a question window closes.
                tabIndex={-1}
                className="space-y-12 outline-none lab:space-y-10"
              >
                <h1 className="break-words font-heading text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] lecture:text-[32px] lecture:font-bold lecture:leading-snug lecture:tracking-normal lab:text-[22px]">
                  {set.title}
                </h1>
                {entries.map((entry) => (
                  <WalkthroughSectionView
                    key={entry.id}
                    entry={entry}
                    title={sectionTitle(entry, labels, t)}
                    marker={sectionMarker(entry, labels)}
                    running={progress?.running.includes(entry.id) ?? false}
                    runningPart={progress?.parts?.[entry.id]}
                    notes={notes.filter((note) => note.sectionId === entry.id)}
                    tucked={tucked.filter(
                      (window) => window.passage.sectionId === entry.id && !window.noteId,
                    )}
                    onOpenNote={(note) => openNote(note, set.title, qaLanguage)}
                    // Fills only the missing / outdated parts, like the toolbar button.
                    {...(running ? {} : { onGenerate: () => void run(false) })}
                    {...(running || !regenerateSection
                      ? {}
                      : {
                          onRegenerate: () => setRegenTarget(entry),
                          onContinueRegenerate: (suggestion?: string) =>
                            void regenerate(entry, suggestion),
                          onRestore: () => void restore(entry),
                        })}
                    aiReady={aiReady}
                  />
                ))}
              </article>
              {/* Cards that follow the page are placed here, in content coordinates. */}
              <div
                ref={setCardLayer}
                data-walkthrough-card-layer={set.id}
                data-print-hidden
                className="pointer-events-none absolute inset-0"
              />
            </CardContent>
          </Card>
        </div>
      )}

      <FloatingQALayer setId={set.id} cardLayer={cardLayer} />

      {passageHover.hover && hoverSubject && (
        <PassageHoverCard
          subject={hoverSubject}
          anchor={passageHover.hover.anchor}
          onExpand={() => {
            const key = passageHover.hover?.key
            passageHover.close()
            if (key) openMarked(key)
          }}
          {...passageHover.cardHandlers}
        />
      )}

      <WalkthroughNotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        notes={notes}
        located={located}
        onOpenNote={openFromList}
      />

      <RegenerateSectionDialog
        open={regenTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRegenTarget(null)
        }}
        title={regenTarget ? sectionTitle(regenTarget, labels, t) : ''}
        onConfirm={(suggestion) => {
          const target = regenTarget
          setRegenTarget(null)
          if (target) void regenerate(target, suggestion)
        }}
      />

      <ConfirmDialog
        open={confirmRedo}
        onOpenChange={setConfirmRedo}
        title={t('homework.walkthrough.regenerateAllTitle')}
        description={t('homework.walkthrough.regenerateAllBody', {
          requests: state.questions.length + 1,
        })}
        confirmLabel={t('homework.walkthrough.regenerateAll')}
        onConfirm={() => {
          setConfirmRedo(false)
          void run(true)
        }}
      />

      {printing && (
        <WalkthroughPrint
          title={set.title}
          sections={printable}
          onDone={() => setPrinting(false)}
        />
      )}
    </div>
  )
}

function sectionTitle(
  entry: WalkthroughPlanEntry,
  labels: ReadonlyMap<string, string>,
  t: T,
): string {
  if (entry.kind === 'overview') return t('homework.walkthrough.overviewTitle')
  if (entry.kind === 'summary') return t('homework.walkthrough.summaryTitle')
  const label = labels.get(entry.question!.id) ?? '?'
  return /^[\d(（]/.test(label) ? t('homework.walkthrough.questionTitle', { label }) : label
}

function regeneratingTitle(
  sectionId: string,
  entries: readonly WalkthroughPlanEntry[],
  labels: ReadonlyMap<string, string>,
  t: T,
): string {
  const entry = entries.find((item) => item.id === sectionId)
  return entry ? sectionTitle(entry, labels, t) : ''
}

/** The lab style's mono section number: Q1, Q2(a) … for questions, § otherwise. */
function sectionMarker(entry: WalkthroughPlanEntry, labels: ReadonlyMap<string, string>): string {
  if (!entry.question) return '§'
  return `Q${labels.get(entry.question.id) ?? '?'}`
}

interface SectionViewProps {
  entry: WalkthroughPlanEntry
  title: string
  marker: string
  running: boolean
  /** Split question: the sub-part being written now (`b`). */
  runningPart?: string | undefined
  notes: WalkthroughNote[]
  /** Unsaved conversations tucked into this section's text. */
  tucked: FloatingQAWindow[]
  onOpenNote: (note: WalkthroughNote) => void
  /** Generate the missing or outdated parts; absent while a run is in progress. */
  onGenerate?: () => void
  /** Open the 重新生成这一节 dialog; absent while a run is in progress. */
  onRegenerate?: () => void
  /** Continue an unfinished regeneration of a split question. */
  onContinueRegenerate?: (suggestion?: string) => void
  /** Swap with the version the last regeneration replaced. */
  onRestore?: () => void
  aiReady: boolean
}

function WalkthroughSectionView({
  entry,
  title,
  marker,
  running,
  runningPart,
  notes,
  tucked,
  onOpenNote,
  onGenerate,
  onRegenerate,
  onContinueRegenerate,
  onRestore,
  aiReady,
}: SectionViewProps): JSX.Element {
  const { t } = useTranslation()
  const section = entry.section
  const draft = section?.draft
  const canRegenerate =
    Boolean(onRegenerate) && (section?.status === 'ready' || section?.status === 'insufficient')
  const noProvider = aiReady ? undefined : t('homework.noProvider')
  return (
    <section
      id={`wt-${entry.id}`}
      data-walkthrough-section={entry.id}
      data-section-title={title}
      // Focus target for the contents links.
      tabIndex={-1}
      className="scroll-mt-6 space-y-4 outline-none"
    >
      <div className="flex flex-wrap items-center gap-2 border-b pb-2 lecture:border-b-0 lecture:pb-0">
        <h2 className="flex items-baseline gap-2.5 font-heading text-xl font-semibold lecture:text-[22px] lecture:font-bold lab:text-base">
          <span
            aria-hidden
            className="hidden font-mono text-xs font-normal tabular-nums text-muted-foreground lab:inline"
          >
            {marker}
          </span>
          {title}
        </h2>
        {running && (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {runningPart
              ? t('homework.walkthrough.writingPart', { part: runningPart })
              : t('homework.walkthrough.writing')}
          </Badge>
        )}
        {!running && entry.outdated && (
          <Badge variant="outline">{t('homework.walkthrough.outdated')}</Badge>
        )}
        {(canRegenerate || (onRestore && section?.previous)) && (
          <div className="ml-auto flex flex-wrap items-center gap-1" data-print-hidden>
            {onRestore && section?.previous && (
              <Button variant="ghost" size="sm" onClick={onRestore}>
                <Undo2 className="h-4 w-4" aria-hidden />
                {t('homework.walkthrough.restorePrevious')}
              </Button>
            )}
            {canRegenerate && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!aiReady}
                title={noProvider}
                onClick={onRegenerate}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t('homework.walkthrough.regenerateSection')}
              </Button>
            )}
          </div>
        )}
      </div>

      {entry.question && <QuestionPrompt question={entry.question} />}

      {section && draft && section.status !== 'ready' && draft.parts.length > 0 && (
        <PartialParts parts={draft.parts} total={draft.labels.length} />
      )}

      {section?.status === 'partial' ? (
        <div className="flex flex-wrap items-center gap-3">
          {draft && draft.parts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('homework.walkthrough.partialDone', { done: 0, total: draft.labels.length })}
            </p>
          )}
          {onGenerate && !running && (
            <Button variant="outline" size="sm" onClick={onGenerate}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t('homework.walkthrough.continueGenerating')}
            </Button>
          )}
        </div>
      ) : !section ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {running ? t('homework.walkthrough.writing') : t('homework.walkthrough.notYetHint')}
          </p>
          {onGenerate && !running && (
            <Button variant="outline" size="sm" onClick={onGenerate}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t('homework.walkthrough.generateMissing')}
            </Button>
          )}
        </div>
      ) : section.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            {t('homework.walkthrough.sectionFailed', { reason: section.error ?? '' })}
          </p>
          {onGenerate && !running && (
            <Button variant="outline" size="sm" onClick={onGenerate}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t('homework.walkthrough.generateMissing')}
            </Button>
          )}
        </div>
      ) : section.status === 'insufficient' ? (
        <p className="text-sm text-muted-foreground">
          {t('homework.walkthrough.insufficient', { reason: section.error ?? '' })}
        </p>
      ) : (
        <>
          {section.conclusion && (
            <div className="rounded-lg border-l-4 border-primary bg-theme-primary-soft/40 px-4 py-3 lecture:rounded-none lecture:border-l-[3px] lecture:bg-transparent lecture:py-1 lab:rounded-none lab:border lab:border-l-2 lab:border-border lab:border-l-primary">
              <span className="text-sm font-semibold lecture:block lecture:text-xs lecture:font-normal lecture:tracking-[0.14em] lecture:text-muted-foreground lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
                {t('homework.walkthrough.conclusion')}
              </span>
              <RichText
                text={section.conclusion}
                format="markdown"
                paragraphClassName="text-[15px] leading-relaxed lecture:text-[17px] lecture:text-foreground"
              />
            </div>
          )}
          <RichText
            text={section.body}
            format="markdown"
            className="min-w-0 space-y-3"
            paragraphClassName="text-[15px] leading-[1.8] lecture:text-[17px] lecture:leading-[1.9]"
          />
          {section.suggestions && section.suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-heading text-base font-semibold lecture:text-lg lecture:font-bold">
                {t('homework.walkthrough.suggestions')}
              </h3>
              <ul className="list-outside list-disc space-y-1.5 pl-5">
                {section.suggestions.map((item, index) => (
                  <li key={index}>
                    <RichText
                      text={item}
                      format="markdown"
                      paragraphClassName="text-[15px] leading-relaxed"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {section.checks && section.checks.length > 0 && <ChecksView checks={section.checks} />}
          {draft?.mode === 'regenerate' && !running && (
            <div
              className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm text-muted-foreground"
              data-print-hidden
            >
              <span>
                {t('homework.walkthrough.regeneratePaused', {
                  done: draft.parts.length,
                  total: draft.labels.length,
                })}
              </span>
              {onContinueRegenerate && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!aiReady}
                  title={noProvider}
                  onClick={() => onContinueRegenerate(draft.suggestion)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {t('homework.walkthrough.continueGenerating')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {(notes.length > 0 || tucked.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1" data-print-hidden>
          <span className="text-xs text-muted-foreground">{t('walkthroughQA.inSection')}</span>
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              data-note-chip={note.id}
              onClick={() => onOpenNote(note)}
              className="focus-ring inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 hover:bg-muted lab:rounded-sm"
              title={note.title}
            >
              <MessageSquareText className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{note.title}</span>
            </button>
          ))}
          {/* Tucked conversations: the keyboard way to what the passage hover shows. */}
          {tucked.map((window) => (
            <button
              key={window.id}
              type="button"
              data-tucked-chip={window.id}
              onClick={() => useFloatingQA.getState().focus(window.id)}
              className="focus-ring inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border border-dashed border-primary/60 px-2.5 py-0.5 text-xs transition-colors duration-150 hover:bg-muted lab:rounded-sm"
              title={`${t('walkthroughQA.tucked')} · ${windowTitle(window, t)}`}
            >
              <Link2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{windowTitle(window, t)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The sub-parts of a split question finished so far. */
function PartialParts({ parts, total }: { parts: WalkthroughPart[]; total: number }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <Badge variant="outline">
        {t('homework.walkthrough.partialDone', { done: parts.length, total })}
      </Badge>
      {parts.map((part) => (
        <div key={part.label} className="space-y-2">
          <h3 className="font-heading text-base font-semibold lecture:text-lg lecture:font-bold">
            {`(${part.label}) ${part.heading}`.trim()}
          </h3>
          <RichText
            text={part.conclusion}
            format="markdown"
            paragraphClassName="text-[15px] font-medium leading-relaxed"
          />
          <RichText
            text={part.body}
            format="markdown"
            className="min-w-0 space-y-3"
            paragraphClassName="text-[15px] leading-[1.8] lecture:text-[17px] lecture:leading-[1.9]"
          />
          {part.checks && part.checks.length > 0 && <ChecksView checks={part.checks} />}
        </div>
      ))}
    </div>
  )
}

function QuestionPrompt({ question }: { question: HomeworkQuestion }): JSX.Element {
  const { t } = useTranslation()
  return (
    <details className="rounded-lg border border-border/70 bg-muted/20 px-4 py-2 text-sm lecture:rounded-none lecture:border-x-0 lecture:bg-transparent lecture:px-0 lab:rounded-none">
      <summary className="cursor-pointer select-none text-muted-foreground">
        {t('homework.walkthrough.showQuestion')}
      </summary>
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
  const kindLabel = (kind: LinearSystemCheck['computedKind']) =>
    t(`homework.walkthrough.kind.${kind}` as TranslationKey)
  return (
    <div className="space-y-2 text-sm">
      {wrong.length === 0 ? (
        <p className="flex items-start gap-2 text-muted-foreground lecture:border-y lecture:py-2 lecture:text-emerald-700 lab:items-center lab:border lab:border-dashed lab:border-emerald-600/45 lab:px-3 lab:py-2 lab:font-mono lab:text-xs lab:text-emerald-700 dark:lecture:text-emerald-400 dark:lab:text-emerald-400">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 lab:mt-0 lab:h-3.5 lab:w-3.5 dark:text-emerald-400"
            aria-hidden
          />
          {t('homework.walkthrough.checkOk', {
            labels: checks
              .map((check) => check.label)
              .join(t('homework.walkthrough.listSeparator')),
          })}
        </p>
      ) : (
        wrong.map((check) => (
          <div
            key={check.label}
            className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 lecture:rounded-none lecture:border-x-0 lecture:bg-transparent lecture:px-0 lab:rounded-none"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
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

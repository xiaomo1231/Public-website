import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  AlertTriangle,
  AlignJustify,
  AlignLeft,
  BookOpenText,
  Check,
  ChevronDown,
  FileUp,
  ListChecks,
  ListOrdered,
  Link2,
  Scale,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
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
  WalkthroughSource,
} from '@/entities/homework/walkthrough'
import {
  DEFAULT_WALKTHROUGH_LEVEL,
  detailedVariant,
  missingDetailed,
  professorAnswerOf,
  sectionContent,
  sectionLevel,
  sectionSources,
  sourceOf,
  type WalkthroughLevel,
} from '@/entities/homework/walkthrough'
import {
  alignSuggestion,
  awaitsCompare,
  currentCompare,
  isAlignedWith,
} from '@/entities/homework/professorCompare'
import { useAuth } from '@/features/auth/useAuth'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { questionLabel, type SectionAttempt } from '@/services/homeworkWalkthroughService'
import { formatWalkthroughText, tidyBoxedPunctuation } from '@/entities/homework/walkthroughFormat'
import { useWalkthrough } from '@/features/homework/useWalkthrough'
import { openNote, windowTitle } from '@/features/homework/floatingQA'
import { useFloatingQA, type FloatingQAWindow } from '@/features/homework/floatingQAStore'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/DropdownMenu'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { RegenerateSectionDialog } from './RegenerateSectionDialog'
import { ImportWalkthroughDialog } from './ImportWalkthroughDialog'
import { ImportedBadge, ImportIssuesView } from './ImportedSection'
import { ProfessorAlignedBadge, ProfessorCompareView } from './ProfessorCompare'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Math as TeX } from '@/shared/ui/Math'
import { Progress } from '@/shared/ui/Progress'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { useTranslation, type TranslationKey } from '@/i18n'
import { FloatingQALayer } from './FloatingQALayer'
import { PracticeSetLauncher } from '../practice/PracticeSetLauncher'
import { QuestionText } from '@/widgets/homework/QuestionText'
import { WalkthroughBody, WALKTHROUGH_PARAGRAPH } from './WalkthroughBody'
import { WalkthroughNotesDialog } from './WalkthroughNotesDialog'
import { WalkthroughPrint, type PrintableSection } from './WalkthroughPrint'
import { PassageHoverCard, type PassageHoverSubject } from './PassageHoverCard'
import { usePassageHover, type PassageHoverTarget } from './usePassageHover'
import { useScrollSpy } from './scrollSpy'
import { WalkthroughSpoilerGate } from './WalkthroughSpoilerGate'
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
  /** 先去做题 on that notice: switch to the practice view. */
  onPractice?: () => void
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
  onPractice,
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
    setSource,
    addAnalysis,
    setLevel,
    generateVariants,
    compareSection,
    compareAll,
    alignToProfessor,
    dismissCompare,
  } = useWalkthrough(set.id)
  const homework = useHomeworkService()
  // 普通 / 详细: the default from settings; each section may override it.
  const { profile } = useAuth()
  const defaultLevel: WalkthroughLevel = profile?.walkthroughLevel ?? DEFAULT_WALKTHROUGH_LEVEL
  /** The version a section shows, when it exists (else the standard one). */
  const shownLevel = (entry: WalkthroughPlanEntry): WalkthroughLevel =>
    entry.section &&
    sectionLevel(entry.section, defaultLevel) === 'detailed' &&
    detailedVariant(entry.section)
      ? 'detailed'
      : 'standard'
  // The spoiler notice appears once per assignment; dismissing it is stored on
  // the assignment, so a reload or another visit opens the walkthrough directly.
  const [revealed, setRevealed] = useState(
    () => mode === 'review' || Boolean(set.walkthroughNoticeSeenAt) || dismissed.has(set.id),
  )
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmRedo, setConfirmRedo] = useState(false)
  /** 导入讲解 dialog. */
  const [importOpen, setImportOpen] = useState(false)
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
  const readyQuestions = entries
    .filter((entry) => entry.kind === 'question' && entry.section?.status === 'ready')
    .map((entry) => entry.section!)
  /** Ready question sections without a detailed version yet. */
  const missingCount = missingDetailed(readyQuestions).length
  /** Ready sections with a professor answer not yet followed or compared (「可对照」). */
  const compareCount = entries.filter(
    (entry) =>
      entry.kind === 'question' &&
      entry.question &&
      awaitsCompare(entry.section, professorAnswerOf(entry.question)),
  ).length
  const allDetailed =
    readyQuestions.length > 0 &&
    readyQuestions.every((section) => sectionLevel(section, defaultLevel) === 'detailed')

  // Changes only when some section's rendered text may have changed — not on
  // progress ticks or other walkthrough state updates.
  const textKey = entries
    .map(
      (entry) =>
        `${entry.id}:${entry.section?.status ?? ''}:${entry.section?.generatedAt ?? 0}:${entry.section?.analysis ? 1 : 0}:${shownLevel(entry)}:${entry.section ? (detailedVariant(entry.section)?.generatedAt ?? 0) : 0}`,
    )
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

  // Contents: the section being read is highlighted (and offers its 普通 / 详细).
  const sectionIds = useMemo(() => (state?.plan ?? []).map((entry) => entry.id), [state?.plan])
  const activeId = useScrollSpy(sectionIds, { enabled: revealed && writtenCount > 0 })
  const tocRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    // Keep the current entry visible inside the (scrollable) contents list.
    const list = tocRef.current
    const item = list?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
  }, [activeId])

  /** Scroll to a section and move focus there (keyboard and screen-reader users). */
  function jumpTo(id: string): void {
    const target = document.getElementById(`wt-${id}`)
    if (!target) return
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
    target.focus({ preventScroll: true })
  }

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
    // Finger / pen: a tap shows the passage's card (what hover shows with a
    // mouse); tapping it again or anywhere else closes it.
    if (passageHover.lastPressWasTouch()) {
      const target = resolveHover(point)
      if (!target || passageHover.hover?.key === target.key) passageHover.close()
      else passageHover.pin(target)
      return
    }
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
    // Only the version shown is rewritten (the detailed one, when that is shown).
    const result = await (shownLevel(entry) === 'detailed'
      ? regenerateSection(entry.id, suggestion, 'detailed')
      : regenerateSection(entry.id, suggestion))
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.regenerateFailed') })
      return
    }
    // Paused or stopped: the section is unchanged (finished sub-parts kept).
    if (result.paused) return
    toast({ variant: 'success', title: t('homework.walkthrough.regenerated') })
  }

  async function analyze(entry: WalkthroughPlanEntry): Promise<void> {
    if (!addAnalysis) return
    const result = await addAnalysis(entry.id)
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.analysisFailed') })
      return
    }
    if (result.paused) return
    toast({ variant: 'success', title: t('homework.walkthrough.analysisAdded') })
  }

  /** Write detailed versions (the given sections, or every missing one). */
  async function writeDetailed(sectionIds?: string[]): Promise<void> {
    const result = await generateVariants(sectionIds)
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.variantFailed') })
      return
    }
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
        title: t('homework.walkthrough.variantsFailed', { count: result.failed }),
      })
    else if (result.generated > 0)
      toast({
        variant: 'success',
        title: t(
          sectionIds?.length === 1
            ? 'homework.walkthrough.variantDone'
            : 'homework.walkthrough.variantsDone',
        ),
      })
  }

  /** 普通 / 详细 for one section: instant when that version exists, written once otherwise. */
  async function changeLevel(entry: WalkthroughPlanEntry, level: WalkthroughLevel): Promise<void> {
    await setLevel([entry.id], level)
    if (
      level === 'detailed' &&
      entry.section?.status === 'ready' &&
      !detailedVariant(entry.section) &&
      aiReady &&
      !running
    )
      await writeDetailed([entry.id])
  }

  /** 全部切到详细版 / 普通版: only the missing detailed versions are written. */
  async function switchAll(level: WalkthroughLevel): Promise<void> {
    await setLevel('all', level)
    if (level === 'detailed' && missingCount > 0 && aiReady && !running) await writeDetailed()
  }

  /** Show the outcome of a comparison run (one section or all of them). */
  function compareDone(
    result: Awaited<ReturnType<NonNullable<typeof compareAll>>> | undefined,
  ): void {
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.compareFailed') })
      return
    }
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
        title: t('homework.walkthrough.compareSomeFailed', { count: result.failed }),
      })
    else toast({ variant: 'success', title: t('homework.walkthrough.compareDone') })
  }

  /** 按教授答案修改: rewrite following the professor, with what the comparison found. */
  async function align(entry: WalkthroughPlanEntry): Promise<void> {
    const report = entry.question
      ? currentCompare(entry.section, professorAnswerOf(entry.question))
      : undefined
    if (!alignToProfessor || !report) return
    const result = await alignToProfessor(
      entry.id,
      alignSuggestion(report, state?.language === 'en' ? 'en' : 'zh'),
    )
    if (!result) {
      toast({ variant: 'error', title: t('homework.walkthrough.regenerateFailed') })
      return
    }
    if (result.paused) return
    toast({ variant: 'success', title: t('homework.walkthrough.aligned') })
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
      <WalkthroughSpoilerGate
        onOpen={() => {
          dismissed.add(set.id)
          setRevealed(true)
          void homework?.markWalkthroughNoticeSeen(set.id)
        }}
        {...(onPractice ? { onPractice } : {})}
      />
    )
  }

  if (loading || !state) return <LoadingState label={t('common.loading')} />

  const activeEntry = entries.find((entry) => entry.id === activeId)
  const activeTitle = activeEntry ? sectionTitle(activeEntry, labels, t) : ''
  // The current section's 普通 / 详细, kept in reach while scrolling its text.
  const activeLevelToggle =
    activeEntry?.kind === 'question' && activeEntry.section?.status === 'ready' ? (
      <LevelToggle
        level={sectionLevel(activeEntry.section, defaultLevel)}
        onChange={(level) => void changeLevel(activeEntry, level)}
        busy={progress?.section?.id === activeEntry.id && progress.section.variant === true}
        label={`${t('homework.walkthrough.levelGroup')} · ${activeTitle}`}
      />
    ) : null

  // Formatting every section is only needed for printing; the panel
  // re-renders often (hover, scroll spy, progress, floating windows).
  const printable = (): PrintableSection[] =>
    entries
      .filter((entry) => entry.section?.status === 'ready')
      .map((entry) => ({
        id: entry.id,
        title: sectionTitle(entry, labels, t),
        ...(entry.section!.analysis
          ? { analysis: tidyBoxedPunctuation(entry.section!.analysis) }
          : {}),
        ...((sectionContent(entry.section!, shownLevel(entry)) ?? entry.section!).conclusion
          ? {
              conclusion: formatWalkthroughText(
                (sectionContent(entry.section!, shownLevel(entry)) ?? entry.section!).conclusion!,
              ),
            }
          : {}),
        body: formatWalkthroughText(
          (sectionContent(entry.section!, shownLevel(entry)) ?? entry.section!).body,
        ),
        ...(entry.section!.suggestions
          ? { suggestions: entry.section!.suggestions.map(tidyBoxedPunctuation) }
          : {}),
        ...(entry.question && isAlignedWith(entry.section, professorAnswerOf(entry.question))
          ? { aligned: true }
          : {}),
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
          {compareCount > 0 && compareAll && (
            <span className="inline-flex flex-wrap items-center gap-2" data-compare-prompt>
              <span className="text-xs text-muted-foreground">
                {t('homework.walkthrough.comparePrompt', { count: compareCount })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={running || !aiReady}
                title={aiReady ? undefined : t('homework.noProvider')}
                onClick={() => void compareAll().then(compareDone)}
              >
                <Scale className="h-4 w-4" aria-hidden />
                {t('homework.walkthrough.compareAll')}
              </Button>
            </span>
          )}
          {writtenCount > 0 && needsWork > 0 && !running && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-700 dark:text-amber-300"
            >
              {t('homework.walkthrough.needsWork', { count: needsWork })}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Secondary actions: buttons on wide screens, one menu below xl. */}
            <Button
              variant="outline"
              size="sm"
              className="hidden xl:inline-flex"
              disabled={running}
              onClick={() => setImportOpen(true)}
            >
              <FileUp className="h-4 w-4" />
              {t('walkthroughImport.open')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)}>
              <MessageSquareText className="h-4 w-4" />
              {t('walkthroughQA.myQuestions', { count: notes.length })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden xl:inline-flex"
              disabled={readyCount === 0}
              onClick={() => setPrinting(true)}
            >
              <Printer className="h-4 w-4" />
              {t('homework.walkthrough.print')}
            </Button>
            {readyQuestions.length > 0 &&
              (allDetailed ? (
                <Button variant="outline" size="sm" onClick={() => void switchAll('standard')}>
                  <AlignLeft className="h-4 w-4" />
                  {t('homework.walkthrough.allStandard')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={missingCount > 0 && running}
                  title={
                    missingCount > 0
                      ? t('homework.walkthrough.allDetailedHint', { count: missingCount })
                      : undefined
                  }
                  onClick={() => void switchAll('detailed')}
                >
                  <AlignJustify className="h-4 w-4" />
                  {t('homework.walkthrough.allDetailed')}
                </Button>
              ))}
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
                className="hidden xl:inline-flex"
                disabled={running}
                onClick={() => setConfirmRedo(true)}
              >
                <RotateCcw className="h-4 w-4" />
                {t('homework.walkthrough.regenerateAll')}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="xl:hidden"
                  aria-label={t('homework.walkthrough.moreActions')}
                  title={t('homework.walkthrough.moreActions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={running} onSelect={() => setImportOpen(true)}>
                  <FileUp className="h-4 w-4" />
                  {t('walkthroughImport.open')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={readyCount === 0} onSelect={() => setPrinting(true)}>
                  <Printer className="h-4 w-4" />
                  {t('homework.walkthrough.print')}
                </DropdownMenuItem>
                {writtenCount > 0 && (
                  <DropdownMenuItem disabled={running} onSelect={() => setConfirmRedo(true)}>
                    <RotateCcw className="h-4 w-4" />
                    {t('homework.walkthrough.regenerateAll')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
                ? t(
                    progress.section.analysis
                      ? 'homework.walkthrough.analyzing'
                      : progress.section.compare
                        ? 'homework.walkthrough.comparing'
                        : progress.section.variant
                          ? 'homework.walkthrough.generatingDetailed'
                          : 'homework.walkthrough.regenerating',
                    { title: regeneratingTitle(progress.section.id, entries, labels, t) },
                  )
                : t(
                    progress.variant
                      ? 'homework.walkthrough.variantProgress'
                      : progress.compare
                        ? 'homework.walkthrough.compareProgress'
                        : 'homework.walkthrough.progress',
                    {
                      done: progress.done,
                      total: progress.total,
                    },
                  )}
            </p>
            {Object.entries(progress.parts ?? {}).map(([sectionId, part]) => (
              <p key={sectionId} className="text-xs text-muted-foreground">
                {t('homework.walkthrough.writingPartOf', {
                  title: regeneratingTitle(sectionId, entries, labels, t),
                  part,
                })}
              </p>
            ))}
            {Object.entries(progress.attempts ?? {})
              // The opening and summary share one request: name it once.
              .filter(([sectionId]) => sectionId !== 'summary')
              .map(([sectionId, attempt]) => (
                <p key={sectionId} className="text-xs text-amber-700 dark:text-amber-300">
                  {regeneratingTitle(sectionId, entries, labels, t)}
                  {t('homework.walkthrough.titleSeparator')}
                  {attemptText(attempt, t)}
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
            <Button variant="outline" className="ml-2" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              {t('walkthroughImport.open')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lecture:lg:gap-12">
          <nav aria-label={t('homework.walkthrough.toc')} className="hidden lg:block">
            <div className="sticky top-4 space-y-3">
              <ol
                ref={tocRef}
                className="relative max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto text-sm lecture:space-y-0 lab:space-y-px lab:border lab:bg-card lab:p-1"
              >
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#wt-${entry.id}`}
                      aria-current={entry.id === activeId ? 'location' : undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        jumpTo(entry.id)
                      }}
                      className={cn(
                        // `!` so the 44px touch height also beats `lecture:py-1.5`.
                        'focus-ring block truncate rounded px-2 py-1 transition-colors duration-150 hover:bg-muted coarse:!py-3',
                        'lecture:rounded-none lecture:border-l lecture:py-1.5 lecture:pl-3 lecture:hover:border-primary lecture:hover:bg-transparent',
                        entry.section?.status === 'ready'
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                        entry.id === activeId &&
                          'bg-theme-primary-soft font-medium text-foreground lecture:border-l-2 lecture:border-primary lecture:bg-transparent lecture:pl-[11px] lecture:text-primary-strong lab:bg-muted lab:shadow-[inset_2px_0_0_hsl(var(--primary))]',
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
              {activeLevelToggle && (
                <div className="space-y-1.5 border-t pt-3" data-print-hidden>
                  <p className="truncate text-xs text-muted-foreground">{activeTitle}</p>
                  {activeLevelToggle}
                </div>
              )}
            </div>
          </nav>

          {/* Narrower screens: a compact contents menu (and the current section's
              普通 / 详细) that stays at the top while reading. */}
          <div
            className="sticky top-2 z-20 flex min-w-0 items-center gap-2 rounded-md border bg-card/95 px-1.5 py-1 shadow-sm backdrop-blur lecture:rounded-none lecture:border-x-0 lecture:bg-background/95 lecture:shadow-none lab:rounded-none lab:shadow-none lg:hidden"
            data-print-hidden
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  aria-label={
                    activeTitle
                      ? `${t('homework.walkthrough.toc')} · ${activeTitle}`
                      : t('homework.walkthrough.toc')
                  }
                >
                  <ListOrdered className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="shrink-0 text-muted-foreground">
                    {t('homework.walkthrough.toc')}
                  </span>
                  {activeTitle && <span className="min-w-0 truncate">{activeTitle}</span>}
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[60vh] overflow-y-auto"
                // Focus goes to the section, not back to the menu button.
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {entries.map((entry) => (
                  <DropdownMenuItem key={entry.id} onSelect={() => jumpTo(entry.id)}>
                    <Check
                      className={cn('h-4 w-4 shrink-0', entry.id !== activeId && 'invisible')}
                      aria-hidden
                    />
                    <span className="truncate">{sectionTitle(entry, labels, t)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {activeLevelToggle}
          </div>

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
                    projectId={set.projectId}
                    title={sectionTitle(entry, labels, t)}
                    marker={sectionMarker(entry, labels)}
                    running={progress?.running.includes(entry.id) ?? false}
                    runningPart={progress?.parts?.[entry.id]}
                    attempt={progress?.attempts?.[entry.id]}
                    analyzing={
                      progress?.section?.id === entry.id && progress.section.analysis === true
                    }
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
                          onAddAnalysis: () => void analyze(entry),
                        })}
                    level={sectionLevel(entry.section, defaultLevel)}
                    onLevel={(level: WalkthroughLevel) => void changeLevel(entry, level)}
                    sources={sectionSources(entry.section)}
                    {...(running ? {} : { onSource: (source) => void setSource(entry.id, source) })}
                    {...(running
                      ? {}
                      : { onGenerateDetailed: () => void writeDetailed([entry.id]) })}
                    writingDetailed={
                      progress?.section?.id === entry.id && progress.section.variant === true
                    }
                    comparing={
                      progress?.section?.id === entry.id && progress.section.compare === true
                    }
                    {...(running || !compareSection
                      ? {}
                      : {
                          onCompare: () => void compareSection(entry.id).then(compareDone),
                          onAlign: () => void align(entry),
                          onDismissCompare: () => void dismissCompare?.(entry.id),
                        })}
                    aiReady={aiReady}
                  />
                ))}
              </article>
              {entries.some(
                (entry) => entry.kind === 'summary' && entry.section?.status === 'ready',
              ) && <PracticeSetLauncher set={set} />}
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

      <ImportWalkthroughDialog set={set} open={importOpen} onOpenChange={setImportOpen} />

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
          sections={printable()}
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
  if (entry.kind === 'other') return t('walkthroughImport.otherTitle')
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

/** 第 2 次尝试：上次超时 */
function attemptText(attempt: SectionAttempt, t: T): string {
  return t('homework.walkthrough.attempt', {
    attempt: attempt.attempt,
    reason: failureText(attempt.lastFailure, t),
  })
}

function failureText(kind: SectionAttempt['lastFailure'], t: T): string {
  switch (kind) {
    case 'timeout':
    case 'truncated':
    case 'output-limit':
    case 'rate-limited':
    case 'unavailable':
    case 'invalid-response':
      return t(`homework.walkthrough.failure.${kind}` as TranslationKey)
    default:
      return t('homework.walkthrough.failure.other')
  }
}

/** The lab style's mono section number: Q1, Q2(a) … for questions, § otherwise. */
function sectionMarker(entry: WalkthroughPlanEntry, labels: ReadonlyMap<string, string>): string {
  if (!entry.question) return '§'
  return `Q${labels.get(entry.question.id) ?? '?'}`
}

interface SectionViewProps {
  entry: WalkthroughPlanEntry
  projectId: string
  title: string
  marker: string
  running: boolean
  /** Split question: the sub-part being written now (`b`). */
  runningPart?: string | undefined
  /** The request is being tried again, and why the last attempt failed. */
  attempt?: SectionAttempt | undefined
  /** Only the 题目分析 is being written (补充题目分析). */
  analyzing: boolean
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
  /** 补充题目分析 for a section written before the analysis existed. */
  onAddAnalysis?: () => void
  /** 生成的讲解 / 导入的讲解 available for this section, the shown one first. */
  sources: WalkthroughSource[]
  /** Show another source; absent while a run is in progress. */
  onSource?: (source: WalkthroughSource) => void
  /** 普通 / 详细: the version this section shows. */
  level: WalkthroughLevel
  onLevel: (level: WalkthroughLevel) => void
  /** Write the missing detailed version; absent while a run is in progress. */
  onGenerateDetailed?: () => void
  /** The detailed version of this section is being written. */
  writingDetailed: boolean
  /** It is being compared with the professor's answer. */
  comparing?: boolean
  /** 与教授答案对照; absent while a run is in progress. */
  onCompare?: () => void
  /** 按教授答案修改. */
  onAlign?: () => void
  /** 保持现状. */
  onDismissCompare?: () => void
  aiReady: boolean
}

function WalkthroughSectionView({
  entry,
  projectId,
  title,
  marker,
  running,
  runningPart,
  attempt,
  analyzing,
  notes,
  tucked,
  onOpenNote,
  onGenerate,
  onRegenerate,
  onContinueRegenerate,
  onRestore,
  onAddAnalysis,
  sources,
  onSource,
  level,
  onLevel,
  onGenerateDetailed,
  writingDetailed,
  comparing = false,
  onCompare,
  onAlign,
  onDismissCompare,
  aiReady,
}: SectionViewProps): JSX.Element {
  const { t } = useTranslation()
  const section = entry.section
  const professorAnswer = entry.question ? professorAnswerOf(entry.question) : undefined
  const aligned = isAlignedWith(section, professorAnswer)
  const report = currentCompare(section, professorAnswer)
  const canCompare =
    Boolean(onCompare) &&
    entry.kind === 'question' &&
    section?.status === 'ready' &&
    !!professorAnswer
  const draft = section?.draft
  // The version shown: the detailed one when chosen and written, else the standard one.
  const detailed = section ? detailedVariant(section) : undefined
  const content =
    section && level === 'detailed' && detailed
      ? (sectionContent(section, 'detailed') ?? section)
      : section
  // An imported walkthrough has one level: the author's.
  const showsLevels =
    entry.kind === 'question' && section?.status === 'ready' && section.origin !== 'imported'
  const shownSource = section ? sourceOf(section) : undefined
  const detailMissing = showsLevels && level === 'detailed' && !detailed
  const canRegenerate =
    Boolean(onRegenerate) &&
    entry.kind !== 'other' &&
    (section?.status === 'ready' || section?.status === 'insufficient')
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
            {analyzing
              ? t('homework.walkthrough.writingAnalysis')
              : comparing
                ? t('homework.walkthrough.comparingBadge')
                : runningPart
                  ? t('homework.walkthrough.writingPart', { part: runningPart })
                  : t('homework.walkthrough.writing')}
          </Badge>
        )}
        {running && attempt && (
          <Badge
            variant="outline"
            className="border-amber-500/50 text-amber-700 dark:text-amber-300"
          >
            {attemptText(attempt, t)}
          </Badge>
        )}
        {!running && entry.outdated && (
          <Badge variant="outline">{t('homework.walkthrough.outdated')}</Badge>
        )}
        {sources.length > 1 && shownSource && (
          <SourceToggle source={shownSource} sources={sources} onChange={onSource} />
        )}
        {showsLevels && <LevelToggle level={level} onChange={onLevel} busy={writingDetailed} />}
        {section?.status === 'ready' && section.origin === 'imported' && (
          <ImportedBadge projectId={projectId} documentId={section.sourceDocumentId} />
        )}
        {section?.status === 'ready' && aligned && <ProfessorAlignedBadge />}
        {(canRegenerate || canCompare || (onRestore && section?.previous)) && (
          <div className="ml-auto flex flex-wrap items-center gap-1" data-print-hidden>
            {canCompare && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!aiReady}
                title={aiReady ? undefined : t('homework.noProvider')}
                onClick={onCompare}
              >
                <Scale className="h-4 w-4" aria-hidden />
                {t('homework.walkthrough.compare')}
              </Button>
            )}
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
                title={
                  noProvider ??
                  (shownSource === 'imported'
                    ? t('homework.walkthrough.regenerateImportedHint')
                    : undefined)
                }
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
          {section.frameDraft && (
            <p className="text-sm text-muted-foreground">
              {t('homework.walkthrough.frameGroupsDone', {
                done: section.frameDraft.groups.filter(
                  (group) => section.frameDraft!.pieces[group.join(',')] !== undefined,
                ).length,
                total: section.frameDraft.groups.length,
              })}
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
          {entry.kind === 'question' &&
            (section.analysis ? (
              <QuestionAnalysis analysis={section.analysis} />
            ) : (
              onAddAnalysis &&
              !running && (
                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border/80 px-4 py-2 text-sm text-muted-foreground lecture:rounded-none lecture:border-x-0 lecture:px-0 lab:rounded-none"
                  data-print-hidden
                >
                  <span>{t('homework.walkthrough.analysisMissing')}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!aiReady}
                    title={noProvider}
                    onClick={onAddAnalysis}
                  >
                    <ListChecks className="h-4 w-4" aria-hidden />
                    {t('homework.walkthrough.addAnalysis')}
                  </Button>
                </div>
              )
            ))}
          {detailMissing && !writingDetailed && (
            <div
              className="flex max-w-[70ch] flex-wrap items-center gap-3 rounded-lg border border-dashed border-border/80 px-4 py-2 text-sm text-muted-foreground lecture:rounded-none lecture:border-x-0 lecture:px-0 lab:rounded-none"
              data-print-hidden
              data-detail-missing
            >
              <span>{t('homework.walkthrough.detailedMissing')}</span>
              {onGenerateDetailed && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!aiReady}
                  title={noProvider}
                  onClick={onGenerateDetailed}
                >
                  <AlignJustify className="h-4 w-4" aria-hidden />
                  {t('homework.walkthrough.generateDetailed')}
                </Button>
              )}
            </div>
          )}
          <WalkthroughBody
            text={content?.body ?? section.body}
            {...(content?.conclusion ? { conclusion: content.conclusion } : {})}
            {...(content?.parts ? { parts: content.parts } : {})}
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
                      text={formatWalkthroughText(item)}
                      format="markdown"
                      paragraphClassName={WALKTHROUGH_PARAGRAPH}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {content?.checks && content.checks.length > 0 && <ChecksView checks={content.checks} />}
          {/* The conclusion closes the question, after the worked solution. */}
          {content?.conclusion && (
            <div className="max-w-[70ch] rounded-lg border-l-4 border-primary bg-theme-primary-soft/40 px-4 py-3 lecture:rounded-none lecture:border-l-[3px] lecture:bg-transparent lecture:py-1 lab:rounded-none lab:border lab:border-l-2 lab:border-border lab:border-l-primary">
              <span className="text-sm font-semibold lecture:block lecture:text-xs lecture:font-normal lecture:tracking-[0.14em] lecture:text-muted-foreground lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
                {t('homework.walkthrough.conclusion')}
              </span>
              <RichText
                text={formatWalkthroughText(content.conclusion)}
                format="markdown"
                paragraphClassName="text-[15px] font-semibold leading-relaxed lecture:text-[17px] lecture:text-foreground"
              />
            </div>
          )}
          {section.issues && section.issues.length > 0 && (
            <ImportIssuesView issues={section.issues} />
          )}
          {report && (
            <ProfessorCompareView
              report={report}
              onAlign={onAlign}
              onDismiss={onDismissCompare}
              aiReady={aiReady}
            />
          )}
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

/** 普通 / 详细: a two-way switch in the section heading. */
function LevelToggle({
  level,
  onChange,
  busy,
  label,
}: {
  level: WalkthroughLevel
  onChange: (level: WalkthroughLevel) => void
  busy: boolean
  /** Accessible name; defaults to 讲解详略. */
  label?: string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={label ?? t('homework.walkthrough.levelGroup')}
      data-walkthrough-level={level}
      data-print-hidden
      className="inline-flex items-center overflow-hidden rounded-md border text-xs lecture:rounded-none lab:rounded-none lab:font-mono"
    >
      {(['standard', 'detailed'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={level === option}
          onClick={() => level !== option && onChange(option)}
          className={cn(
            'focus-ring px-2.5 py-1 transition-colors duration-150',
            level === option
              ? 'bg-primary-strong text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {busy && option === 'detailed' ? (
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
          ) : null}
          {t(`homework.walkthrough.level.${option}` as TranslationKey)}
        </button>
      ))}
    </div>
  )
}

/** 生成的讲解 / 导入的讲解: which source a section shows (only with both). */
function SourceToggle({
  source,
  sources,
  onChange,
}: {
  source: WalkthroughSource
  sources: WalkthroughSource[]
  /** Absent while a run is in progress (the toggle is shown, disabled). */
  onChange?: ((source: WalkthroughSource) => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const order: WalkthroughSource[] = ['generated', 'imported']
  return (
    <div
      role="group"
      aria-label={t('homework.walkthrough.sourceGroup')}
      data-walkthrough-source={source}
      data-print-hidden
      className="inline-flex items-center overflow-hidden rounded-md border text-xs lecture:rounded-none lab:rounded-none lab:font-mono"
    >
      {order
        .filter((option) => sources.includes(option))
        .map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={source === option}
            disabled={!onChange}
            onClick={() => source !== option && onChange?.(option)}
            className={cn(
              'focus-ring px-2.5 py-1 transition-colors duration-150 disabled:cursor-not-allowed',
              source === option
                ? 'bg-primary-strong text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`homework.walkthrough.source.${option}` as TranslationKey)}
          </button>
        ))}
    </div>
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
            text={tidyBoxedPunctuation(part.conclusion)}
            format="markdown"
            paragraphClassName="text-[15px] font-medium leading-relaxed"
          />
          <WalkthroughBody text={part.body} />
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
      <QuestionText
        question={question}
        className="mt-2"
        paragraphClassName="text-sm leading-relaxed"
      />
    </details>
  )
}

/** 题目分析: what is asked and what the answer looks like, before the conclusion. */
function QuestionAnalysis({ analysis }: { analysis: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <details
      open
      data-walkthrough-analysis
      className="group rounded-lg border border-border/70 px-4 py-2 text-sm lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:px-0 lab:rounded-none lab:border-dashed"
    >
      <summary className="cursor-pointer select-none font-medium text-muted-foreground lecture:text-xs lecture:font-normal lecture:tracking-[0.14em] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
        {t('homework.walkthrough.analysis')}
      </summary>
      <RichText
        text={tidyBoxedPunctuation(analysis)}
        format="markdown"
        className="mt-2 min-w-0 space-y-2"
        paragraphClassName="text-[15px] leading-relaxed lecture:text-[16px]"
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

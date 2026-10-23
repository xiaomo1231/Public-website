import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpenText,
  ClipboardCheck,
  Footprints,
  Loader2,
  PenLine,
  RotateCcw,
  ScanText,
  Sparkles,
  Timer,
} from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import type {
  ExamPaperRow,
  ExamPapersView,
  ExamPendingPaper,
  ExamWorkspaceView,
} from '@/services/studyPlanService'
import type { HomeworkService } from '@/services/homeworkService'
import { RECOGNITION_STALE_MS } from '@/services/homeworkService'
import { HOMEWORK_STATUS_LABEL_KEYS } from '@/entities/homework/types'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useAiMockService } from '@/features/exam/useAiMockService'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { startHomeworkRun } from '@/features/homework/homeworkRuns'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { AiMockDialog } from '@/widgets/exam/aiMock/AiMockDialog'
import { AiMockRows } from '@/widgets/exam/aiMock/AiMockRows'
import { ExamAnalysisContent } from '@/widgets/exam/ExamAnalysisContent'
import { PausedSetActions, SetProgress, SetRunControls } from '@/widgets/homework/SetRunStatus'
import { useTranslation } from '@/i18n'
import { fromWorkspace, paperEntryLinks } from './examLinks'
import { TabSection } from './TabSection'

const ROW_LIST = 'divide-y rounded-md border lab:rounded-none'

/** How often the tab re-reads local state while a paper is being read. */
const POLL_MS = 1500

/**
 * 考题与讲解: the past papers (picked for this exam first) and the homework
 * picked for it, whatever their state — a paper still being read shows its
 * progress with 暂停 / 立即停止 / 继续 (and 重新识别 when it failed) — with
 * direct entries to 完整讲解 / 做题 / 引导练习 / 校对 / 模拟考试 that lead
 * back here; the AI 模拟卷 for this exam; and the 题型与覆盖分析 of its
 * papers.
 *
 * Past-paper (and picked homework) files with no recognised set are read
 * automatically here too, one at a time, exactly as the 作业 page would; a
 * read cut off by a reload becomes 已暂停 (继续), never a bar that never moves.
 */
export function PapersTab({
  view,
  onChanged,
}: {
  view: ExamWorkspaceView
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const homework = useHomeworkService()
  const aiMockService = useAiMockService()
  const { exam } = view.context
  const [data, setData] = useState<ExamPapersView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ templateSetId?: string; setId?: string } | null>(null)
  const attempted = useRef<Set<string>>(new Set())
  const pid = exam.projectId

  const load = useCallback(async () => {
    try {
      if (homework) await homework.recoverInterrupted(pid)
      setData(await service.examPapers(exam.id))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [service, homework, exam.id, pid])
  useEffect(() => {
    void load()
  }, [load])

  /** Run one recognition (first read, re-read or 继续); one at a time. */
  const runRecognition = useCallback(
    async (
      documentId: string,
      start: (svc: HomeworkService, run: ReturnType<typeof startHomeworkRun>) => Promise<unknown>,
    ) => {
      if (!homework) return
      setBusy(documentId)
      setRunError(null)
      const run = startHomeworkRun(documentId)
      try {
        await start(homework, run)
      } catch (err) {
        if (!isGenerationInterruption(err, run)) setRunError(friendlyAIError(err))
      } finally {
        run.finish()
        setBusy(null)
        await load()
        onChanged()
      }
    },
    [homework, load, onChanged],
  )

  const recognize = useCallback(
    (documentId: string) =>
      runRecognition(documentId, (svc, run) =>
        svc.createFromDocument(documentId, { control: run }),
      ),
    [runRecognition],
  )
  const rerun = useCallback(
    (row: ExamPaperRow, kind: 'retry' | 'resume') => {
      if (!homework || homework.isRecognitionRunning(row.set)) return
      void runRecognition(row.set.documentId, (svc, run) =>
        kind === 'retry'
          ? svc.retrySet(row.set.id, { control: run })
          : svc.resumeSet(row.set.id, { control: run }),
      )
    },
    [homework, runRecognition],
  )

  // Read each ready file that has no set yet — once per visit, one at a time.
  useEffect(() => {
    if (!homework || !data || busy) return
    const next = data.pending.find(
      (entry) => entry.document.status === 'ready' && !attempted.current.has(entry.document.id),
    )
    if (!next) return
    attempted.current.add(next.document.id)
    void recognize(next.document.id)
  }, [homework, data, busy, recognize])

  // Keep progress live while anything is being read (local reads only).
  const active =
    busy !== null ||
    (data?.pending.some(
      (entry) => entry.document.status === 'processing' || entry.document.status === 'uploading',
    ) ??
      false) ||
    [...(data?.papers ?? []), ...(data?.homework ?? [])].some(
      (row) => row.set.status === 'analyzing',
    )
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, load])

  if (error) return <ErrorState title={t('examWorkspace.tab.papers')} description={error} />
  if (!data) return <LoadingState label={t('common.loading')} />

  const picked = data.papers.filter((row) => row.picked && row.set.status === 'ready')
  const analysisIds = picked.length > 0 ? picked.map((row) => row.set.id) : undefined
  const percents = new Map(data.aiMocks.map((row) => [row.set.id, row.lastPercent]))
  const pendingPapers = data.pending.filter((entry) => entry.kind === 'exam')
  const pendingHomework = data.pending.filter((entry) => entry.kind === 'homework')

  const rowProps = {
    exam,
    homework,
    busy,
    onRerun: rerun,
    onAiMock: (setId: string) => setDialog({ templateSetId: setId }),
    aiMockAvailable: Boolean(aiMockService),
  }

  return (
    <div className="space-y-10" data-workspace-papers>
      {runError && (
        <p className="text-sm text-destructive" role="alert" data-papers-error>
          {runError}
        </p>
      )}
      <TabSection
        title={t('examWorkspace.papersTitle')}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to={`/projects/${pid}/homework`}>{t('examWorkspace.openHomework')}</Link>
          </Button>
        }
      >
        {data.papers.length === 0 && pendingPapers.length === 0 ? (
          <EmptyState
            title={t('examWorkspace.papersNone')}
            description={t('examWorkspace.papersNoneHint')}
          />
        ) : (
          <ul className={ROW_LIST}>
            {pendingPapers.map((entry) => (
              <PendingRow
                key={entry.document.id}
                entry={entry}
                busy={busy}
                canRecognize={Boolean(homework)}
                onRecognize={() => void recognize(entry.document.id)}
              />
            ))}
            {data.papers.map((row) => (
              <PaperRow key={row.set.id} row={row} {...rowProps} />
            ))}
          </ul>
        )}
      </TabSection>

      {(data.homework.length > 0 || pendingHomework.length > 0) && (
        <TabSection title={t('examWorkspace.homeworkTitle')} data-workspace-homework>
          <ul className={ROW_LIST}>
            {pendingHomework.map((entry) => (
              <PendingRow
                key={entry.document.id}
                entry={entry}
                busy={busy}
                canRecognize={Boolean(homework)}
                onRecognize={() => void recognize(entry.document.id)}
              />
            ))}
            {data.homework.map((row) => (
              <PaperRow key={row.set.id} row={row} {...rowProps} />
            ))}
          </ul>
        </TabSection>
      )}

      <TabSection
        title={t('examWorkspace.aiMocksTitle')}
        action={
          data.papers.some((row) => row.set.status === 'ready') && (
            <Button
              size="sm"
              variant="outline"
              disabled={!aiMockService}
              onClick={() => setDialog({})}
              data-workspace-ai-mock
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t('aiMock.generate')}
            </Button>
          )
        }
      >
        {data.aiMocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('examWorkspace.aiMocksNone')}</p>
        ) : (
          <AiMockRows
            projectId={pid}
            sets={data.aiMocks.map((row) => row.set)}
            service={aiMockService}
            fromExam={exam.id}
            percentOf={(setId) => percents.get(setId)}
            onOpen={(setId) => setDialog({ setId })}
            onChanged={() => {
              void load()
              onChanged()
            }}
          />
        )}
      </TabSection>

      <TabSection title={t('examAnalysis.title')}>
        <ExamAnalysisContent
          projectId={pid}
          fromExam={exam.id}
          {...(analysisIds ? { setIds: analysisIds } : {})}
        />
      </TabSection>

      {dialog && aiMockService && (
        <AiMockDialog
          key={dialog.setId ?? dialog.templateSetId ?? 'new'}
          projectId={pid}
          service={aiMockService}
          open
          examId={exam.id}
          {...(dialog.templateSetId ? { templateSetId: dialog.templateSetId } : {})}
          {...(dialog.setId ? { setId: dialog.setId } : {})}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null)
              void load()
              onChanged()
            }
          }}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

function PaperRow({
  row,
  exam,
  homework,
  busy,
  onRerun,
  onAiMock,
  aiMockAvailable,
}: {
  row: ExamPaperRow
  exam: Pick<PlannedExam, 'id' | 'projectId'>
  homework: HomeworkService | null
  busy: string | null
  onRerun: (row: ExamPaperRow, kind: 'retry' | 'resume') => void
  onAiMock: (setId: string) => void
  aiMockAvailable: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const { set } = row
  const running = busy === set.documentId || Boolean(homework?.isRecognitionRunning(set))
  const interrupted =
    set.status === 'analyzing' &&
    !running &&
    Date.now() - Math.max(set.updatedAt, set.progress?.updatedAt ?? 0) > RECOGNITION_STALE_MS
  const hasQuestions = set.questionCount > 0 && set.status !== 'analyzing'
  const ready = set.status === 'ready'
  const icons = {
    mock: <Timer className="h-4 w-4" aria-hidden />,
    walkthrough: <BookOpenText className="h-4 w-4" aria-hidden />,
    practice: <PenLine className="h-4 w-4" aria-hidden />,
    guided: <Footprints className="h-4 w-4" aria-hidden />,
    proofread: <ClipboardCheck className="h-4 w-4" aria-hidden />,
  }
  const labels = {
    mock: t('mockExam.start'),
    walkthrough: t('examWorkspace.entry.walkthrough'),
    practice: t('examWorkspace.entry.practice'),
    guided: t('examWorkspace.entry.guided'),
    proofread: t('examWorkspace.proofreadOpen'),
  }
  return (
    <li
      className="space-y-2 px-3 py-3"
      data-paper-row={set.id}
      data-paper-kind={row.kind}
      data-paper-picked={row.picked}
      data-paper-status={set.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TruncatedText text={set.title} className="min-w-0 max-w-full flex-1 text-sm font-medium" />
        {row.kind === 'homework' && (
          <Badge variant="outline">{t('examWorkspace.homeworkBadge')}</Badge>
        )}
        {row.picked && row.kind === 'exam' && <Badge>{t('examWorkspace.pickedBadge')}</Badge>}
        {!ready && (
          <Badge variant={set.status === 'failed' ? 'destructive' : 'secondary'}>
            {t(HOMEWORK_STATUS_LABEL_KEYS[set.status])}
          </Badge>
        )}
        {row.lastPercent !== undefined && (
          <Badge variant="outline" data-paper-score>
            {t('examWorkspace.lastScore', { percent: row.lastPercent })}
          </Badge>
        )}
      </div>
      {set.questionCount > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('homework.questionsCount', { count: row.questions })}
          {' · '}
          {set.answerDocumentId || row.answered > 0
            ? t('examWorkspace.answersPaired', { matched: row.answered, total: row.questions })
            : t('examWorkspace.answersNone')}
          {row.answeredInline > 0 &&
            ` ${t('examWorkspace.answersInline', { count: row.answeredInline })}`}
          {' · '}
          {t('examWorkspace.proofread', { done: row.verified, total: row.questions })}
          {row.attempts > 0 && ` · ${t('examWorkspace.attempts', { count: row.attempts })}`}
        </p>
      )}

      {set.status === 'analyzing' &&
        (interrupted ? (
          <div className="space-y-2" data-paper-interrupted>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('homework.analysisInterrupted')}
            </p>
            <Button size="sm" variant="outline" onClick={() => onRerun(row, 'resume')}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('generation.resume')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2" data-paper-progress>
            <div className="min-w-[10rem] flex-1">
              <SetProgress set={set} />
            </div>
            <SetRunControls set={set} />
          </div>
        ))}
      {set.status === 'paused' && (
        <div className="max-w-sm" data-paper-paused>
          <PausedSetActions
            set={set}
            href={fromWorkspace(exam, `/projects/${exam.projectId}/homework/${set.id}`)}
            disabled={running}
            onResume={() => onRerun(row, 'resume')}
          />
        </div>
      )}
      {set.status === 'failed' && (
        <div className="space-y-2" data-paper-failed>
          {set.errorMessage && <p className="text-xs text-muted-foreground">{set.errorMessage}</p>}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRerun(row, 'retry')}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            {t('homework.retryAnalyze')}
          </Button>
        </div>
      )}

      {hasQuestions ? (
        <nav
          className="flex flex-wrap gap-1.5"
          aria-label={t('examWorkspace.entriesLabel', { name: set.title })}
          data-paper-entries
        >
          {paperEntryLinks(exam, row).map((link) => (
            <Button
              key={link.key}
              asChild
              size="sm"
              variant={
                link.key === 'mock' || (link.key === 'walkthrough' && row.kind !== 'exam')
                  ? 'default'
                  : 'outline'
              }
            >
              <Link to={link.to} data-paper-entry={link.key}>
                {icons[link.key]}
                {labels[link.key]}
              </Link>
            </Button>
          ))}
          {row.kind === 'exam' && ready && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!aiMockAvailable}
              onClick={() => onAiMock(set.id)}
              data-paper-ai-mock
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t('aiMock.generateFrom')}
            </Button>
          )}
        </nav>
      ) : (
        set.status !== 'failed' && (
          <p className="text-xs text-muted-foreground">{t('examWorkspace.paperNotReady')}</p>
        )
      )}
    </li>
  )
}

function PendingRow({
  entry,
  busy,
  canRecognize,
  onRecognize,
}: {
  entry: ExamPendingPaper
  busy: string | null
  canRecognize: boolean
  onRecognize: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { document } = entry
  const reading = busy === document.id
  const extracting = document.status === 'processing' || document.status === 'uploading'
  return (
    <li
      className="space-y-2 px-3 py-3"
      data-paper-pending={document.id}
      data-paper-kind={entry.kind}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TruncatedText
          text={document.name}
          className="min-w-0 max-w-full flex-1 text-sm font-medium"
        />
        {entry.kind === 'homework' && (
          <Badge variant="outline">{t('examWorkspace.homeworkBadge')}</Badge>
        )}
        {entry.picked && entry.kind === 'exam' && <Badge>{t('examWorkspace.pickedBadge')}</Badge>}
      </div>
      {document.status === 'failed' ? (
        <p className="text-xs text-muted-foreground">{t('examWorkspace.pendingFailed')}</p>
      ) : reading || extracting ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {reading ? t('examWorkspace.recognizing') : t('examWorkspace.pendingExtracting')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{t('examWorkspace.pendingWaiting')}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={!canRecognize || busy !== null}
            onClick={onRecognize}
            data-paper-recognize
          >
            <ScanText className="h-4 w-4" aria-hidden />
            {t('examWorkspace.recognize')}
          </Button>
        </div>
      )}
    </li>
  )
}

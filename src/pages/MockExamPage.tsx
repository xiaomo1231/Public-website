import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer, RotateCcw, Timer } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { FocusPageHeader } from '@/widgets/focus/FocusPageHeader'
import { FormulaSheetPanel } from '@/widgets/exam/FormulaSheetPanel'
import { MockExamResults } from '@/widgets/exam/MockExamResults'
import { AiMockNotice } from '@/widgets/exam/aiMock/AiMockNotice'
import { QuestionWindowButton, QuestionWindowLayer } from '@/widgets/homework/QuestionWindowLayer'
import { ExamAnswerInput } from '@/widgets/exam/ExamAnswerInput'
import { ExamModeChooser } from '@/widgets/exam/ExamModeChooser'
import { ExamHandwritingStage } from '@/widgets/exam/ExamHandwritingStage'
import { WalkthroughPrint } from '@/widgets/homework/walkthrough/WalkthroughPrint'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { useAuth } from '@/features/auth/useAuth'
import { MockExamService, type MockExamState } from '@/services/mockExamService'
import type { HandwritingRecognitionService } from '@/services/handwriting/recognition'
import { buildHandwritingRecognitionService } from '@/services/handwriting/buildRecognition'
import type { ExamAnswerMode, MockExamAttempt } from '@/entities/exam/types'
import { attemptMode } from '@/entities/exam/handwritingStage'
import { DEFAULT_HANDWRITING_RECOGNITION_MODE } from '@/entities/handwriting/types'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import { formatRemaining } from '@/widgets/exam/time'
import { QuestionMarketFigure } from '@/widgets/econ/QuestionMarketFigure'
import { MarketPartsAnswer } from '@/widgets/econ/MarketAnswerInput'
import { hasMarketParts, onlyMarketParts, sharedFigureLabel } from '@/entities/econ/partAnswers'

/**
 * 模拟考试 on a past paper: the original questions in paper order, a timer, no
 * hints / AI / walkthrough while writing, answers only after 交卷. Then each
 * answer is checked (local or AI) and shown with the professor's marking
 * scheme (verbatim, 教授评分标准) kept apart from the platform's estimates
 * (平台估计).
 */
export function MockExamPage(): JSX.Element {
  const { t, language } = useTranslation()
  const { id: projectId, assignmentId } = useParams<{ id: string; assignmentId: string }>()
  const homework = useHomeworkService()
  const { profile } = useAuth()
  const recognitionMode = profile?.handwritingRecognition ?? DEFAULT_HANDWRITING_RECOGNITION_MODE
  const [recognition, setRecognition] = useState<HandwritingRecognitionService | null>(null)
  useEffect(() => {
    let alive = true
    void buildHandwritingRecognitionService()
      .then((next) => alive && setRecognition(next))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const service = useMemo(
    () => (homework ? new MockExamService({ homework, recognition }) : null),
    [homework, recognition],
  )
  const [answerMode, setAnswerMode] = useState<ExamAnswerMode>('online')
  // Handwriting of the current attempt (tagged with it, locked once handed in).
  const examImages = useMemo(
    () => (service && assignmentId ? service.imageStore(assignmentId) : null),
    [service, assignmentId],
  )
  const [printing, setPrinting] = useState(false)
  const [handwritingActive, setHandwritingActive] = useState(false)
  // Writing areas save their ink here before the paper is handed in.
  const flushers = useRef(new Map<string, () => Promise<void>>())
  const registerFlush = useCallback((questionId: string, flush: (() => Promise<void>) | null) => {
    if (flush) flushers.current.set(questionId, flush)
    else flushers.current.delete(questionId)
  }, [])
  const [state, setState] = useState<MockExamState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const checkRun = useGenerationRun({ abortOnUnmount: true })
  const [checking, setChecking] = useState(false)
  const saveTimers = useRef(new Map<string, number>())
  const submitting = useRef(false)
  const checkLanguage: 'zh' | 'en' = language === 'zh-CN' ? 'zh' : 'en'

  const load = useCallback(async () => {
    if (!service || !assignmentId) return
    const next = await service.state(assignmentId)
    if (next.set.projectId !== projectId) throw new Error(t('mockExam.notFound'))
    setState(next)
    setMinutes((prev) => prev || String(next.defaultMinutes))
  }, [service, assignmentId, projectId, t])

  useEffect(() => {
    void load().catch((err) => setError(friendlyAIError(err)))
  }, [load])

  const attempt: MockExamAttempt | undefined = state?.set.exam?.current
  const writing = !!attempt && !attempt.submittedAt
  const shown: MockExamAttempt | undefined = attempt?.submittedAt
    ? attempt
    : state?.set.exam?.attempts?.[0]

  // The clock: ticks while writing; time out submits automatically.
  useEffect(() => {
    if (!writing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [writing])

  const runCheck = useCallback(async () => {
    if (!service || !assignmentId) return
    const run = checkRun.start()
    setChecking(true)
    setCheckError(null)
    try {
      await service.check(assignmentId, checkLanguage, {
        control: run,
        onProgress: () => void load(),
      })
    } catch (err) {
      setCheckError(friendlyAIError(err))
    } finally {
      run.finish()
      setChecking(false)
      await load().catch(() => undefined)
    }
  }, [service, assignmentId, checkRun, checkLanguage, load])

  const submit = useCallback(
    async (timedOut = false) => {
      if (!service || !assignmentId || submitting.current) return
      submitting.current = true
      try {
        // Answers typed in the last moments are saved before the paper is frozen.
        for (const timer of saveTimers.current.values()) window.clearTimeout(timer)
        saveTimers.current.clear()
        const answers = state?.set.exam?.current?.answers ?? {}
        for (const [questionId, text] of Object.entries(answers))
          await service.saveAnswer(assignmentId, questionId, text)
        // Pending pen ink of the writing areas is saved before the paper is frozen.
        for (const flush of flushers.current.values()) await flush().catch(() => undefined)
        await service.submit(assignmentId, { timedOut })
        await load()
      } finally {
        submitting.current = false
      }
      // Handwriting is recognised and confirmed first (ExamHandwritingStage);
      // only a typed-only attempt goes straight to checking.
      const handwriting = await service.handwriting(assignmentId)
      const mode = attemptMode(state?.set.exam?.current ?? {})
      if (mode !== 'paper' && !handwriting.items.some((item) => item.imageKey)) void runCheck()
    },
    [service, assignmentId, load, runCheck, state],
  )

  const timedOut = writing && attempt && now >= attempt.endsAt
  useEffect(() => {
    if (timedOut) void submit(true)
  }, [timedOut, submit])

  if (!projectId) return <div />
  if (error)
    return (
      <PageContainer>
        <PageContent>
          <ErrorState title={t('mockExam.title')} description={error} />
        </PageContent>
      </PageContainer>
    )
  if (!state || !service)
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('common.loading')} />
        </PageContent>
      </PageContainer>
    )

  const set = state.set
  const currentMode: ExamAnswerMode = attempt ? attemptMode(attempt) : 'online'
  const allMarked =
    state.questions.length > 0 && state.questions.every((view) => view.marks.total !== undefined)
  const paperMarks = state.questions.reduce((sum, view) => sum + (view.marks.total ?? 0), 0)

  const saveAnswer = (questionId: string, text: string) => {
    setState((prev) => {
      if (!prev?.set.exam?.current) return prev
      const current = prev.set.exam.current
      return {
        ...prev,
        set: {
          ...prev.set,
          exam: {
            ...prev.set.exam,
            current: { ...current, answers: { ...current.answers, [questionId]: text } },
          },
        },
      }
    })
    const timers = saveTimers.current
    window.clearTimeout(timers.get(questionId))
    timers.set(
      questionId,
      window.setTimeout(() => {
        timers.delete(questionId)
        void service.saveAnswer(set.id, questionId, text)
      }, 400),
    )
  }

  return (
    <PageContainer>
      {/* 专注子页面: back header; while the paper is being written there is no way back but handing in. */}
      <FocusPageHeader
        {...(writing
          ? {}
          : { backTo: `/projects/${projectId}/homework`, backLabel: t('projectNav.homework') })}
        title={t('mockExam.titleFor', { title: set.title })}
        actions={
          writing && attempt ? (
            <div className="flex items-center gap-2">
              <span
                role="timer"
                aria-live="off"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 font-mono text-sm tabular-nums"
                data-exam-timer
              >
                <Timer className="h-4 w-4" aria-hidden />
                {formatRemaining(attempt.endsAt - now)}
              </span>
              <Button onClick={() => setConfirmSubmit(true)}>
                <CheckCircle2 className="h-4 w-4" />
                {t('mockExam.submit')}
              </Button>
            </div>
          ) : undefined
        }
      />
      <PageContent className="space-y-5">
        {/* AI 模拟卷: the disclaimer always; before writing, the questions it lacks. */}
        {state.aiMock && <AiMockNotice report={state.aiMock} detailed={!writing} />}
        {!writing && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('mockExam.setupTitle')}</CardTitle>
              <CardDescription>
                {t('mockExam.setupSummary', { count: state.questions.length })}
                {allMarked ? ` · ${t('mockExam.paperMarks', { marks: paperMarks })}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>{t('mockExam.rule.original')}</li>
                <li>{t('mockExam.rule.noHelp')}</li>
                <li>{t('mockExam.rule.answersAfter')}</li>
                {state.formulaSheet && <li>{t('mockExam.rule.formulaSheet')}</li>}
                {state.missingReference > 0 && (
                  <li className="text-amber-700 dark:text-amber-400">
                    {t('mockExam.rule.missingReference', { count: state.missingReference })}
                  </li>
                )}
              </ul>
              <ExamModeChooser value={answerMode} onChange={setAnswerMode} disabled={checking} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mock-exam-minutes">{t('mockExam.minutes')}</Label>
                  <Input
                    id="mock-exam-minutes"
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={600}
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    className="w-28"
                  />
                </div>
                <p className="pb-2 text-xs text-muted-foreground">
                  {state.detectedMinutes !== undefined
                    ? t('mockExam.detectedMinutes', { minutes: state.detectedMinutes })
                    : t('mockExam.noDetectedMinutes')}
                </p>
                <Button
                  className="ml-auto"
                  disabled={state.questions.length === 0 || checking}
                  onClick={async () => {
                    const value = Number(minutes)
                    await service.start(
                      set.id,
                      Number.isFinite(value) && value > 0 ? value : state.defaultMinutes,
                      answerMode,
                    )
                    setNow(Date.now())
                    await load()
                  }}
                >
                  <Timer className="h-4 w-4" />
                  {t('mockExam.begin')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {writing && attempt && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ol className="space-y-6" aria-label={t('mockExam.questions')}>
              {state.questions.map((view, index) => (
                <li key={view.question.id} className="space-y-2 border-b pb-5" data-exam-question>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {t('mockExam.questionLabel', {
                        number: view.question.number ?? String(index + 1),
                      })}
                    </span>
                    {/* Only the question text; no new translation is asked for while writing. */}
                    <QuestionWindowButton
                      question={view.question}
                      label={view.question.number ?? String(index + 1)}
                      translationMode="cached"
                    />
                    {view.marks.total !== undefined && (
                      <Badge variant="outline">
                        {t('mockExam.marksBadge', { marks: view.marks.total })}
                      </Badge>
                    )}
                    {view.marks.parts.map((part) => (
                      <Badge key={part.label} variant="secondary">
                        ({part.label}) {t('mockExam.marksBadge', { marks: part.marks })}
                      </Badge>
                    ))}
                  </div>
                  <RichText
                    text={formatHomeworkQuestion(view.question.prompt)}
                    format="markdown"
                    className="space-y-2"
                  />
                  {/* A figure group's shared diagram is printed once, before its first question. */}
                  {sharedFigureLabel(state.questions, index) ? (
                    <p className="text-xs text-muted-foreground" data-same-figure>
                      {t('marketQ.figure.sameAsAbove', {
                        label: sharedFigureLabel(state.questions, index)!,
                      })}
                    </p>
                  ) : (
                    <QuestionMarketFigure question={view.question} />
                  )}
                  {currentMode !== 'paper' && hasMarketParts(view.question.practice?.parts) && (
                    <MarketPartsAnswer
                      parts={view.question.practice!.parts}
                      value={attempt.answers[view.question.id] ?? ''}
                      onChange={(text) => saveAnswer(view.question.id, text)}
                      showFigure={false}
                    />
                  )}
                  <ExamAnswerInput
                    hideText={onlyMarketParts(view.question.practice?.parts)}
                    mode={currentMode}
                    setId={set.id}
                    questionId={view.question.id}
                    number={view.question.number ?? String(index + 1)}
                    value={attempt.answers[view.question.id] ?? ''}
                    onChange={(text) => saveAnswer(view.question.id, text)}
                    service={service}
                    store={examImages!}
                    registerFlush={registerFlush}
                  />
                </li>
              ))}
            </ol>
            <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
              {currentMode === 'paper' && (
                <Button variant="outline" className="h-11 w-full" onClick={() => setPrinting(true)}>
                  <Printer className="h-4 w-4" aria-hidden />
                  {t('examMode.print')}
                </Button>
              )}
              {state.formulaSheet ? (
                <FormulaSheetPanel
                  sheet={state.formulaSheet}
                  setId={set.id}
                  projectId={projectId}
                  documentId={set.documentId}
                  service={service}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t('mockExam.noFormulaSheet')}</p>
              )}
              <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)}>
                <RotateCcw className="h-4 w-4" />
                {t('mockExam.discard')}
              </Button>
            </div>
          </div>
        )}

        {/* After 交卷: upload (纸上作答), recognise, confirm — before any grading. */}
        {!writing && attempt?.submittedAt && !attempt.checkedAt && (
          <ExamHandwritingStage
            service={service}
            state={state}
            attempt={attempt}
            mode={recognitionMode}
            language={checkLanguage}
            checking={checking}
            onChanged={load}
            onStartCheck={() => void runCheck()}
            onActiveChange={setHandwritingActive}
          />
        )}

        {!writing && shown && (
          <div className="space-y-3">
            {(checking || (shown.submittedAt && !shown.checkedAt && !handwritingActive)) && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {checking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                <span>
                  {t('mockExam.checking', {
                    done: shown.results?.length ?? 0,
                    total: state.questions.length,
                  })}
                </span>
                <GenerationControls
                  kind="parts"
                  state={checkRun.state}
                  onPause={checkRun.requestPause}
                  onStopNow={checkRun.stopNow}
                  onResume={() => void runCheck()}
                />
                {!checking && (
                  <Button size="sm" variant="outline" onClick={() => void runCheck()}>
                    {t('mockExam.continueCheck')}
                  </Button>
                )}
              </div>
            )}
            {checkError && <p className="text-sm text-destructive">{checkError}</p>}
            <MockExamResults projectId={projectId} state={state} attempt={shown} />
          </div>
        )}
      </PageContent>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title={t('mockExam.submitConfirmTitle')}
        description={
          currentMode === 'online'
            ? t('mockExam.submitConfirm', {
                answered: Object.values(attempt?.answers ?? {}).filter((text) => text.trim())
                  .length,
                total: state.questions.length,
              })
            : t(currentMode === 'paper' ? 'examMode.submitPaper' : 'examMode.submitTablet')
        }
        confirmLabel={t('mockExam.submit')}
        onConfirm={async () => {
          setConfirmSubmit(false)
          await submit(false)
        }}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('mockExam.discardTitle')}
        description={t('mockExam.discardConfirm')}
        variant="destructive"
        confirmLabel={t('mockExam.discard')}
        onConfirm={async () => {
          setConfirmDiscard(false)
          await service.discard(set.id)
          await load()
        }}
      />
      <QuestionWindowLayer setId={set.id} />
      {/* 只看题目 / 打印: the questions alone, for writing on paper. */}
      {printing && (
        <WalkthroughPrint
          title={set.title}
          sections={state.questions.map((view, index) => ({
            id: view.question.id,
            title: [
              t('mockExam.questionLabel', { number: view.question.number ?? String(index + 1) }),
              view.marks.total !== undefined
                ? t('mockExam.marksBadge', { marks: view.marks.total })
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
            body: formatHomeworkQuestion(view.question.prompt),
          }))}
          onDone={() => setPrinting(false)}
        />
      )}
    </PageContainer>
  )
}

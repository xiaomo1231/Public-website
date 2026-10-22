import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import type { MockExamAttempt } from '@/entities/exam/types'
import {
  examStage,
  questionsNeedingRecognition,
  unconfirmedQuestions,
} from '@/entities/exam/handwritingStage'
import type { HandwritingRecognitionMode } from '@/entities/handwriting/types'
import type {
  MockExamHandwriting,
  MockExamService,
  MockExamState,
} from '@/services/mockExamService'
import { PaperAnswerUpload } from './PaperAnswerUpload'
import { TranscriptConfirmPanel, type TranscriptItem } from './TranscriptConfirmPanel'

/**
 * After 交卷, before grading: (纸上作答) upload and assign the page photos,
 * then recognise every handwritten answer, then the student confirms each
 * transcript next to the original. Grading starts only when all are
 * confirmed — the grader sees the confirmed text, never the images.
 * Renders nothing when the attempt has no handwriting to confirm.
 */
export function ExamHandwritingStage({
  service,
  state,
  attempt,
  mode,
  language,
  checking,
  onChanged,
  onStartCheck,
  onActiveChange,
}: {
  service: MockExamService
  state: MockExamState
  attempt: MockExamAttempt
  mode: HandwritingRecognitionMode
  language: 'zh' | 'en'
  checking: boolean
  onChanged: () => Promise<void>
  onStartCheck: () => void
  /** Told whether upload / recognition / confirmation is in progress (before grading). */
  onActiveChange?: (active: boolean) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const setId = state.set.id
  const [handwriting, setHandwriting] = useState<MockExamHandwriting | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const run = useGenerationRun({ abortOnUnmount: true })
  const autoStarted = useRef<string | null>(null)
  const store = useMemo(() => service.imageStore(setId), [service, setId])

  const reload = useCallback(async () => {
    setHandwriting(await service.handwriting(setId))
  }, [service, setId])

  useEffect(() => {
    void reload().catch((err) => setError(friendlyAIError(err)))
  }, [reload, attempt.transcripts, attempt.uploadsDoneAt])

  const keys = useMemo(
    () =>
      Object.fromEntries(
        (handwriting?.items ?? []).map((item) => [item.questionId, item.imageKey]),
      ) as Record<string, string>,
    [handwriting],
  )
  const stage = examStage(attempt, keys)

  const recognize = useCallback(
    async (questionIds?: string[]) => {
      const control = run.start()
      setRecognizing(true)
      setError(null)
      try {
        await service.recognize(setId, language, {
          mode,
          control,
          ...(questionIds ? { questionIds } : {}),
          onProgress: setProgress,
        })
      } catch (err) {
        setError(friendlyAIError(err))
      } finally {
        control.finish()
        setRecognizing(false)
        setProgress(null)
        await onChanged().catch(() => undefined)
        await reload().catch(() => undefined)
      }
    },
    [run, service, setId, language, mode, onChanged, reload],
  )

  // Recognition starts by itself once, when the paper is in and handwriting waits.
  const needing = handwriting ? questionsNeedingRecognition(keys, attempt.transcripts) : []
  useEffect(() => {
    if (stage !== 'transcribe' || recognizing || needing.length === 0) return
    if (autoStarted.current === attempt.id) return
    autoStarted.current = attempt.id
    void recognize()
  }, [stage, recognizing, needing.length, attempt.id, recognize])

  // Whether this stage stands before grading (the page hides its check bar meanwhile).
  const hasHandwriting = Object.values(keys).some(Boolean)
  const active =
    !!handwriting &&
    (stage === 'upload' ||
      (hasHandwriting &&
        (stage === 'transcribe' || (stage === 'check' && !attempt.results?.length))))
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  if (!handwriting) return null
  const numbers = new Map(
    state.questions.map((view, index) => [
      view.question.id,
      view.question.number ?? String(index + 1),
    ]),
  )

  if (stage === 'upload')
    return (
      <PaperAnswerUpload
        questions={state.questions.map((view) => ({
          id: view.question.id,
          number: numbers.get(view.question.id)!,
        }))}
        handwriting={handwriting}
        store={store}
        onChanged={reload}
        onDone={async () => {
          await service.finishUploads(setId)
          await onChanged()
        }}
      />
    )

  const items: TranscriptItem[] = handwriting.items
    .filter((item) => item.imageKey)
    .map((item) => ({
      questionId: item.questionId,
      number: numbers.get(item.questionId) ?? '',
      images: item.images,
      imageKey: item.imageKey,
      ...(item.transcript ? { transcript: item.transcript } : {}),
    }))
  if (items.length === 0 || stage === 'writing') return null
  const pending = unconfirmedQuestions(keys, attempt.transcripts)
  if (!active) return null
  return (
    <div className="space-y-3" data-exam-handwriting-stage>
      {(recognizing || run.state === 'paused' || run.state === 'stopped') && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {recognizing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          <span>
            {progress
              ? t('transcript.recognizing', { done: progress.completed, total: progress.total })
              : t('transcript.recognizingStart')}
          </span>
          <GenerationControls
            kind="parts"
            state={run.state}
            onPause={run.requestPause}
            onStopNow={run.stopNow}
            onResume={() => void recognize()}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <TranscriptConfirmPanel
        items={items}
        busy={recognizing || checking}
        onConfirm={async (questionId, text) => {
          await service.confirmTranscript(setId, questionId, text)
          await onChanged()
        }}
        onRecognize={(ids) => void recognize(ids)}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {pending.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('transcript.gradeAfterConfirm', { count: pending.length })}
              </span>
            )}
            <Button
              type="button"
              className="h-11"
              disabled={pending.length > 0 || recognizing || checking}
              onClick={onStartCheck}
              data-start-grading
            >
              <ClipboardCheck aria-hidden />
              {t('transcript.startGrading')}
            </Button>
          </div>
        }
      />
    </div>
  )
}

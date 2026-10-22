import { useCallback, useEffect, useState } from 'react'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { AnswerImages } from '@/widgets/handwriting/AnswerImages'
import { WritingArea } from '@/widgets/handwriting/WritingArea'
import type { ExamAnswerMode } from '@/entities/exam/types'
import type { HomeworkAnswerImage } from '@/entities/homework/answerImages'
import type { ExamImageStore, MockExamService } from '@/services/mockExamService'
import { useTranslation } from '@/i18n'

/**
 * The answer space under one question while the paper is written, by mode:
 * - online: a text box, and handwritten pages may be added;
 * - tablet: a writing area on the paper (pen, autosaved);
 * - paper:  nothing — the student writes on paper and uploads after 交卷.
 * Nothing here asks the AI: handwriting is read only after submitting.
 */
export function ExamAnswerInput({
  mode,
  setId,
  questionId,
  number,
  value,
  onChange,
  service,
  store,
  registerFlush,
}: {
  mode: ExamAnswerMode
  setId: string
  questionId: string
  number: string
  value: string
  onChange: (text: string) => void
  service: MockExamService
  store: ExamImageStore
  registerFlush: (questionId: string, flush: (() => Promise<void>) | null) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const [initial, setInitial] = useState<HomeworkAnswerImage[] | null>(null)

  useEffect(() => {
    if (mode !== 'tablet') return
    let alive = true
    void store
      .list(questionId)
      .then((rows) => alive && setInitial(rows))
      .catch(() => alive && setInitial([]))
    return () => {
      alive = false
    }
  }, [mode, questionId, store])

  const register = useCallback(
    (flush: (() => Promise<void>) | null) => registerFlush(questionId, flush),
    [questionId, registerFlush],
  )

  if (mode === 'paper')
    return (
      <p className="text-xs text-muted-foreground" data-paper-answer-note>
        {t('examMode.paperAnswerNote')}
      </p>
    )

  if (mode === 'tablet')
    return initial ? (
      <WritingArea
        label={t('examMode.writingAreaFor', { number })}
        initial={initial.filter((image) => image.writingPage !== undefined)}
        registerFlush={register}
        onSave={(pages) => service.saveWritingArea(setId, questionId, pages)}
      />
    ) : null

  return (
    <>
      <Label htmlFor={`exam-answer-${questionId}`} className="sr-only">
        {t('mockExam.answerFor', { number })}
      </Label>
      <Textarea
        id={`exam-answer-${questionId}`}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('mockExam.answerPlaceholder')}
      />
      <AnswerImages questionId={questionId} service={store} />
    </>
  )
}

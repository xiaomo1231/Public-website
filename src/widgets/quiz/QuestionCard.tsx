import { targetHintKey } from '@/shared/lib/language'
import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, Lightbulb, Loader2, XCircle } from 'lucide-react'
import { QUESTION_TYPE_LABEL_KEYS, type Question } from '@/entities/question/types'
import { EVAL_METHOD_LABEL_KEYS, type QuestionEvaluation } from '@/entities/questionAttempt/types'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { RichText } from '@/shared/ui/RichText'
import { AnswerInput } from './AnswerInput'
import { QuestionSource } from './QuestionSource'
import { ShortAnswerFeedback } from './ShortAnswerFeedback'
import { isKeyboardChoice, keyboardKeysLabel, useQuizKeyboard } from './quizKeyboard'
import { cn } from '@/shared/lib/utils'
import { difficultyLabelKey } from '@/infrastructure/ai/prompts/types'
import { useTranslation } from '@/i18n'

export interface QuestionCardProps {
  question: Question
  index: number
  total: number
  difficulty: string
  value: string
  onChange: (value: string) => void
  /** Called with how many hints were revealed before submitting. */
  onSubmit: (hintsUsed: number) => void
  onNext: () => void
  busy?: boolean
  evaluation?: QuestionEvaluation | null
  isLast: boolean
  /** Short answers: dispute the AI judgement of this answer. */
  onDispute?: () => void
  disputing?: boolean
}

export function QuestionCard({
  question,
  index,
  total,
  difficulty,
  value,
  onChange,
  onSubmit,
  onNext,
  busy,
  evaluation,
  isLast,
  onDispute,
  disputing,
}: QuestionCardProps): JSX.Element {
  const { t } = useTranslation()
  const [hintIndex, setHintIndex] = useState(0)
  const answered = evaluation !== null && evaluation !== undefined
  const trySubmit = () => {
    if (!busy && !answered && value.trim()) onSubmit(hintIndex)
  }
  useQuizKeyboard({ question, value, onChange, onSubmit: trySubmit, enabled: !busy && !answered })
  const keyboardChoice = isKeyboardChoice(question)

  return (
    <Card className="lecture:border-transparent lecture:bg-transparent lecture:shadow-none">
      {/* lecture: one quiet meta line. lab: a hairline strip of mono readout cells. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-6 text-[13px] text-muted-foreground lecture:px-0 lecture:pt-0 lab:gap-0 lab:border-b lab:px-0 lab:pt-0 lab:font-mono lab:text-[11.5px]">
        <span className={META_CELL}>
          <span className="data-num lab:sr-only">
            {t('question.label', { number: index + 1, total })}
          </span>
          <span className="data-num hidden lab:inline" aria-hidden>
            Q <b className="font-semibold text-foreground">{String(index + 1).padStart(2, '0')}</b>{' '}
            / {String(total).padStart(2, '0')}
          </span>
        </span>
        <span className={META_CELL}>{t(difficultyLabelKey(difficulty))}</span>
        <span className={META_CELL}>{t(QUESTION_TYPE_LABEL_KEYS[question.type])}</span>
        {question.origin === 'ai_without_source' && (
          <span className={cn(META_CELL, 'text-amber-700 dark:text-amber-400')}>
            {t('question.aiWithoutSource')}
          </span>
        )}
        {question.knowledgePoint && (
          <span className={cn(META_CELL, 'min-w-0 max-w-full truncate lab:ml-auto lab:border-r-0')}>
            {question.knowledgePoint}
          </span>
        )}
      </div>
      <CardContent className="space-y-4 pt-4 lecture:space-y-6 lecture:px-0 lecture:pt-3.5 lab:space-y-5 lab:px-6 lab:pt-5">
        {/* Markdown: code blocks (code-output questions) and LaTeX render. */}
        <RichText
          text={question.prompt}
          format="markdown"
          paragraphClassName="text-[15px] font-medium leading-[1.7] lecture:font-heading lecture:text-[21px] lecture:font-semibold lecture:leading-[1.75] lecture:text-foreground lab:text-[17px] lab:font-normal lab:leading-[1.75]"
        />

        <AnswerInput
          question={question}
          value={value}
          onChange={onChange}
          disabled={busy || answered}
          revealed={answered}
          onSubmit={trySubmit}
        />

        {hintIndex > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20">
            <div className="mb-1 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <Lightbulb className="h-4 w-4" /> {t('question.hints')}
            </div>
            <ul className="ml-5 list-disc text-amber-800/90 dark:text-amber-200/90">
              {question.hints.slice(0, hintIndex).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {answered && evaluation && question.type === 'short_answer' ? (
          <ShortAnswerFeedback
            evaluation={evaluation}
            {...(onDispute ? { onDispute } : {})}
            {...(disputing !== undefined ? { disputing } : {})}
          />
        ) : (
          answered && evaluation && <EvaluationBox evaluation={evaluation} />
        )}

        {answered && (
          <QuestionSource
            sourceRefs={question.sourceRefs}
            projectId={question.projectId}
            aiWithoutSource={question.origin === 'ai_without_source'}
          />
        )}
      </CardContent>

      <div className="flex flex-wrap items-center gap-2 px-6 pb-6 lecture:gap-2.5 lecture:px-0 lecture:pt-3 lab:rounded-b-[inherit] lab:border-t lab:bg-background lab:py-3">
        {!answered ? (
          <>
            <Button onClick={() => onSubmit(hintIndex)} disabled={busy || !value.trim()}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {t('question.submit')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setHintIndex((i) => Math.min(i + 1, question.hints.length))}
              disabled={busy || hintIndex >= question.hints.length}
            >
              <Lightbulb className="h-4 w-4" />
              {hintIndex === 0
                ? t('question.showHint')
                : t('question.nextHint', { remaining: `${hintIndex}/${question.hints.length}` })}
            </Button>
            {keyboardChoice && <KeyboardHint keys={keyboardKeysLabel(question)} />}
          </>
        ) : (
          <Button onClick={onNext}>
            {isLast ? t('question.seeResults') : t('question.next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  )
}

const META_CELL = 'lab:border-r lab:border-border lab:px-3.5 lab:py-2.5'

/** "按 A–D 选择，Enter 提交" with the keys set as keycaps. Pointer-and-keyboard devices only. */
function KeyboardHint({ keys }: { keys: string }): JSX.Element {
  const { t } = useTranslation()
  const enter = 'Enter'
  const text = t('question.keyboardHint', { keys, enter })
  const parts = text.split(new RegExp(`(${keys}|${enter})`))
  return (
    <span
      data-testid="quiz-keyboard-hint"
      className="ml-auto hidden text-[13px] text-muted-foreground lab:font-mono lab:text-[11.5px] [@media(hover:hover)_and_(pointer:fine)]:inline"
    >
      {parts.map((part, i) =>
        part === keys || part === enter ? (
          <kbd
            key={i}
            className="mx-0.5 rounded border border-b-2 border-input px-1.5 py-px font-mono text-[11.5px] text-muted-foreground lab:mx-0 lab:border-0 lab:px-0 lab:py-0 lab:text-foreground"
          >
            {part}
          </kbd>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

function EvaluationBox({ evaluation }: { evaluation: QuestionEvaluation }): JSX.Element {
  const { t } = useTranslation()
  const isCorrect = evaluation.isCorrect
  const tone =
    isCorrect === true
      ? 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20'
      : isCorrect === false
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20'
  const icon =
    isCorrect === true ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : isCorrect === false ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <AlertCircle className="h-4 w-4 text-amber-600" />
    )
  const label =
    isCorrect === true
      ? t('question.correct')
      : isCorrect === false
        ? t('question.incorrect')
        : t('question.unverified')

  return (
    <div className={cn('space-y-2 rounded-lg border p-3 text-sm', tone)}>
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {label}
        <span translate="no" className="notranslate ml-auto text-xs text-muted-foreground">
          {t(EVAL_METHOD_LABEL_KEYS[evaluation.method])} · {Math.round(evaluation.confidence * 100)}
          %
        </span>
      </div>
      {(evaluation.method === 'multi_select' ||
        evaluation.method === 'match_items' ||
        evaluation.method === 'blank_match' ||
        evaluation.method === 'article_gender' ||
        evaluation.method === 'paradigm_cells') &&
        evaluation.score &&
        evaluation.score.total > 0 && (
          <p className="data-num text-xs font-medium">
            {t('answerInput.partialScore', {
              earned: evaluation.score.earned,
              total: evaluation.score.total,
              percent: Math.round((evaluation.score.earned / evaluation.score.total) * 100),
            })}
            {evaluation.normalizedUser && (
              <span className="ml-2 font-normal text-muted-foreground">
                {t('answerInput.yourAnswer', { value: evaluation.normalizedUser })}
              </span>
            )}
          </p>
        )}
      {evaluation.blanks && (
        <ul className="space-y-0.5 text-xs">
          {evaluation.blanks.map((blank, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2">
              {blank.correct ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              <span translate="no" className="notranslate">
                {blank.label ? `${blank.label}: ` : `(${i + 1}) `}
                {blank.given || '—'}
              </span>
              {blank.byAi && <span className="text-muted-foreground">{t('fillBlank.byAi')}</span>}
              {blank.spelling && blank.expectedForm && (
                <span className="font-medium text-foreground">
                  {t(targetHintKey(blank.spelling, blank.expectedForm, blank.given)!, {
                    answer: blank.expectedForm,
                  })}
                  {t('fillBlank.halfCredit')}
                </span>
              )}
              {!blank.correct && !blank.spelling && (
                <span className="text-muted-foreground">
                  {t('fillBlank.accepted', { answers: blank.accepted.join(' / ') })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {evaluation.method === 'order_match' && evaluation.score && evaluation.score.total > 0 && (
        <p className="data-num text-xs font-medium">
          {t('answerInput.orderScore', {
            earned: evaluation.score.earned,
            total: evaluation.score.total,
            percent: Math.round((evaluation.score.earned / evaluation.score.total) * 100),
          })}
        </p>
      )}
      {evaluation.note && <p className="text-xs text-muted-foreground">{evaluation.note}</p>}
      {evaluation.explanation && <p>{evaluation.explanation}</p>}
      {isCorrect !== true &&
        evaluation.expected &&
        (evaluation.method === 'exact_output' ? (
          <div className="space-y-1 text-xs">
            <p>{t('question.expected', { value: '' })}</p>
            <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px]">
              {evaluation.expected}
            </pre>
          </div>
        ) : (
          <p className="text-xs">{t('question.expected', { value: evaluation.expected })}</p>
        ))}
    </div>
  )
}

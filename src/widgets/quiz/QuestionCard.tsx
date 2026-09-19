import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, Lightbulb, Loader2, XCircle } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import {
  EVAL_METHOD_LABEL_KEYS,
  type QuestionEvaluation,
} from '@/entities/questionAttempt/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { AnswerInput } from './AnswerInput'
import { QuestionSource } from './QuestionSource'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface QuestionCardProps {
  question: Question
  index: number
  total: number
  difficulty: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onNext: () => void
  busy?: boolean
  evaluation?: QuestionEvaluation | null
  isLast: boolean
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
}: QuestionCardProps): JSX.Element {
  const { t } = useTranslation()
  const [hintIndex, setHintIndex] = useState(0)
  const answered = evaluation !== null && evaluation !== undefined

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="text-base">
          {t('question.label', { number: index + 1, total })}
        </CardTitle>
        <Badge variant="outline">{difficulty}</Badge>
        <Badge variant="outline">{question.type.replace('_', ' ')}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{question.knowledgePoint}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm font-medium">{question.prompt}</p>

        <AnswerInput
          question={question}
          value={value}
          onChange={onChange}
          disabled={busy || answered}
          revealed={answered}
        />

        {hintIndex > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20">
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

        {answered && evaluation && <EvaluationBox evaluation={evaluation} />}

        {answered && (
          <QuestionSource sourceRefs={question.sourceRefs} projectId={question.projectId} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!answered ? (
            <>
              <Button onClick={onSubmit} disabled={busy || !value.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
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
            </>
          ) : (
            <Button onClick={onNext}>
              {isLast ? t('question.seeResults') : t('question.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function EvaluationBox({ evaluation }: { evaluation: QuestionEvaluation }): JSX.Element {
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
    <div className={cn('space-y-2 rounded-md border p-3 text-sm', tone)}>
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {label}
        <span className="ml-auto text-xs text-muted-foreground">
          {t(EVAL_METHOD_LABEL_KEYS[evaluation.method])} ·{' '}
          {Math.round(evaluation.confidence * 100)}%
        </span>
      </div>
      {evaluation.note && <p className="text-xs text-muted-foreground">{evaluation.note}</p>}
      {evaluation.explanation && <p>{evaluation.explanation}</p>}
      {isCorrect !== true && evaluation.expected && (
        <p className="text-xs">
          {t('question.expected', { value: evaluation.expected })}
        </p>
      )}
    </div>
  )
}
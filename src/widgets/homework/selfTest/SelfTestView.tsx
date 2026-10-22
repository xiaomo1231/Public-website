import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Textarea } from '@/shared/ui/Textarea'
import { RichText } from '@/shared/ui/RichText'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import type { HomeworkQuestion, HomeworkSelfTest, HomeworkSet } from '@/entities/homework/types'
import { answerReference } from '@/entities/homework/answerCheck'
import { heldOutQuestions as selfTestQuestions } from '@/entities/evaluation/evalRole'
import type { HomeworkService } from '@/services/homeworkService'
import { QuestionWindowButton } from '../QuestionWindowLayer'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'

const VERDICT_KEYS = {
  correct: 'selfTest.verdict.correct',
  partial: 'selfTest.verdict.partial',
  incorrect: 'selfTest.verdict.incorrect',
  uncertain: 'selfTest.verdict.uncertain',
} as const

interface SelfTestViewProps {
  set: HomeworkSet
  questions: readonly HomeworkQuestion[]
  homework: HomeworkService
  language: 'zh' | 'en'
  onChanged?: () => void
  proofread?: HomeworkProofreadService
}

/**
 * 自测 (held-out self-test): the independent questions with no hints, no
 * walkthrough and no AI chat. The reference stays hidden until the answer is
 * submitted; the result is recorded to mastery tagged as held-out (never to
 * the mistake book, so no variants are made from it).
 */
export function SelfTestView({
  set,
  questions,
  homework,
  language,
  onChanged,
  proofread: injected,
}: SelfTestViewProps): JSX.Element {
  const { t } = useTranslation()
  const proofread = useMemo(() => injected ?? new HomeworkProofreadService(), [injected])
  const items = selfTestQuestions(set, questions)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, HomeworkSelfTest['verdict']>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (items.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t('selfTest.empty')}
        </CardContent>
      </Card>
    )

  const question = items[Math.min(index, items.length - 1)]!
  const answer = answers[question.id] ?? ''
  const isSubmitted = submitted[question.id] ?? false
  const reference = answerReference(question)
  const verdict = results[question.id] ?? question.selfTest?.verdict

  const record = async (
    result: HomeworkSelfTest['verdict'],
    by: 'self' | 'check',
    method?: 'local' | 'ai',
  ) => {
    await proofread.recordSelfTest(question.id, {
      answer,
      verdict: result,
      by,
      ...(method ? { method } : {}),
    })
    setResults((prev) => ({ ...prev, [question.id]: result }))
    onChanged?.()
  }

  const check = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await homework.checkAnswer(question.id, answer, language)
      await record(result.verdict, 'check', result.method)
    } catch (err) {
      setMessage(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-self-test>
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base lecture:font-heading lecture:font-bold">
            {t('selfTest.title', { current: index + 1, total: items.length })}
          </CardTitle>
          {/* 自测 uses no AI while answering: only a translation already made is shown. */}
          <QuestionWindowButton question={question} translationMode="cached" className="ml-auto" />
        </div>
        <p className="text-sm text-muted-foreground">{t('selfTest.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <RichText
          text={formatHomeworkQuestion(question.prompt)}
          format="markdown"
          paragraphClassName="text-[16px] leading-[1.75]"
        />
        <label htmlFor={`self-test-${question.id}`} className="text-sm font-medium">
          {t('selfTest.yourAnswer')}
        </label>
        <Textarea
          id={`self-test-${question.id}`}
          value={answer}
          disabled={isSubmitted}
          onChange={(event) =>
            setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
          }
          rows={6}
        />
        {!isSubmitted ? (
          <Button
            className="min-h-11"
            disabled={!answer.trim()}
            onClick={() => setSubmitted((prev) => ({ ...prev, [question.id]: true }))}
          >
            {t('selfTest.submit')}
          </Button>
        ) : (
          <div className="space-y-3" data-self-test-reference>
            <h3 className="text-sm font-medium">
              {reference?.kind === 'professor'
                ? t('selfTest.professorAnswer')
                : t('selfTest.platformAnswer')}
            </h3>
            {reference ? (
              <RichText
                text={formatHomeworkQuestion(reference.text)}
                format="markdown"
                paragraphClassName="text-sm leading-relaxed"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('selfTest.noReference')}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {reference && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('selfTest.check')}
                </Button>
              )}
              <span className="text-sm text-muted-foreground">{t('selfTest.markSelf')}</span>
              {(['correct', 'partial', 'incorrect'] as const).map((item) => (
                <Button
                  key={item}
                  variant={verdict === item ? 'default' : 'outline'}
                  aria-pressed={verdict === item}
                  className="min-h-11"
                  onClick={() => void record(item, 'self')}
                >
                  {t(VERDICT_KEYS[item])}
                </Button>
              ))}
            </div>
            {verdict && (
              <p className="text-sm" role="status">
                {t('selfTest.recorded', { verdict: t(VERDICT_KEYS[verdict]) })}
              </p>
            )}
          </div>
        )}
        {message && (
          <p className="text-sm text-destructive" role="alert">
            {message}
          </p>
        )}
        <div className="flex gap-2 border-t border-border/70 pt-3">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={index <= 0}
            onClick={() => setIndex(index - 1)}
            aria-label={t('homework.prev')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={index >= items.length - 1}
            onClick={() => setIndex(index + 1)}
            aria-label={t('homework.next')}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

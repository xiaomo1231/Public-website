import { MarketPartsAnswer } from '@/widgets/econ/MarketAnswerInput'
import { hasMarketParts, onlyMarketParts } from '@/entities/econ/partAnswers'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarClock, Loader2, RotateCcw, Shuffle } from 'lucide-react'
import type { Mistake } from '@/entities/mistake/types'
import type { Question } from '@/entities/question/types'
import {
  FOLLOW_UP_DAYS,
  isRetestDue,
  stageDays,
  type MistakeVariant,
} from '@/entities/mistake/followUp'
import type {
  FollowUpCheck,
  LectureLink,
  MistakeFollowUpService,
} from '@/services/mistakeFollowUpService'
import { questionText } from '@/services/practiceSetService'
import { followUpReasonKey, useFollowUpService } from './followUpHelpers'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { RichText } from '@/shared/ui/RichText'
import { QuestionOriginBadge } from '@/shared/ui/QuestionOriginBadge'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const VERDICT_KEYS: Record<FollowUpCheck['verdict'], TranslationKey> = {
  correct: 'followUp.verdict.correct',
  partial: 'followUp.verdict.partial',
  incorrect: 'followUp.verdict.incorrect',
  uncertain: 'followUp.verdict.uncertain',
}

/** 对应课件：文件名 第 n 页 — links open the document at that page. */
export function LectureLinks({
  projectId,
  links,
}: {
  projectId: string
  links: LectureLink[]
}): JSX.Element | null {
  const { t } = useTranslation()
  if (links.length === 0) return null
  return (
    <ul className="space-y-1 text-sm" data-lecture-links>
      {links.map((link) => (
        <li key={`${link.documentId}:${link.page ?? ''}`} className="flex items-start gap-2">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Link
            to={`/projects/${projectId}/documents/${link.documentId}${link.page ? `?page=${link.page}` : ''}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {link.page
              ? t('followUp.lecturePage', { name: link.documentName, page: link.page })
              : t('followUp.lectureFile', { name: link.documentName })}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** A variant (改编题) with an answer box and its check result. */
export function VariantRunner({
  variant,
  service,
  mistakeId,
  onChecked,
}: {
  variant: MistakeVariant
  service: MistakeFollowUpService
  mistakeId: string
  onChecked: (result: FollowUpCheck) => void
}): JSX.Element {
  const { t, language } = useTranslation()
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<FollowUpCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useGenerationRun({ abortOnUnmount: true })
  const busy = run.active

  const check = async () => {
    const generation = run.start()
    setError(null)
    try {
      const next = await service.checkVariant(mistakeId, answer, {
        signal: generation.signal,
        language: language === 'zh-CN' ? 'zh' : 'en',
      })
      setResult(next)
      onChecked(next)
    } catch (err) {
      if (!isGenerationInterruption(err, generation)) setError(friendlyAIError(err))
    } finally {
      generation.finish()
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-follow-up-variant={variant.purpose}>
      <div className="flex flex-wrap items-center gap-2">
        <QuestionOriginBadge origin={{ kind: 'adapted' }} />
        {variant.purpose === 'retest' && <Badge variant="secondary">{t('followUp.retest')}</Badge>}
      </div>
      <RichText text={questionText(variant)} format="markdown" className="space-y-2" />
      {!result && (
        <>
          {/* Graph parts (economics): answered on the diagram. */}
          {hasMarketParts(variant.parts) && (
            <MarketPartsAnswer parts={variant.parts} value={answer} onChange={setAnswer} />
          )}
          {!onlyMarketParts(variant.parts) && (
            <Textarea
              rows={3}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              aria-label={t('followUp.answerLabel')}
              placeholder={t('followUp.answerPlaceholder')}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void check()} disabled={busy || !answer.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('followUp.check')}
            </Button>
            <GenerationControls kind="single" state={run.state} onStopNow={run.stopNow} />
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="space-y-1 text-sm" role="status">
          <p className="font-medium">
            {t(VERDICT_KEYS[result.verdict])}
            {result.method === 'ai' && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t('followUp.aiEstimate')}
              </span>
            )}
          </p>
          {result.feedback && <p className="text-muted-foreground">{result.feedback}</p>}
          <p className="text-xs text-muted-foreground">
            {t('followUp.expected')}: {result.expectedAnswer}
          </p>
          <details>
            <summary className="cursor-pointer text-xs">{t('followUp.solution')}</summary>
            <RichText
              text={variant.parts.map((part) => part.solution).join('\n\n')}
              format="markdown"
              className="mt-1 space-y-2"
              paragraphClassName="text-sm"
            />
          </details>
        </div>
      )}
    </div>
  )
}

/**
 * 错题跟进 for one mistake card: lecture pages → explanation → 再试一次 →
 * 改编题 → spaced re-test status (and the re-test itself when due).
 */
export function MistakeFollowUpPanel({
  mistake,
  onChanged,
}: {
  mistake: Mistake
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useFollowUpService()
  const [links, setLinks] = useState<LectureLink[]>([])
  const [allowed, setAllowed] = useState(false)
  const [retryQuestion, setRetryQuestion] = useState<Question | null>(null)
  const [retryAnswer, setRetryAnswer] = useState('')
  const [retryResult, setRetryResult] = useState<FollowUpCheck | null>(null)
  const [variant, setVariant] = useState<MistakeVariant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useGenerationRun({ abortOnUnmount: true })

  useEffect(() => {
    if (!service) return
    let alive = true
    void Promise.all([
      service.lectureLinks(mistake),
      service.canFollowUp(mistake),
      service.retryQuestion(mistake),
    ]).then(([nextLinks, nextAllowed, question]) => {
      if (!alive) return
      setLinks(nextLinks)
      setAllowed(nextAllowed)
      setRetryQuestion(question)
    })
    return () => {
      alive = false
    }
  }, [service, mistake])

  const makeVariant = useCallback(
    async (purpose: MistakeVariant['purpose']) => {
      if (!service) return
      const generation = run.start()
      setError(null)
      try {
        setVariant(await service.createVariant(mistake.id, purpose, { control: generation }))
      } catch (err) {
        if (!isGenerationInterruption(err, generation)) setError(friendlyAIError(err))
      } finally {
        generation.finish()
      }
    },
    [service, mistake.id, run],
  )

  const followUp = mistake.followUp
  const due = isRetestDue(mistake, Date.now())
  const homeworkHref = mistake.homeworkSetId
    ? `/projects/${mistake.projectId}/homework/${mistake.homeworkSetId}`
    : null

  return (
    <section className="space-y-3 border-t pt-3" aria-label={t('followUp.title')} data-follow-up>
      <h4 className="text-sm font-medium">{t('followUp.title')}</h4>
      {links.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('followUp.lectureTitle')}</p>
          <LectureLinks projectId={mistake.projectId} links={links} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('followUp.noLecture')}</p>
      )}

      {mistake.solution && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium">
            {t('followUp.showSolution')}
          </summary>
          <RichText
            text={mistake.solution}
            format="markdown"
            className="mt-1 space-y-2"
            paragraphClassName="text-sm"
          />
        </details>
      )}

      {retryQuestion ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">{t('followUp.retry')}</p>
          {retryQuestion.options?.length ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('followUp.retry')}>
              {retryQuestion.options.map((option, index) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={retryAnswer === option.id ? 'default' : 'outline'}
                  onClick={() => setRetryAnswer(option.id)}
                >
                  {String.fromCharCode(65 + index)}. {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <Input
              value={retryAnswer}
              onChange={(event) => setRetryAnswer(event.target.value)}
              aria-label={t('followUp.answerLabel')}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!retryAnswer.trim() || !service}
            onClick={async () => {
              if (!service) return
              try {
                setRetryResult(await service.retry(mistake.id, retryAnswer))
                onChanged()
              } catch (err) {
                setError(friendlyAIError(err))
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {t('followUp.check')}
          </Button>
          {retryResult && (
            <p className="text-sm" role="status">
              {t(VERDICT_KEYS[retryResult.verdict])}
              {retryResult.verdict !== 'correct' &&
                ` · ${t('followUp.expected')}: ${retryResult.expectedAnswer}`}
            </p>
          )}
        </div>
      ) : homeworkHref ? (
        <Button asChild size="sm" variant="outline">
          <Link to={homeworkHref}>
            <RotateCcw className="h-4 w-4" />
            {t('followUp.retryInHomework')}
          </Link>
        </Button>
      ) : null}

      {allowed ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!service || run.active}
              onClick={() => void makeVariant('variant')}
            >
              {run.active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shuffle className="h-4 w-4" />
              )}
              {t('followUp.variant')}
            </Button>
            {due && (
              <Button
                size="sm"
                disabled={!service || run.active}
                onClick={() => void makeVariant('retest')}
              >
                <CalendarClock className="h-4 w-4" />
                {t('followUp.retestNow')}
              </Button>
            )}
            <GenerationControls kind="single" state={run.state} onStopNow={run.stopNow} />
          </div>
          {followUp && (
            <p className="text-xs text-muted-foreground" data-follow-up-schedule>
              {followUp.completedAt
                ? t('followUp.completed')
                : t(due ? 'followUp.dueNow' : 'followUp.scheduled', {
                    date: new Date(followUp.dueAt).toLocaleDateString(),
                    round: Math.min(followUp.stage + 1, FOLLOW_UP_DAYS.length),
                    rounds: FOLLOW_UP_DAYS.length,
                    days: stageDays(followUp),
                  })}
              {!followUp.completedAt && ` · ${t(followUpReasonKey(mistake))}`}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('followUp.independent')}</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {variant && service && (
        <VariantRunner
          key={variant.id}
          variant={variant}
          service={service}
          mistakeId={mistake.id}
          onChecked={() => onChanged()}
        />
      )}
    </section>
  )
}

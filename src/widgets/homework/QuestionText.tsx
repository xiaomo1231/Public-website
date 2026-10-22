import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw, Square } from 'lucide-react'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  currentTranslation,
  isMainlyChinese,
  translationSourceHash,
  type QuestionTranslation,
} from '@/entities/homework/questionTranslation'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import {
  buildQuestionTranslationService,
  type QuestionTranslationService,
} from '@/services/questionTranslationService'
import { RichText } from '@/shared/ui/RichText'
import { Button } from '@/shared/ui/Button'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

type QuestionTab = 'original' | 'zh'

/** The tab each question showed during this visit (not stored). */
const chosenTabs = new Map<string, QuestionTab>()

/** Built per request, so a changed AI setting applies to the next one. */
function translationService(): Promise<QuestionTranslationService> {
  return buildQuestionTranslationService()
}

export interface QuestionTextProps {
  question: Pick<HomeworkQuestion, 'id' | 'prompt' | 'translation'>
  className?: string
  paragraphClassName?: string
}

/**
 * A homework question's original text, with 原文 / 中文翻译 when it is not
 * already Chinese. The translation is asked for on the first click (one small
 * request, stoppable), checked locally and cached on the question; the tab
 * chosen is remembered for this visit.
 */
export function QuestionText({
  question,
  className,
  paragraphClassName,
}: QuestionTextProps): JSX.Element {
  const { t } = useTranslation()
  const offer = !isMainlyChinese(question.prompt)
  const [tab, setTab] = useState<QuestionTab>(() => chosenTabs.get(question.id) ?? 'original')
  const [translation, setTranslation] = useState<QuestionTranslation | undefined>(() =>
    currentTranslation(question),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  // A changed question text makes the translation stale (asked for again on click).
  const { prompt, translation: stored } = question
  useEffect(() => {
    const cached = currentTranslation({ prompt, ...(stored ? { translation: stored } : {}) })
    setTranslation(
      (shown) =>
        cached ?? (shown && shown.sourceHash === translationSourceHash(prompt) ? shown : undefined),
    )
  }, [prompt, stored])

  useEffect(() => () => controller.current?.abort(), [])

  async function request(): Promise<void> {
    controller.current?.abort()
    const run = new AbortController()
    controller.current = run
    setLoading(true)
    setError(null)
    try {
      const service = await translationService()
      const result = await service.translate(question.id, { signal: run.signal })
      if (!run.signal.aborted) setTranslation(result)
    } catch (err) {
      // Stopped: back to the original, nothing to report.
      if (run.signal.aborted) return
      setError(friendlyAIError(err))
    } finally {
      if (controller.current === run) {
        controller.current = null
        setLoading(false)
      }
    }
  }

  function choose(next: QuestionTab): void {
    chosenTabs.set(question.id, next)
    setTab(next)
    if (next === 'zh' && !translation && !loading) void request()
  }

  function stop(): void {
    controller.current?.abort()
    controller.current = null
    setLoading(false)
    choose('original')
  }

  const showTranslation = offer && tab === 'zh'
  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {offer && (
        <div
          role="group"
          aria-label={t('homework.translation.group')}
          data-question-tab={tab}
          data-print-hidden
          className="inline-flex items-center overflow-hidden rounded-md border text-xs lecture:rounded-none lab:rounded-none lab:font-mono"
        >
          {(['original', 'zh'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tab === option}
              onClick={() => tab !== option && choose(option)}
              className={cn(
                'focus-ring px-2.5 py-1 transition-colors duration-150',
                tab === option
                  ? 'bg-primary-strong text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {option === 'original'
                ? t('homework.translation.original')
                : t('homework.translation.zh')}
            </button>
          ))}
        </div>
      )}
      {showTranslation && translation ? (
        <div data-question-translation lang="zh-CN">
          <RichText
            text={formatHomeworkQuestion(translation.text)}
            format="markdown"
            {...(paragraphClassName ? { paragraphClassName } : {})}
          />
        </div>
      ) : showTranslation && loading ? (
        <div
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('homework.translation.loading')}
          <Button variant="ghost" size="sm" onClick={stop}>
            <Square className="h-3.5 w-3.5" aria-hidden />
            {t('homework.translation.stop')}
          </Button>
        </div>
      ) : showTranslation && error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void request()}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('homework.translation.retry')}
          </Button>
        </div>
      ) : (
        <RichText
          text={formatHomeworkQuestion(question.prompt)}
          format="markdown"
          {...(paragraphClassName ? { paragraphClassName } : {})}
        />
      )}
    </div>
  )
}

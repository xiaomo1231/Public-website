import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Loader2, RotateCcw, Square } from 'lucide-react'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  isMainlyChinese,
  translationSourceHash,
  type QuestionTranslation,
} from '@/entities/homework/questionTranslation'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import {
  abortRun,
  chosenTabs,
  knownTranslation,
  startRun,
  type QuestionTab,
  type TranslationRun,
} from '@/features/homework/questionTranslationRuns'
import { RichText } from '@/shared/ui/RichText'
import { Button } from '@/shared/ui/Button'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { QuestionTranslationMode } from '@/features/homework/questionWindowStore'

/**
 * `request`: the 中文翻译 tab asks for a translation when there is none.
 * `cached`: only a translation already made is shown (模拟考试 / 自测, where
 * no AI is used while answering); without one there is no tab.
 */
export type { QuestionTranslationMode }

export interface QuestionTextProps {
  question: Pick<HomeworkQuestion, 'id' | 'prompt' | 'translation'>
  className?: string
  paragraphClassName?: string
  /** Applied to the text (e.g. the floating window's font size). */
  textStyle?: CSSProperties
  translationMode?: QuestionTranslationMode
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
  textStyle,
  translationMode = 'request',
}: QuestionTextProps): JSX.Element {
  const { t } = useTranslation()
  const [translation, setTranslation] = useState<QuestionTranslation | undefined>(() =>
    knownTranslation(question),
  )
  const canRequest = translationMode === 'request'
  const notChinese = !isMainlyChinese(question.prompt)
  const offer = notChinese && (canRequest || Boolean(translation))
  const [tab, setTab] = useState<QuestionTab>(() => chosenTabs.get(question.id) ?? 'original')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const joined = useRef<TranslationRun | null>(null)

  // A changed question text makes the translation stale (asked for again on click).
  const { id, prompt, translation: stored } = question
  useEffect(() => {
    const cached = knownTranslation({ id, prompt, ...(stored ? { translation: stored } : {}) })
    setTranslation(
      (shown) =>
        cached ?? (shown && shown.sourceHash === translationSourceHash(prompt) ? shown : undefined),
    )
  }, [id, prompt, stored])

  /** Stop waiting; the request is stopped when nobody else waits for it. */
  function leave(): void {
    const run = joined.current
    if (!run) return
    joined.current = null
    run.waiters -= 1
    if (run.waiters <= 0) abortRun(question.id, run)
  }

  useEffect(
    () => () => leave(),
    // On unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  async function request(): Promise<void> {
    if (!canRequest) return
    leave()
    const run = startRun(question.id)
    run.waiters += 1
    joined.current = run
    setLoading(true)
    setError(null)
    try {
      const result = await run.promise
      if (joined.current === run) setTranslation(result)
    } catch (err) {
      if (joined.current !== run) return
      // Stopped (here or in another view of this question): back to the original.
      if (run.controller.signal.aborted) {
        chosenTabs.set(question.id, 'original')
        setTab('original')
        return
      }
      setError(friendlyAIError(err))
    } finally {
      if (joined.current === run) {
        joined.current = null
        run.waiters -= 1
        setLoading(false)
      }
    }
  }

  function choose(next: QuestionTab): void {
    chosenTabs.set(question.id, next)
    setTab(next)
    if (next !== 'zh' || translation || loading) return
    const known = knownTranslation(question)
    if (known) setTranslation(known)
    else void request()
  }

  function stop(): void {
    const run = joined.current
    joined.current = null
    if (run) abortRun(question.id, run)
    setLoading(false)
    choose('original')
  }

  const showTranslation = offer && tab === 'zh'
  const paragraph = paragraphClassName ? { paragraphClassName } : {}
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
      {notChinese && !canRequest && !translation && (
        <p className="text-xs text-muted-foreground" data-translation-unavailable>
          {t('homework.translation.cachedOnly')}
        </p>
      )}
      {showTranslation && translation ? (
        <div data-question-translation lang="zh-CN" style={textStyle}>
          <RichText
            text={formatHomeworkQuestion(translation.text)}
            format="markdown"
            {...paragraph}
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
        <div style={textStyle}>
          <RichText
            text={formatHomeworkQuestion(question.prompt)}
            format="markdown"
            {...paragraph}
          />
        </div>
      )}
    </div>
  )
}

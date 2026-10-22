import type { SectionAttempt, WalkthroughProgress } from '@/services/homeworkWalkthroughService'
import type { TranslationKey } from '@/i18n'

type T = (key: TranslationKey, params?: Record<string, string | number>) => string

/**
 * The headline of a multi-section run: how many sections are being written
 * right now and how many are finished — 「正在编写 3 题（已完成 5 / 8）」. With
 * several requests at once the finished count is not "the one being written",
 * so both are said. No time estimate (request times vary too much).
 */
export function walkthroughProgressHeadline(progress: WalkthroughProgress, t: T): string {
  const params = { done: progress.done, total: progress.total }
  const running = progress.running.length
  if (running === 0)
    return t(
      progress.variant
        ? 'homework.walkthrough.variantProgress'
        : progress.compare
          ? 'homework.walkthrough.compareProgress'
          : 'homework.walkthrough.progress',
      params,
    )
  const onlyQuestions = progress.running.every((id) => id !== 'overview' && id !== 'summary')
  return t(
    progress.variant
      ? 'homework.walkthrough.variantProgressRunning'
      : progress.compare
        ? 'homework.walkthrough.compareProgressRunning'
        : onlyQuestions
          ? 'homework.walkthrough.progressRunningQuestions'
          : 'homework.walkthrough.progressRunning',
    { ...params, running },
  )
}

/**
 * Every section in flight, in the order they started, with the sub-parts
 * being written for a split question: 「进行中：第 1 题、第 3 题 (b, c)、开头」.
 * `null` when nothing runs.
 */
export function walkthroughInFlightText(
  progress: WalkthroughProgress,
  titleOf: (sectionId: string) => string,
  t: T,
): string | null {
  if (progress.running.length === 0) return null
  const items = progress.running.map((id) => {
    const title = titleOf(id) || id
    const part = progress.parts?.[id]
    return part ? `${title} (${part})` : title
  })
  return t('homework.walkthrough.inFlight', {
    list: items.join(t('homework.walkthrough.inFlightSeparator')),
  })
}

/** 第 2 次尝试：上次输出被截断，改为逐小题生成 */
export function walkthroughAttemptText(attempt: SectionAttempt, t: T): string {
  const base = t('homework.walkthrough.attempt', {
    attempt: attempt.attempt,
    reason: failureText(attempt.lastFailure, t),
  })
  const change = attempt.change
  if (!change) return base
  switch (change.kind) {
    case 'split':
      return base + t('homework.walkthrough.change.split')
    case 'wait':
      return base + t('homework.walkthrough.change.wait', { seconds: change.seconds })
  }
}

function failureText(kind: SectionAttempt['lastFailure'], t: T): string {
  switch (kind) {
    case 'timeout':
    case 'truncated':
    case 'output-limit':
    case 'rate-limited':
    case 'unavailable':
    case 'invalid-response':
      return t(`homework.walkthrough.failure.${kind}` as TranslationKey)
    default:
      return t('homework.walkthrough.failure.other')
  }
}

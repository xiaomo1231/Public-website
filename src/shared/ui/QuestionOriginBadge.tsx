import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'
import type { QuestionOriginInfo } from '@/entities/question/origin'

export interface QuestionOriginBadgeProps {
  origin: QuestionOriginInfo
  className?: string
}

function originKeys(origin: QuestionOriginInfo): { label: TranslationKey; hint: TranslationKey } {
  if (origin.kind === 'original') return { label: 'origin.original', hint: 'origin.originalHint' }
  if (origin.kind === 'adapted') return { label: 'origin.adapted', hint: 'origin.adaptedHint' }
  return origin.grounded
    ? { label: 'origin.aiGrounded', hint: 'origin.aiGroundedHint' }
    : { label: 'origin.aiNoSource', hint: 'origin.aiNoSourceHint' }
}

/**
 * 原题 / 改编题 / AI 新题: where a question came from. The explanation is the
 * tooltip and is also read out (the badge text alone is terse).
 */
export function QuestionOriginBadge({ origin, className }: QuestionOriginBadgeProps): JSX.Element {
  const { t } = useTranslation()
  const keys = originKeys(origin)
  const hint = t(keys.hint)
  return (
    <span
      data-origin={origin.kind}
      title={hint}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium',
        'lecture:rounded-full lab:rounded-sm lab:font-mono lab:text-[11px]',
        origin.kind === 'original' && 'border-primary/40 bg-theme-primary-soft text-foreground',
        origin.kind === 'adapted' && 'border-border bg-muted/60 text-foreground',
        origin.kind === 'ai' &&
          (origin.grounded
            ? 'border-border text-muted-foreground'
            : 'border-amber-500/50 text-amber-800 dark:text-amber-300'),
        className,
      )}
    >
      <span className="truncate">{t(keys.label)}</span>
      <span className="sr-only">{`: ${hint}`}</span>
    </span>
  )
}

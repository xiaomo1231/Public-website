import { GraduationCap, Info } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { RubricSource } from '@/entities/question/origin'

export interface RubricSourceLabelProps {
  /** Resolve with `rubricSourceOf` first: an unknown source is `platform`. */
  source: RubricSource
  className?: string
}

/**
 * Who set the scoring points: 「教授评分标准」 or 「平台拟定的得分点（非教授标准）」.
 * Shown wherever points are listed, so AI-written points are never mistaken
 * for the professor's marking scheme.
 */
export function RubricSourceLabel({ source, className }: RubricSourceLabelProps): JSX.Element {
  const { t } = useTranslation()
  const professor = source === 'professor'
  const hint = t(professor ? 'rubricSource.professorHint' : 'rubricSource.platformHint')
  const Icon = professor ? GraduationCap : Info
  return (
    <span
      data-rubric-source={source}
      title={hint}
      className={cn(
        'inline-flex max-w-full items-center gap-1 text-xs',
        professor ? 'font-medium text-foreground' : 'text-amber-800 dark:text-amber-300',
        'lab:font-mono lab:text-[11px]',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {t(professor ? 'rubricSource.professor' : 'rubricSource.platform')}
      </span>
      <span className="sr-only">{`: ${hint}`}</span>
    </span>
  )
}

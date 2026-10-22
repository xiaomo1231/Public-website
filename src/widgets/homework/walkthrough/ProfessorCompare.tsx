import { GraduationCap, Scale, Wand2 } from 'lucide-react'
import type { CompareStatus, ProfessorCompareReport } from '@/entities/homework/professorCompare'
import { formatWalkthroughText } from '@/entities/homework/walkthroughFormat'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

/** 「已按教授答案」: the section was written following the professor's answer. */
export function ProfessorAlignedBadge(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Badge variant="outline" className="gap-1" data-professor-aligned>
      <GraduationCap className="h-3 w-3" aria-hidden />
      {t('homework.walkthrough.alignedBadge')}
    </Badge>
  )
}

const STATUS_STYLE: Record<CompareStatus, string> = {
  same: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
  not_in_professor: 'text-muted-foreground',
  method_differs: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  result_differs: 'border-destructive/60 text-destructive',
  missing_in_walkthrough: 'border-destructive/60 text-destructive',
}

/**
 * The comparison with the professor's answer, sub-part by sub-part, with
 * 按教授答案修改 (a rewrite the student starts) and 保持现状. Nothing is
 * rewritten without that click.
 */
export function ProfessorCompareView({
  report,
  onAlign,
  onDismiss,
  aiReady,
}: {
  report: ProfessorCompareReport
  /** Absent while a run is in progress. */
  onAlign?: (() => void) | undefined
  onDismiss?: (() => void) | undefined
  aiReady: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const keep = report.recommendation === 'keep'
  return (
    <details
      open={!report.dismissed}
      data-professor-compare
      data-print-hidden
      className="max-w-[70ch] rounded-lg border border-border/80 px-4 py-3 text-sm lecture:rounded-none lecture:border-x-0 lecture:px-0 lab:rounded-none"
    >
      <summary className="focus-ring flex min-h-[44px] cursor-pointer items-center gap-2 font-medium">
        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t('homework.walkthrough.compareTitle')}</span>
        <span className="text-muted-foreground">
          {t(
            `homework.walkthrough.compareRecommendation.${report.recommendation}` as TranslationKey,
          )}
        </span>
      </summary>
      <ul className="mt-2 space-y-2">
        {report.items.map((item) => (
          <li key={item.label || 'whole'} className="space-y-1" data-compare-item={item.label}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs tabular-nums">
                {item.label ? `(${item.label})` : t('homework.walkthrough.compareWhole')}
              </span>
              <Badge variant="outline" className={cn(STATUS_STYLE[item.status])}>
                {t(`homework.walkthrough.compareStatus.${item.status}` as TranslationKey)}
              </Badge>
              {item.localCheck && (
                <span className="text-xs text-muted-foreground">
                  {t(
                    item.localCheck === 'verified'
                      ? 'homework.walkthrough.compareLocalVerified'
                      : 'homework.walkthrough.compareLocalMismatch',
                  )}
                </span>
              )}
            </div>
            {item.note && (
              <RichText
                text={formatWalkthroughText(item.note)}
                format="markdown"
                paragraphClassName="text-sm leading-relaxed"
              />
            )}
            {item.professorQuote && (
              <blockquote className="border-l-2 pl-3 text-muted-foreground">
                <RichText
                  text={item.professorQuote}
                  format="markdown"
                  paragraphClassName="text-sm"
                />
              </blockquote>
            )}
          </li>
        ))}
      </ul>
      {!report.dismissed && (onAlign || onDismiss) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onAlign && !keep && (
            <Button
              size="sm"
              disabled={!aiReady}
              title={aiReady ? undefined : t('homework.noProvider')}
              onClick={onAlign}
            >
              <Wand2 className="h-4 w-4" aria-hidden />
              {t('homework.walkthrough.alignToProfessor')}
            </Button>
          )}
          {onDismiss && (
            <Button variant="outline" size="sm" onClick={onDismiss}>
              {t('homework.walkthrough.keepAsIs')}
            </Button>
          )}
        </div>
      )}
      {report.dismissed && (
        <p className="mt-2 text-xs text-muted-foreground">{t('homework.walkthrough.keptAsIs')}</p>
      )}
    </details>
  )
}

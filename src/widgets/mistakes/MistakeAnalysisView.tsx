import { useState } from 'react'
import { AlertCircle, ArrowRight, BookOpen, Lightbulb, Sparkles } from 'lucide-react'
import type { MistakeAnalysis } from '@/entities/mistake/types'
import { MISTAKE_TYPE_LABEL_KEYS } from '@/entities/mistake/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

export interface MistakeAnalysisViewProps {
  analysis: MistakeAnalysis
  onPractice?: () => void
}

interface Step {
  key: string
  labelKey: TranslationKey
  content: string
  tone?: 'neutral' | 'warn' | 'good'
}

/**
 * Reveals the analysis one step at a time so the student is never flooded
 * with text. Each step is a short card; "Next step" advances.
 */
export function MistakeAnalysisView({ analysis, onPractice }: MistakeAnalysisViewProps): JSX.Element {
  const { t } = useTranslation()
  const steps: Step[] = [
    { key: 'where', labelKey: 'mistakeAnalysis.divergence', content: analysis.whereWrong },
    { key: 'first', labelKey: 'mistakeAnalysis.keyError', content: analysis.firstError, tone: 'warn' },
    { key: 'why', labelKey: 'mistakeAnalysis.whyFails', content: analysis.whyWrong },
    { key: 'correct', labelKey: 'mistakeAnalysis.correctApproach', content: analysis.correctApproach, tone: 'good' },
    { key: 'cause', labelKey: 'mistakeAnalysis.possibleCause', content: analysis.possibleCause },
  ]

  const [revealed, setRevealed] = useState(1)
  const done = revealed >= steps.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(MISTAKE_TYPE_LABEL_KEYS[analysis.mistakeType])}</Badge>
        {analysis.reviewKnowledgePoints.map((kp) => (
          <Badge key={kp} variant="secondary">
            {kp}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {t('mistakeAnalysis.step', { current: Math.min(revealed, steps.length), total: steps.length })}
        </span>
      </div>

      <ol className="space-y-2">
        {steps.slice(0, revealed).map((step, i) => (
          <li
            key={step.key}
            className={cn(
              'rounded-md border p-3 text-sm',
              step.tone === 'warn' && 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20',
              step.tone === 'good' && 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20',
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[10px] text-foreground">
                {i + 1}
              </span>
              {t(step.labelKey)}
            </div>
            <p className="whitespace-pre-wrap">{step.content}</p>
          </li>
        ))}
      </ol>

      {!done ? (
        <Button variant="outline" onClick={() => setRevealed((r) => r + 1)}>
          {t('mistakeAnalysis.nextStep')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        <div className="space-y-3">
          {analysis.similarExample && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Lightbulb className="h-4 w-4" />
                {t('mistakeAnalysis.trySimilar')}
              </div>
              <p>{analysis.similarExample.prompt}</p>
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('mistakeAnalysis.showAnswer')}</summary>
                <p className="mt-1 font-mono">{analysis.similarExample.answer}</p>
                {analysis.similarExample.explanation && <p className="mt-1">{analysis.similarExample.explanation}</p>}
              </details>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span>{analysis.continuePrompt}</span>
            {onPractice && (
              <Button size="sm" className="ml-auto" onClick={onPractice}>
                {t('mistakeAnalysis.practiceNow')}
              </Button>
            )}
          </div>

          {!analysis.shouldPracticeMore && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('mistakeAnalysis.practiceOptional')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function AnalysisPlaceholder({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
      <BookOpen className="mt-0.5 h-4 w-4" />
      <span>{message}</span>
    </div>
  )
}